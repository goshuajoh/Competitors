import { useEffect, useRef, useMemo, useState } from 'react';
import * as d3 from 'd3';
import { hasWifi, hasBle, hasThread, hasMatter, getArch } from '../lib/chipData';

const NODE_COLORS = {
  manufacturer: '#3b82f6',
  chip: '#6b7280',
  protocol: '#22c55e',
  architecture: '#f59e0b',
};

const PROTOCOL_LIST = ['WiFi', 'BLE', 'Thread', 'Matter', 'Zigbee', 'LoRa', 'Cellular'];

export default function GraphView({ data }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [activeFilter, setActiveFilter] = useState('all');
  const [hoveredNode, setHoveredNode] = useState(null);

  const graphData = useMemo(() => {
    const nodes = [];
    const links = [];
    const nodeSet = new Set();

    const addNode = (id, type, label, extra = {}) => {
      if (!nodeSet.has(id)) {
        nodeSet.add(id);
        nodes.push({ id, type, label, ...extra });
      }
    };

    // Add protocol nodes
    for (const proto of PROTOCOL_LIST) {
      addNode(`proto:${proto}`, 'protocol', proto);
    }

    // Add manufacturer + chip nodes
    for (const [mfr, chips] of data.chipsByManufacturer.entries()) {
      const mfrId = `mfr:${mfr}`;
      const isEsp = chips[0]?._file === 'espressif';
      addNode(mfrId, 'manufacturer', mfr, { isEsp, chipCount: chips.length });

      for (const chip of chips) {
        if (activeFilter !== 'all') {
          const pass =
            (activeFilter === 'wifi' && hasWifi(chip)) ||
            (activeFilter === 'ble' && hasBle(chip)) ||
            (activeFilter === 'thread' && hasThread(chip)) ||
            (activeFilter === 'matter' && hasMatter(chip));
          if (!pass) continue;
        }

        const chipId = `chip:${mfr}:${chip.chip_model}`;
        addNode(chipId, 'chip', chip.chip_model, {
          manufacturer: mfr,
          isEsp,
          arch: getArch(chip),
        });

        // Chip -> Manufacturer
        links.push({ source: chipId, target: mfrId, type: 'belongs_to' });

        // Chip -> Protocols
        if (hasWifi(chip)) links.push({ source: chipId, target: 'proto:WiFi', type: 'supports' });
        if (hasBle(chip)) links.push({ source: chipId, target: 'proto:BLE', type: 'supports' });
        if (hasThread(chip)) links.push({ source: chipId, target: 'proto:Thread', type: 'supports' });
        if (hasMatter(chip)) links.push({ source: chipId, target: 'proto:Matter', type: 'supports' });

        // Chip -> Architecture
        const arch = getArch(chip);
        if (arch && arch !== 'Unknown') {
          const archId = `arch:${arch}`;
          addNode(archId, 'architecture', arch);
          links.push({ source: chipId, target: archId, type: 'uses' });
        }
      }
    }

    // Remove orphan manufacturer nodes (no chip links after filter)
    const linkedIds = new Set();
    for (const l of links) {
      linkedIds.add(typeof l.source === 'string' ? l.source : l.source.id);
      linkedIds.add(typeof l.target === 'string' ? l.target : l.target.id);
    }
    const filteredNodes = nodes.filter((n) => linkedIds.has(n.id));

    return { nodes: filteredNodes, links };
  }, [data, activeFilter]);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Clear previous
    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    // Zoom
    const g = svg.append('g');
    const zoom = d3.zoom()
      .scaleExtent([0.2, 4])
      .on('zoom', (e) => g.attr('transform', e.transform));
    svg.call(zoom);

    // Simulation
    const simulation = d3.forceSimulation(graphData.nodes)
      .force('link', d3.forceLink(graphData.links).id((d) => d.id).distance((d) => {
        if (d.type === 'belongs_to') return 60;
        if (d.type === 'supports') return 120;
        return 100;
      }))
      .force('charge', d3.forceManyBody().strength((d) => {
        if (d.type === 'protocol') return -400;
        if (d.type === 'manufacturer') return -300;
        if (d.type === 'architecture') return -250;
        return -80;
      }))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius((d) => getRadius(d) + 4));

    // Links
    const link = g.append('g')
      .selectAll('line')
      .data(graphData.links)
      .join('line')
      .attr('stroke', (d) => {
        if (d.type === 'supports') return '#22c55e30';
        if (d.type === 'uses') return '#f59e0b30';
        return '#374151';
      })
      .attr('stroke-width', 1);

    // Nodes
    const node = g.append('g')
      .selectAll('circle')
      .data(graphData.nodes)
      .join('circle')
      .attr('r', getRadius)
      .attr('fill', (d) => {
        if (d.type === 'manufacturer') return d.isEsp ? '#3b82f6' : '#6b7280';
        if (d.type === 'protocol') return '#22c55e';
        if (d.type === 'architecture') return '#f59e0b';
        return d.isEsp ? '#60a5fa' : '#9ca3af';
      })
      .attr('stroke', '#111827')
      .attr('stroke-width', 1.5)
      .attr('cursor', 'pointer')
      .call(d3.drag()
        .on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on('end', (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
      );

    // Labels
    const labels = g.append('g')
      .selectAll('text')
      .data(graphData.nodes)
      .join('text')
      .text((d) => d.label)
      .attr('font-size', (d) => {
        if (d.type === 'protocol' || d.type === 'manufacturer') return 11;
        if (d.type === 'architecture') return 9;
        return 8;
      })
      .attr('fill', '#e5e7eb')
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => getRadius(d) + 12)
      .attr('pointer-events', 'none');

    // Hover effects
    node.on('mouseover', function (e, d) {
      setHoveredNode(d);
      d3.select(this).attr('stroke', '#60a5fa').attr('stroke-width', 3);
      // Highlight connected links
      link.attr('stroke-opacity', (l) => {
        const sid = typeof l.source === 'string' ? l.source : l.source.id;
        const tid = typeof l.target === 'string' ? l.target : l.target.id;
        return sid === d.id || tid === d.id ? 1 : 0.15;
      }).attr('stroke-width', (l) => {
        const sid = typeof l.source === 'string' ? l.source : l.source.id;
        const tid = typeof l.target === 'string' ? l.target : l.target.id;
        return sid === d.id || tid === d.id ? 2 : 1;
      });
    }).on('mouseout', function () {
      setHoveredNode(null);
      d3.select(this).attr('stroke', '#111827').attr('stroke-width', 1.5);
      link.attr('stroke-opacity', 1).attr('stroke-width', 1);
    });

    simulation.on('tick', () => {
      link
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y);
      node.attr('cx', (d) => d.x).attr('cy', (d) => d.y);
      labels.attr('x', (d) => d.x).attr('y', (d) => d.y);
    });

    // Initial zoom out to fit
    svg.call(zoom.transform, d3.zoomIdentity.translate(width * 0.1, height * 0.1).scale(0.8));

    return () => simulation.stop();
  }, [graphData]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-gray-800 px-4 md:px-6 py-3 flex items-center justify-between flex-wrap gap-2 shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-white">Knowledge Graph</h2>
          <p className="text-xs text-gray-500">
            {graphData.nodes.length} nodes &middot; {graphData.links.length} relationships
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Filter:</span>
          {['all', 'wifi', 'ble', 'thread', 'matter'].map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`px-3 py-1 rounded-lg text-xs border transition-colors ${
                activeFilter === f
                  ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                  : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500'
              }`}
            >
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="px-4 md:px-6 py-2 flex flex-wrap gap-4 text-xs text-gray-400 border-b border-gray-800/50 shrink-0">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block" /> Espressif</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-gray-500 inline-block" /> Competitor</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" /> Protocol</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-yellow-500 inline-block" /> Architecture</span>
        <span className="text-gray-600 ml-auto">Scroll to zoom &middot; Drag nodes to rearrange</span>
      </div>

      {/* Graph */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden bg-gray-950">
        <svg ref={svgRef} className="w-full h-full" />

        {/* Hover info card */}
        {hoveredNode && (
          <div className="absolute top-4 right-4 bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-xl min-w-[180px]">
            <p className="text-sm font-semibold text-white">{hoveredNode.label}</p>
            <p className="text-xs text-gray-500 capitalize">{hoveredNode.type}</p>
            {hoveredNode.manufacturer && (
              <p className="text-xs text-gray-400 mt-1">{hoveredNode.manufacturer}</p>
            )}
            {hoveredNode.arch && hoveredNode.type === 'chip' && (
              <p className="text-xs text-gray-400">{hoveredNode.arch}</p>
            )}
            {hoveredNode.chipCount && (
              <p className="text-xs text-gray-400 mt-1">{hoveredNode.chipCount} chips</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function getRadius(d) {
  if (d.type === 'protocol') return 18;
  if (d.type === 'manufacturer') return d.isEsp ? 16 : 12;
  if (d.type === 'architecture') return 10;
  return 6;
}
