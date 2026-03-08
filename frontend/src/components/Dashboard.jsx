import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Cpu, Wifi, Bluetooth, Shield, Radio, Zap } from 'lucide-react';
import { landscapeSummary, analyzeManufacturer } from '../lib/analyze';
import { hasWifi, hasBle, hasThread, hasMatter } from '../lib/chipData';

const COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
  '#84cc16', '#e11d48', '#0ea5e9', '#a855f7', '#eab308', '#64748b',
];

const THREAT_COLORS = { high: 'text-red-400', medium: 'text-yellow-400', low: 'text-green-400' };
const THREAT_BG = { high: 'bg-red-500/10', medium: 'bg-yellow-500/10', low: 'bg-green-500/10' };

export default function Dashboard({ data }) {
  const summary = useMemo(() => landscapeSummary(data.allChips), [data]);

  const espChips = useMemo(() => data.allChips.filter((c) => c._file === 'espressif'), [data]);

  const threatReports = useMemo(() => {
    const reports = [];
    for (const [mfr, chips] of data.chipsByManufacturer.entries()) {
      if (chips[0]?._file === 'espressif') continue;
      reports.push(analyzeManufacturer(mfr, chips, espChips));
    }
    reports.sort((a, b) => {
      const order = { high: 3, medium: 2, low: 1 };
      return (order[b.threatLevel] || 0) - (order[a.threatLevel] || 0);
    });
    return reports;
  }, [data, espChips]);

  // Charts data
  const mfrChartData = useMemo(() =>
    [...data.chipsByManufacturer.entries()]
      .map(([name, chips]) => ({
        name: name.length > 15 ? name.slice(0, 13) + '...' : name,
        fullName: name,
        chips: chips.length,
        isEsp: chips[0]?._file === 'espressif',
      }))
      .sort((a, b) => b.chips - a.chips),
    [data]
  );

  const archData = useMemo(() =>
    Object.entries(summary.architectures)
      .map(([name, count]) => ({ name: name.length > 20 ? name.slice(0, 18) + '...' : name, value: count }))
      .sort((a, b) => b.value - a.value),
    [summary]
  );

  const protocolData = useMemo(() =>
    Object.entries(summary.protocols).map(([name, { esp, comp }]) => ({
      name,
      Espressif: esp,
      Competitors: comp,
    })),
    [summary]
  );

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <h2 className="text-xl md:text-2xl font-bold text-white mb-6">Competitive Landscape Dashboard</h2>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard icon={Cpu} label="Total Chips" value={summary.totalChips} sub={`${summary.manufacturerCount} manufacturers`} color="text-blue-400" />
        <StatCard icon={Wifi} label="WiFi Chips" value={summary.protocols.WiFi.esp + summary.protocols.WiFi.comp} sub={`ESP: ${summary.protocols.WiFi.esp}`} color="text-green-400" />
        <StatCard icon={Bluetooth} label="BLE Chips" value={summary.protocols.BLE.esp + summary.protocols.BLE.comp} sub={`ESP: ${summary.protocols.BLE.esp}`} color="text-cyan-400" />
        <StatCard icon={Radio} label="Thread Chips" value={summary.protocols.Thread.esp + summary.protocols.Thread.comp} sub={`ESP: ${summary.protocols.Thread.esp}`} color="text-purple-400" />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Chips per manufacturer */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Chips per Manufacturer</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={mfrChartData} layout="vertical" margin={{ left: 10 }}>
              <XAxis type="number" stroke="#6b7280" fontSize={12} />
              <YAxis type="category" dataKey="name" stroke="#6b7280" fontSize={11} width={110} />
              <Tooltip
                contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 13 }}
                labelFormatter={(_, payload) => payload[0]?.payload?.fullName || ''}
              />
              <Bar dataKey="chips" radius={[0, 4, 4, 0]}>
                {mfrChartData.map((entry, i) => (
                  <Cell key={i} fill={entry.isEsp ? '#3b82f6' : '#6b7280'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Protocol coverage */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Protocol Coverage: ESP vs Competitors</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={protocolData}>
              <XAxis dataKey="name" stroke="#6b7280" fontSize={12} />
              <YAxis stroke="#6b7280" fontSize={12} />
              <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 13 }} />
              <Bar dataKey="Espressif" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Competitors" fill="#6b7280" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Architecture + Threats Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Architecture pie */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">CPU Architecture Distribution</h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={archData}
                cx="50%" cy="50%"
                outerRadius={100}
                dataKey="value"
                label={({ name, value }) => `${name} (${value})`}
                labelLine={false}
                fontSize={11}
              >
                {archData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 13 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Threat rankings */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Competitor Threat Ranking</h3>
          <div className="space-y-2 max-h-[280px] overflow-y-auto">
            {threatReports.map((r) => (
              <div key={r.manufacturer} className={`flex items-center justify-between px-3 py-2 rounded-lg ${THREAT_BG[r.threatLevel]}`}>
                <div>
                  <span className="text-sm text-white font-medium">{r.manufacturer}</span>
                  <span className="text-xs text-gray-500 ml-2">{r.chipCount} chips</span>
                </div>
                <span className={`text-xs font-bold uppercase ${THREAT_COLORS[r.threatLevel]}`}>
                  {r.threatLevel}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Protocol Heatmap */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">Protocol Support Heatmap</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400">
                <th className="text-left py-2 px-3 font-medium">Manufacturer</th>
                <th className="text-center py-2 px-2 font-medium">Chips</th>
                <th className="text-center py-2 px-2 font-medium">WiFi</th>
                <th className="text-center py-2 px-2 font-medium">BLE</th>
                <th className="text-center py-2 px-2 font-medium">Thread</th>
                <th className="text-center py-2 px-2 font-medium">Matter</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(summary.manufacturers)
                .sort((a, b) => b[1].count - a[1].count)
                .map(([mfr, stats]) => (
                  <tr key={mfr} className="border-t border-gray-800 hover:bg-gray-800/50">
                    <td className="py-2 px-3 text-white font-medium">{mfr}</td>
                    <td className="text-center py-2 px-2 text-gray-300">{stats.count}</td>
                    <td className="text-center py-2 px-2">{stats.wifi > 0 ? <span className="text-green-400 font-bold">{stats.wifi}</span> : <span className="text-gray-700">—</span>}</td>
                    <td className="text-center py-2 px-2">{stats.ble > 0 ? <span className="text-cyan-400 font-bold">{stats.ble}</span> : <span className="text-gray-700">—</span>}</td>
                    <td className="text-center py-2 px-2">{stats.thread > 0 ? <span className="text-purple-400 font-bold">{stats.thread}</span> : <span className="text-gray-700">—</span>}</td>
                    <td className="text-center py-2 px-2">{stats.matter > 0 ? <span className="text-yellow-400 font-bold">{stats.matter}</span> : <span className="text-gray-700">—</span>}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
      <div className="flex items-center gap-3 mb-2">
        <Icon size={20} className={color} />
        <span className="text-sm text-gray-400">{label}</span>
      </div>
      <p className="text-2xl md:text-3xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}
