/**
 * analyze.js — Competitive analysis engine.
 * Port of Python analyze.py
 */

import { hasWifi, hasBle, hasThread, hasZigbee, hasMatter, getCpuMhz, getSramKb, getArch } from './chipData';

function hasUsb(chip) {
  const u = chip?.peripherals?.usb;
  return u && typeof u === 'object' && u.supported;
}

function hasCamera(chip) {
  return !!chip?.peripherals?.camera_interface;
}

function hasSecureBoot(chip) {
  return !!chip?.security?.secure_boot;
}

function hasTee(chip) {
  const sec = chip?.security || {};
  return sec.tee || sec.arm_trustzone;
}

function getWifiVersion(chip) {
  const w = chip?.connectivity?.wifi;
  if (w && typeof w === 'object' && w.supported) return String(w.version || '');
  return '';
}

/**
 * Analyze one manufacturer against Espressif.
 */
export function analyzeManufacturer(mfrName, mfrChips, espChips) {
  const report = {
    manufacturer: mfrName,
    chipCount: mfrChips.length,
    strengths: [],
    weaknesses: [],
    uniqueFeatures: [],
    headToHead: [],
    threatLevel: 'low',
  };

  const mfrMaxMhz = Math.max(...mfrChips.map(getCpuMhz), 0);
  const mfrMaxSram = Math.max(...mfrChips.map(getSramKb), 0);
  const espMaxMhz = Math.max(...espChips.map(getCpuMhz), 0);
  const espMaxSram = Math.max(...espChips.map(getSramKb), 0);

  const mfrHasWifi = mfrChips.some(hasWifi);
  const mfrHasBle = mfrChips.some(hasBle);
  const mfrHasThread = mfrChips.some(hasThread);
  const mfrHasMatter = mfrChips.some(hasMatter);
  const mfrHasTee = mfrChips.some(hasTee);
  const mfrHasCam = mfrChips.some(hasCamera);

  const espHasWifi = espChips.some(hasWifi);
  const espHasMatter = espChips.some(hasMatter);
  const espHasCam = espChips.some(hasCamera);

  // Strengths
  if (mfrMaxMhz > espMaxMhz)
    report.strengths.push(`Higher max CPU speed (${mfrMaxMhz}MHz vs ESP ${espMaxMhz}MHz)`);
  if (mfrMaxSram > espMaxSram)
    report.strengths.push(`More SRAM (${mfrMaxSram}KB vs ESP ${espMaxSram}KB)`);
  if (mfrHasTee && !espChips.some(hasTee))
    report.strengths.push('TrustZone / TEE security');
  if (mfrChips.some((c) => getWifiVersion(c).includes('6')))
    report.strengths.push('WiFi 6/6E capable chips');

  // Weaknesses
  if (espHasWifi && !mfrHasWifi)
    report.weaknesses.push('No integrated WiFi (ESP advantage)');
  if (espHasMatter && !mfrHasMatter)
    report.weaknesses.push('No Matter support');
  if (espHasCam && !mfrHasCam)
    report.weaknesses.push('No camera interface');
  if (espMaxMhz > mfrMaxMhz)
    report.weaknesses.push(`Lower max CPU speed (${mfrMaxMhz}MHz vs ESP ${espMaxMhz}MHz)`);
  if (espMaxSram > mfrMaxSram)
    report.weaknesses.push(`Less SRAM (${mfrMaxSram}KB vs ESP ${espMaxSram}KB)`);

  // Head-to-head
  for (const mc of mfrChips) {
    if (!hasWifi(mc) && !hasBle(mc)) continue;
    let bestEsp = null;
    let bestOverlap = 0;
    for (const ec of espChips) {
      let overlap = 0;
      if (hasWifi(mc) && hasWifi(ec)) overlap += 2;
      if (hasBle(mc) && hasBle(ec)) overlap += 2;
      if (hasThread(mc) && hasThread(ec)) overlap += 1;
      if (hasMatter(mc) && hasMatter(ec)) overlap += 1;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestEsp = ec;
      }
    }
    if (bestEsp) {
      report.headToHead.push({
        competitor: mc.chip_model,
        espressifMatch: bestEsp.chip_model,
        overlapScore: bestOverlap,
      });
    }
  }

  // Unique features
  for (const chip of mfrChips) {
    const other = chip?.peripherals?.other || [];
    for (const feat of other) {
      if (feat && feat.length > 5) {
        report.uniqueFeatures.push(`${chip.chip_model}: ${feat}`);
      }
    }
  }

  // Threat level
  let threat = 0;
  if (mfrHasWifi) threat += 3;
  if (mfrHasBle) threat += 2;
  if (mfrHasThread) threat += 2;
  if (mfrHasMatter) threat += 2;
  if (mfrMaxMhz > espMaxMhz) threat += 1;
  if (mfrChips.length > 3) threat += 1;

  report.threatLevel = threat >= 8 ? 'high' : threat >= 5 ? 'medium' : 'low';

  return report;
}

/**
 * Generate landscape summary across all manufacturers.
 */
export function landscapeSummary(allChips) {
  const espChips = allChips.filter((c) => c._file === 'espressif');
  const compChips = allChips.filter((c) => c._file !== 'espressif');

  const protocols = {
    WiFi: { esp: espChips.filter(hasWifi).length, comp: compChips.filter(hasWifi).length },
    BLE: { esp: espChips.filter(hasBle).length, comp: compChips.filter(hasBle).length },
    Thread: { esp: espChips.filter(hasThread).length, comp: compChips.filter(hasThread).length },
    Zigbee: { esp: espChips.filter(hasZigbee).length, comp: compChips.filter(hasZigbee).length },
    Matter: { esp: espChips.filter(hasMatter).length, comp: compChips.filter(hasMatter).length },
  };

  // Architecture distribution
  const archCounts = {};
  for (const c of allChips) {
    const arch = getArch(c);
    archCounts[arch] = (archCounts[arch] || 0) + 1;
  }

  // Per-manufacturer stats
  const mfrStats = {};
  for (const c of allChips) {
    const mfr = c._manufacturer;
    if (!mfrStats[mfr]) mfrStats[mfr] = { count: 0, wifi: 0, ble: 0, thread: 0, matter: 0 };
    mfrStats[mfr].count++;
    if (hasWifi(c)) mfrStats[mfr].wifi++;
    if (hasBle(c)) mfrStats[mfr].ble++;
    if (hasThread(c)) mfrStats[mfr].thread++;
    if (hasMatter(c)) mfrStats[mfr].matter++;
  }

  return {
    totalChips: allChips.length,
    espressifCount: espChips.length,
    competitorCount: compChips.length,
    manufacturerCount: Object.keys(mfrStats).length,
    protocols,
    architectures: archCounts,
    manufacturers: mfrStats,
  };
}

/**
 * Analyze a market segment.
 */
export function analyzeSegment(segment, allChips) {
  const matches = allChips.filter((c) =>
    (c.target_applications || []).some((a) => a.toLowerCase().includes(segment.toLowerCase()))
  );

  const byMfr = {};
  for (const c of matches) {
    if (!byMfr[c._manufacturer]) byMfr[c._manufacturer] = [];
    byMfr[c._manufacturer].push(c.chip_model);
  }

  return {
    segment,
    totalChips: matches.length,
    manufacturers: byMfr,
    chips: matches.map((c) => ({
      model: c.chip_model,
      manufacturer: c._manufacturer,
      wifi: hasWifi(c),
      ble: hasBle(c),
      thread: hasThread(c),
      cpuMhz: getCpuMhz(c),
      sramKb: getSramKb(c),
    })),
  };
}
