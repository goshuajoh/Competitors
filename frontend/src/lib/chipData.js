/**
 * chipData.js — Load, index, and search the chip knowledge graph.
 * All 16 manufacturer JSON files are fetched client-side (~214KB total).
 */

const MANUFACTURER_FILES = [
  'espressif', 'silicon_labs', 'nordic', 'stmicroelectronics',
  'texas_instruments', 'nxp', 'infineon', 'mediatek', 'realtek',
  'bouffalo_lab', 'intel', 'winnermicro', 'beken', 'telink', 'wch', 'luat',
];

let _cache = null;

/**
 * Load all chip data. Returns cached result on subsequent calls.
 */
export async function loadAllChipData() {
  if (_cache) return _cache;

  const results = await Promise.all(
    MANUFACTURER_FILES.map(async (name) => {
      const resp = await fetch(`/data/${name}.json`);
      const data = await resp.json();
      return { file: name, ...data };
    })
  );

  const chipsByModel = new Map();
  const chipsByManufacturer = new Map();
  const allChips = [];

  for (const mfrData of results) {
    const mfr = mfrData.manufacturer || mfrData.file;
    const country = mfrData.manufacturer_country || '';
    const chips = mfrData.chips || [];

    const mfrChips = [];
    for (const chip of chips) {
      const enriched = {
        ...chip,
        _manufacturer: mfr,
        _country: country,
        _file: mfrData.file,
      };
      chipsByModel.set(chip.chip_model.toUpperCase(), enriched);
      mfrChips.push(enriched);
      allChips.push(enriched);
    }
    chipsByManufacturer.set(mfr, mfrChips);
  }

  _cache = { chipsByModel, chipsByManufacturer, allChips, manufacturers: results };
  return _cache;
}

/**
 * Fuzzy-find chips by partial model name match.
 */
export function fuzzyFind(allChips, query) {
  if (!query) return allChips;
  const q = query.toUpperCase().trim();
  return allChips.filter(
    (c) =>
      c.chip_model.toUpperCase().includes(q) ||
      c._manufacturer.toUpperCase().includes(q) ||
      (c.chip_family || '').toUpperCase().includes(q)
  );
}

/**
 * Multi-criteria filter.
 */
export function filterChips(allChips, filters = {}) {
  return allChips.filter((chip) => {
    const conn = chip.connectivity || {};
    const proc = chip.processing || {};
    const mem = chip.memory || {};

    if (filters.wifi && !(conn.wifi && typeof conn.wifi === 'object' && conn.wifi.supported))
      return false;
    if (filters.ble && !(conn.bluetooth && typeof conn.bluetooth === 'object' && conn.bluetooth.supported))
      return false;
    if (filters.thread) {
      const ieee = conn.ieee802154;
      if (!ieee || !ieee.supported) return false;
      const protos = ieee.protocols || [];
      if (!protos.some((p) => p.toLowerCase().includes('thread'))) return false;
    }
    if (filters.matter && !conn.matter_support) return false;
    if (filters.arch && proc.instruction_set !== filters.arch) return false;
    if (filters.minMhz && (proc.max_clock_mhz || 0) < filters.minMhz) return false;
    if (filters.minSram && (mem.sram_kb || 0) < filters.minSram) return false;
    if (filters.manufacturer && chip._manufacturer !== filters.manufacturer) return false;
    if (filters.status && chip.status !== filters.status) return false;

    return true;
  });
}

// ── Helper accessors ──────────────────────────────────────────────────
export function hasWifi(chip) {
  const w = chip?.connectivity?.wifi;
  return w && typeof w === 'object' && w.supported;
}

export function hasBle(chip) {
  const b = chip?.connectivity?.bluetooth;
  return b && typeof b === 'object' && b.supported;
}

export function hasThread(chip) {
  const i = chip?.connectivity?.ieee802154;
  if (!i || !i.supported) return false;
  return (i.protocols || []).some((p) => p.toLowerCase().includes('thread'));
}

export function hasZigbee(chip) {
  const i = chip?.connectivity?.ieee802154;
  if (!i || !i.supported) return false;
  return (i.protocols || []).some((p) => p.toLowerCase().includes('zigbee'));
}

export function hasMatter(chip) {
  return !!chip?.connectivity?.matter_support;
}

export function getWifiVersion(chip) {
  const w = chip?.connectivity?.wifi;
  if (w && typeof w === 'object' && w.supported) return w.version || 'Yes';
  return null;
}

export function getBleVersion(chip) {
  const b = chip?.connectivity?.bluetooth;
  if (b && typeof b === 'object' && b.supported) return b.version || 'Yes';
  return null;
}

export function getCpuMhz(chip) {
  return chip?.processing?.max_clock_mhz || 0;
}

export function getSramKb(chip) {
  return chip?.memory?.sram_kb || 0;
}

export function getFlashKb(chip) {
  return chip?.memory?.internal_flash_kb || 0;
}

export function getArch(chip) {
  return chip?.processing?.cpu_architecture || 'Unknown';
}

export function getCores(chip) {
  return chip?.processing?.cores || 0;
}
