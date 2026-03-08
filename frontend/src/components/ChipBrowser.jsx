import { useState, useMemo } from 'react';
import { Search, Plus, Minus, ChevronUp, ChevronDown, X } from 'lucide-react';
import { fuzzyFind, filterChips, hasWifi, hasBle, hasThread, hasMatter, getCpuMhz, getSramKb, getArch } from '../lib/chipData';
import ChipDetail from './ChipDetail';

const SORT_KEYS = {
  chip_model: (c) => c.chip_model,
  _manufacturer: (c) => c._manufacturer,
  cpu: (c) => getCpuMhz(c),
  sram: (c) => getSramKb(c),
  status: (c) => c.status || '',
};

export default function ChipBrowser({ data, compareList, setCompareList }) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({});
  const [sortKey, setSortKey] = useState('_manufacturer');
  const [sortAsc, setSortAsc] = useState(true);
  const [selectedChip, setSelectedChip] = useState(null);

  const filteredChips = useMemo(() => {
    let chips = search ? fuzzyFind(data.allChips, search) : data.allChips;
    chips = filterChips(chips, filters);

    const accessor = SORT_KEYS[sortKey] || SORT_KEYS.chip_model;
    chips = [...chips].sort((a, b) => {
      const va = accessor(a);
      const vb = accessor(b);
      if (typeof va === 'number' && typeof vb === 'number') return sortAsc ? va - vb : vb - va;
      return sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });

    return chips;
  }, [data, search, filters, sortKey, sortAsc]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const toggleCompare = (chip) => {
    const key = chip.chip_model;
    if (compareList.some((c) => c.chip_model === key)) {
      setCompareList(compareList.filter((c) => c.chip_model !== key));
    } else if (compareList.length < 4) {
      setCompareList([...compareList, chip]);
    }
  };

  const isInCompare = (chip) => compareList.some((c) => c.chip_model === chip.chip_model);

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return null;
    return sortAsc ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
  };

  const manufacturers = useMemo(() => [...data.chipsByManufacturer.keys()].sort(), [data]);

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h2 className="text-2xl font-bold text-white">Chip Browser</h2>
        <span className="text-sm text-gray-500">{filteredChips.length} of {data.allChips.length} chips</span>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chips, manufacturers..."
            className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
              <X size={14} />
            </button>
          )}
        </div>

        <select
          value={filters.manufacturer || ''}
          onChange={(e) => setFilters({ ...filters, manufacturer: e.target.value || undefined })}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
        >
          <option value="">All Manufacturers</option>
          {manufacturers.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        <FilterToggle label="WiFi" active={filters.wifi} onClick={() => setFilters({ ...filters, wifi: !filters.wifi })} />
        <FilterToggle label="BLE" active={filters.ble} onClick={() => setFilters({ ...filters, ble: !filters.ble })} />
        <FilterToggle label="Thread" active={filters.thread} onClick={() => setFilters({ ...filters, thread: !filters.thread })} />
        <FilterToggle label="Matter" active={filters.matter} onClick={() => setFilters({ ...filters, matter: !filters.matter })} />
      </div>

      {/* Table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400">
                <th className="w-10 py-3 px-3"></th>
                <ThSort label="Model" col="chip_model" sortKey={sortKey} onClick={toggleSort}><SortIcon col="chip_model" /></ThSort>
                <ThSort label="Manufacturer" col="_manufacturer" sortKey={sortKey} onClick={toggleSort}><SortIcon col="_manufacturer" /></ThSort>
                <th className="py-3 px-3 text-left font-medium hidden md:table-cell">Architecture</th>
                <ThSort label="MHz" col="cpu" sortKey={sortKey} onClick={toggleSort}><SortIcon col="cpu" /></ThSort>
                <ThSort label="SRAM (KB)" col="sram" sortKey={sortKey} onClick={toggleSort}><SortIcon col="sram" /></ThSort>
                <th className="py-3 px-2 text-center font-medium">WiFi</th>
                <th className="py-3 px-2 text-center font-medium">BLE</th>
                <th className="py-3 px-2 text-center font-medium hidden lg:table-cell">Thread</th>
                <th className="py-3 px-2 text-center font-medium hidden lg:table-cell">Matter</th>
                <ThSort label="Status" col="status" sortKey={sortKey} onClick={toggleSort}><SortIcon col="status" /></ThSort>
              </tr>
            </thead>
            <tbody>
              {filteredChips.map((chip) => (
                <tr
                  key={`${chip._file}-${chip.chip_model}`}
                  className="border-t border-gray-800/50 hover:bg-gray-800/40 cursor-pointer transition-colors"
                  onClick={() => setSelectedChip(chip)}
                >
                  <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => toggleCompare(chip)}
                      className={`p-1 rounded transition-colors ${
                        isInCompare(chip)
                          ? 'text-blue-400 bg-blue-500/20 hover:bg-blue-500/30'
                          : 'text-gray-600 hover:text-gray-300 hover:bg-gray-700'
                      }`}
                      title={isInCompare(chip) ? 'Remove from compare' : 'Add to compare'}
                    >
                      {isInCompare(chip) ? <Minus size={14} /> : <Plus size={14} />}
                    </button>
                  </td>
                  <td className="py-2 px-3 text-white font-medium">{chip.chip_model}</td>
                  <td className="py-2 px-3 text-gray-300">{chip._manufacturer}</td>
                  <td className="py-2 px-3 text-gray-400 text-xs hidden md:table-cell">{getArch(chip)}</td>
                  <td className="py-2 px-3 text-gray-300 text-right">{getCpuMhz(chip) || '—'}</td>
                  <td className="py-2 px-3 text-gray-300 text-right">{getSramKb(chip) || '—'}</td>
                  <td className="py-2 px-2 text-center">{hasWifi(chip) ? <Dot color="green" /> : <Dot />}</td>
                  <td className="py-2 px-2 text-center">{hasBle(chip) ? <Dot color="cyan" /> : <Dot />}</td>
                  <td className="py-2 px-2 text-center hidden lg:table-cell">{hasThread(chip) ? <Dot color="purple" /> : <Dot />}</td>
                  <td className="py-2 px-2 text-center hidden lg:table-cell">{hasMatter(chip) ? <Dot color="yellow" /> : <Dot />}</td>
                  <td className="py-2 px-3">
                    <StatusBadge status={chip.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Modal */}
      {selectedChip && (
        <ChipDetail chip={selectedChip} onClose={() => setSelectedChip(null)} />
      )}
    </div>
  );
}

function ThSort({ label, col, sortKey, onClick, children }) {
  return (
    <th
      className={`py-3 px-3 text-left font-medium cursor-pointer hover:text-white transition-colors ${
        sortKey === col ? 'text-blue-400' : ''
      }`}
      onClick={() => onClick(col)}
    >
      <span className="flex items-center gap-1">{label}{children}</span>
    </th>
  );
}

function FilterToggle({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
        active
          ? 'bg-blue-600/20 border-blue-500 text-blue-400'
          : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500'
      }`}
    >
      {label}
    </button>
  );
}

function Dot({ color }) {
  const colors = {
    green: 'bg-green-400',
    cyan: 'bg-cyan-400',
    purple: 'bg-purple-400',
    yellow: 'bg-yellow-400',
  };
  return (
    <span className={`inline-block w-2.5 h-2.5 rounded-full ${colors[color] || 'bg-gray-700'}`} />
  );
}

function StatusBadge({ status }) {
  const styles = {
    active: 'bg-green-500/15 text-green-400',
    preview: 'bg-blue-500/15 text-blue-400',
    announced: 'bg-yellow-500/15 text-yellow-400',
    nrnd: 'bg-orange-500/15 text-orange-400',
    obsolete: 'bg-red-500/15 text-red-400',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${styles[status] || 'bg-gray-700 text-gray-400'}`}>
      {status || '—'}
    </span>
  );
}
