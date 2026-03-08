/**
 * compare.js — Side-by-side chip comparison logic.
 * Port of Python compare.py
 */

const SECTIONS = [
  'connectivity', 'processing', 'memory', 'peripherals',
  'security', 'power_management', 'package', 'software_ecosystem', 'pricing',
];

/**
 * Flatten a nested object into [{ key, value }] pairs.
 */
export function flatten(obj, prefix = '') {
  const rows = [];
  if (!obj || typeof obj !== 'object') return rows;

  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('_')) continue;
    const label = prefix ? `${prefix}.${k}` : k;

    if (v === null || v === undefined) {
      rows.push({ key: label, value: '—' });
    } else if (typeof v === 'boolean') {
      rows.push({ key: label, value: v ? 'Yes' : 'No' });
    } else if (Array.isArray(v)) {
      rows.push({ key: label, value: v.length ? v.join(', ') : '—' });
    } else if (typeof v === 'object') {
      rows.push(...flatten(v, label));
    } else {
      rows.push({ key: label, value: String(v) });
    }
  }
  return rows;
}

/**
 * Compare multiple chips, returning structured comparison data.
 * @param {Object[]} chips - Array of chip objects
 * @param {string[]} [sections] - Optional sections to include
 * @returns {{ general: {rows}, sections: {name, rows}[] }}
 */
export function compareChips(chips, sections = null) {
  const activeSections = sections || SECTIONS;

  // General info
  const generalFields = ['chip_family', 'chip_model', 'status', 'release_year', 'target_applications'];
  const generalRows = generalFields.map((field) => ({
    key: field,
    values: chips.map((c) => {
      const v = c[field];
      if (Array.isArray(v)) return v.join(', ') || '—';
      return v != null ? String(v) : '—';
    }),
  }));

  // Section comparisons
  const sectionData = activeSections.map((section) => {
    // Collect all keys across all chips
    const allKeys = new Map();
    for (const chip of chips) {
      const sectionObj = chip[section];
      if (sectionObj && typeof sectionObj === 'object') {
        for (const { key } of flatten(sectionObj)) {
          allKeys.set(key, true);
        }
      }
    }

    const rows = [...allKeys.keys()].map((key) => ({
      key,
      values: chips.map((chip) => {
        const sectionObj = chip[section];
        if (!sectionObj || typeof sectionObj !== 'object') return '—';
        const flat = new Map(flatten(sectionObj).map((r) => [r.key, r.value]));
        return flat.get(key) || '—';
      }),
    }));

    return { name: section, rows };
  });

  return { general: { rows: generalRows }, sections: sectionData };
}

/**
 * Determine if a value difference is "better" for numeric comparisons.
 * Returns 1 (better), -1 (worse), 0 (equal/incomparable).
 */
export function compareValues(a, b) {
  const na = parseFloat(a);
  const nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb)) {
    if (na > nb) return 1;
    if (na < nb) return -1;
    return 0;
  }
  if (a === 'Yes' && b === 'No') return 1;
  if (a === 'No' && b === 'Yes') return -1;
  return 0;
}

export { SECTIONS };
