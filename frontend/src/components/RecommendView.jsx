import { useState, useMemo } from 'react';
import { Search, ArrowRight, Zap, AlertTriangle, CheckCircle, X } from 'lucide-react';
import { fuzzyFind, hasWifi, hasBle, hasThread, hasMatter, getCpuMhz, getSramKb, getArch, getWifiVersion, getBleVersion } from '../lib/chipData';
import { recommend, DEFAULT_WEIGHTS, extractFeatures } from '../lib/recommend';

export default function RecommendView({ data }) {
  const [search, setSearch] = useState('');
  const [selectedChip, setSelectedChip] = useState(null);
  const [topN, setTopN] = useState(5);
  const [weights, setWeights] = useState({ ...DEFAULT_WEIGHTS });

  const espChips = useMemo(() => data.allChips.filter((c) => c._file === 'espressif'), [data]);
  const nonEspChips = useMemo(() => data.allChips.filter((c) => c._file !== 'espressif'), [data]);

  const searchResults = useMemo(() => {
    if (!search) return [];
    return fuzzyFind(data.allChips, search).slice(0, 8);
  }, [data, search]);

  const recommendations = useMemo(() => {
    if (!selectedChip) return [];
    return recommend(selectedChip, espChips, { topN, weights });
  }, [selectedChip, espChips, topN, weights]);

  const selectChip = (chip) => {
    setSelectedChip(chip);
    setSearch('');
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl">
      <h2 className="text-xl md:text-2xl font-bold text-white mb-2">Find ESP Replacement</h2>
      <p className="text-gray-500 text-sm mb-6">Select a competitor chip to find the best Espressif alternative.</p>

      {/* Search */}
      <div className="relative mb-6 max-w-lg">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search for a competitor chip..."
          className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
            <X size={14} />
          </button>
        )}
        {searchResults.length > 0 && (
          <div className="absolute top-full mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-20 overflow-hidden">
            {searchResults.map((chip) => (
              <button
                key={`${chip._file}-${chip.chip_model}`}
                onClick={() => selectChip(chip)}
                className="w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-gray-700"
              >
                <span className="text-white font-medium">{chip.chip_model}</span>
                <span className="text-gray-500 text-xs">{chip._manufacturer}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Quick picks */}
      {!selectedChip && (
        <div className="mb-8">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Popular competitors:</p>
          <div className="flex flex-wrap gap-2">
            {['nRF52840', 'nRF5340', 'BL616', 'CC2652R', 'STM32WBA55', 'SiWx917', 'RW612', 'RTL8720DN'].map((name) => {
              const chip = data.chipsByModel.get(name.toUpperCase());
              if (!chip) return null;
              return (
                <button
                  key={name}
                  onClick={() => selectChip(chip)}
                  className="text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg transition-colors"
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Target chip summary + Recommendations */}
      {selectedChip && (
        <>
          {/* Target card */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-lg font-bold text-white">{selectedChip.chip_model}</h3>
                <p className="text-sm text-gray-400">{selectedChip._manufacturer}</p>
              </div>
              <button
                onClick={() => setSelectedChip(null)}
                className="text-sm text-gray-500 hover:text-white px-3 py-1 rounded-lg hover:bg-gray-800"
              >
                Change
              </button>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <Spec label="Architecture" value={getArch(selectedChip)} />
              <Spec label="CPU" value={`${getCpuMhz(selectedChip)}MHz`} />
              <Spec label="SRAM" value={`${getSramKb(selectedChip)}KB`} />
              <Spec label="WiFi" value={getWifiVersion(selectedChip) || '—'} highlight={hasWifi(selectedChip)} />
              <Spec label="BLE" value={getBleVersion(selectedChip) || '—'} highlight={hasBle(selectedChip)} />
              <Spec label="Thread" value={hasThread(selectedChip) ? 'Yes' : '—'} highlight={hasThread(selectedChip)} />
              <Spec label="Matter" value={hasMatter(selectedChip) ? 'Yes' : '—'} highlight={hasMatter(selectedChip)} />
            </div>
          </div>

          {/* Arrow */}
          <div className="flex items-center gap-2 mb-6 text-gray-500">
            <ArrowRight size={16} />
            <span className="text-sm">Best Espressif replacements:</span>
          </div>

          {/* Results */}
          <div className="space-y-4">
            {recommendations.map((rec, idx) => (
              <div
                key={rec.chip.chip_model}
                className={`bg-gray-900 rounded-xl border p-5 ${
                  idx === 0 ? 'border-blue-500/40' : 'border-gray-800'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold text-gray-600">#{idx + 1}</span>
                    <div>
                      <h4 className="text-lg font-bold text-white">{rec.chip.chip_model}</h4>
                      <p className="text-xs text-gray-500">{rec.chip.status} &middot; {getArch(rec.chip)}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-blue-400">{rec.score}%</div>
                    <div className="text-xs text-gray-500">match</div>
                  </div>
                </div>

                {/* Score bar */}
                <div className="w-full bg-gray-800 rounded-full h-2 mb-3">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all"
                    style={{ width: `${Math.min(rec.score, 100)}%` }}
                  />
                </div>

                {/* Specs */}
                <div className="flex flex-wrap gap-3 text-sm mb-3">
                  <Spec label="CPU" value={`${getCpuMhz(rec.chip)}MHz`} />
                  <Spec label="SRAM" value={`${getSramKb(rec.chip)}KB`} />
                  <Spec label="WiFi" value={getWifiVersion(rec.chip) || '—'} highlight={hasWifi(rec.chip)} />
                  <Spec label="BLE" value={getBleVersion(rec.chip) || '—'} highlight={hasBle(rec.chip)} />
                  <Spec label="Thread" value={hasThread(rec.chip) ? 'Yes' : '—'} highlight={hasThread(rec.chip)} />
                  <Spec label="Matter" value={hasMatter(rec.chip) ? 'Yes' : '—'} highlight={hasMatter(rec.chip)} />
                </div>

                {/* Advantages & Gaps */}
                <div className="flex flex-wrap gap-4 text-xs">
                  {rec.advantages.length > 0 && (
                    <div className="flex items-start gap-1.5">
                      <CheckCircle size={14} className="text-green-400 mt-0.5 shrink-0" />
                      <span className="text-green-400">
                        <strong>Advantages:</strong> {rec.advantages.join(', ')}
                      </span>
                    </div>
                  )}
                  {rec.gaps.length > 0 && (
                    <div className="flex items-start gap-1.5">
                      <AlertTriangle size={14} className="text-yellow-400 mt-0.5 shrink-0" />
                      <span className="text-yellow-400">
                        <strong>Gaps:</strong> {rec.gaps.join(', ')}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Spec({ label, value, highlight }) {
  return (
    <div>
      <span className="text-gray-500 text-xs">{label}: </span>
      <span className={highlight ? 'text-green-400 font-medium' : 'text-gray-300'}>{value}</span>
    </div>
  );
}
