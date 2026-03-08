import { useState, useMemo } from 'react';
import { Search, X, ChevronDown, ChevronRight } from 'lucide-react';
import { compareChips, compareValues, SECTIONS } from '../lib/compare';
import { fuzzyFind } from '../lib/chipData';

export default function CompareView({ data, compareList, setCompareList }) {
  const [search, setSearch] = useState('');
  const [collapsedSections, setCollapsedSections] = useState(new Set());

  const searchResults = useMemo(() => {
    if (!search) return [];
    return fuzzyFind(data.allChips, search)
      .filter((c) => !compareList.some((cl) => cl.chip_model === c.chip_model))
      .slice(0, 8);
  }, [data, search, compareList]);

  const comparison = useMemo(() => {
    if (compareList.length < 1) return null;
    return compareChips(compareList);
  }, [compareList]);

  const addChip = (chip) => {
    if (compareList.length < 4 && !compareList.some((c) => c.chip_model === chip.chip_model)) {
      setCompareList([...compareList, chip]);
    }
    setSearch('');
  };

  const removeChip = (chip) => {
    setCompareList(compareList.filter((c) => c.chip_model !== chip.chip_model));
  };

  const toggleSection = (name) => {
    const next = new Set(collapsedSections);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setCollapsedSections(next);
  };

  return (
    <div className="p-4 md:p-6">
      <h2 className="text-xl md:text-2xl font-bold text-white mb-6">Compare Chips</h2>

      {/* Chip selector */}
      <div className="mb-6">
        <div className="flex flex-wrap gap-2 mb-3">
          {compareList.map((chip) => (
            <div
              key={chip.chip_model}
              className="flex items-center gap-2 bg-blue-600/15 border border-blue-500/30 text-blue-400 rounded-full px-3 py-1 text-sm"
            >
              <span className="font-medium">{chip.chip_model}</span>
              <span className="text-blue-600 text-xs">({chip._manufacturer})</span>
              <button onClick={() => removeChip(chip)} className="hover:text-white">
                <X size={14} />
              </button>
            </div>
          ))}
          {compareList.length < 4 && (
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={compareList.length === 0 ? 'Search chips to compare...' : 'Add another chip...'}
                className="bg-gray-900 border border-gray-700 rounded-full px-4 py-1 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none w-64"
              />
              {searchResults.length > 0 && (
                <div className="absolute top-full mt-1 w-80 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-20 overflow-hidden">
                  {searchResults.map((chip) => (
                    <button
                      key={`${chip._file}-${chip.chip_model}`}
                      onClick={() => addChip(chip)}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-gray-700 transition-colors"
                    >
                      <span className="text-white font-medium">{chip.chip_model}</span>
                      <span className="text-gray-500 text-xs">{chip._manufacturer}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {compareList.length === 0 && (
          <p className="text-gray-500 text-sm">Select 2-4 chips to compare. You can also add chips from the Browse page.</p>
        )}
      </div>

      {/* Comparison table */}
      {comparison && compareList.length >= 1 && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-3 px-4 font-medium text-gray-400 w-48 sticky left-0 bg-gray-900 z-10">Attribute</th>
                  {compareList.map((c) => (
                    <th key={c.chip_model} className="text-left py-3 px-4 font-bold text-white min-w-[180px]">
                      <div>{c.chip_model}</div>
                      <div className="text-xs font-normal text-gray-500">{c._manufacturer}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* General section */}
                <SectionHeader label="General" open={!collapsedSections.has('general')} onClick={() => toggleSection('general')} colSpan={compareList.length + 1} />
                {!collapsedSections.has('general') &&
                  comparison.general.rows.map((row) => (
                    <CompareRow key={row.key} label={row.key} values={row.values} />
                  ))}

                {/* Per-section */}
                {comparison.sections.map((section) => {
                  if (section.rows.length === 0) return null;
                  const isOpen = !collapsedSections.has(section.name);
                  return (
                    <SectionGroup key={section.name}>
                      <SectionHeader
                        label={section.name.replace(/_/g, ' ')}
                        open={isOpen}
                        onClick={() => toggleSection(section.name)}
                        colSpan={compareList.length + 1}
                      />
                      {isOpen &&
                        section.rows.map((row) => (
                          <CompareRow key={row.key} label={row.key} values={row.values} />
                        ))}
                    </SectionGroup>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionGroup({ children }) {
  return <>{children}</>;
}

function SectionHeader({ label, open, onClick, colSpan }) {
  return (
    <tr
      className="bg-gray-800/60 cursor-pointer hover:bg-gray-800 transition-colors"
      onClick={onClick}
    >
      <td colSpan={colSpan} className="py-2 px-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-300 uppercase tracking-wider">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {label}
        </div>
      </td>
    </tr>
  );
}

function CompareRow({ label, values }) {
  // Color-code differences
  const getColor = (val, idx) => {
    if (values.length < 2) return 'text-gray-200';
    if (val === '—') return 'text-gray-600';
    if (val === 'Yes') return 'text-green-400';
    if (val === 'No') return 'text-red-400/60';

    // For numeric values, highlight the best
    const nums = values.map((v) => parseFloat(v)).filter((n) => !isNaN(n));
    if (nums.length >= 2) {
      const num = parseFloat(val);
      if (!isNaN(num)) {
        const max = Math.max(...nums);
        const min = Math.min(...nums);
        if (num === max && max !== min) return 'text-green-400 font-medium';
        if (num === min && max !== min) return 'text-red-400/80';
      }
    }
    return 'text-gray-200';
  };

  return (
    <tr className="border-t border-gray-800/40 hover:bg-gray-800/20">
      <td className="py-1.5 px-4 text-gray-400 text-xs truncate sticky left-0 bg-gray-900 z-10">
        {formatKey(label)}
      </td>
      {values.map((val, i) => (
        <td key={i} className={`py-1.5 px-4 text-sm ${getColor(val, i)}`}>
          {val}
        </td>
      ))}
    </tr>
  );
}

function formatKey(key) {
  return key
    .replace(/\./g, ' > ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
