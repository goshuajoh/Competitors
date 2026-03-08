/**
 * recommend.js — Given a competitor chip, find the best Espressif replacement.
 * Port of Python recommend.py
 */

const DEFAULT_WEIGHTS = {
  wifi: 3.0,
  bluetooth: 3.0,
  thread_zigbee: 2.5,
  matter: 2.0,
  cpu_speed: 1.5,
  cpu_cores: 1.0,
  sram: 2.0,
  flash: 1.5,
  gpio: 1.0,
  usb: 1.5,
  security: 2.0,
  low_power: 1.5,
  camera: 1.0,
  adc_channels: 0.5,
};

/**
 * Extract normalized feature scores (0-3 scale) from a chip.
 */
export function extractFeatures(chip) {
  const f = {};
  const conn = chip.connectivity || {};
  const proc = chip.processing || {};
  const mem = chip.memory || {};
  const periph = chip.peripherals || {};
  const sec = chip.security || {};
  const pwr = chip.power_management || {};

  // WiFi (0-3)
  const wifi = conn.wifi;
  if (wifi && typeof wifi === 'object' && wifi.supported) {
    const ver = String(wifi.version || '').toLowerCase();
    if (ver.includes('7')) f.wifi = 3.0;
    else if (ver.includes('6e') || ver.includes('6')) f.wifi = 2.5;
    else if (ver.includes('5')) f.wifi = 2.0;
    else if (ver.includes('4')) f.wifi = 1.5;
    else f.wifi = 1.0;
  } else {
    f.wifi = 0;
  }

  // Bluetooth (0-3)
  const bt = conn.bluetooth;
  if (bt && typeof bt === 'object' && bt.supported) {
    const ver = String(bt.version || '5.0');
    if (ver.includes('6')) f.bluetooth = 3.0;
    else if (ver.includes('5.4') || ver.includes('5.3')) f.bluetooth = 2.5;
    else if (ver.includes('5.2') || ver.includes('5.1')) f.bluetooth = 2.0;
    else if (ver.includes('5')) f.bluetooth = 1.5;
    else f.bluetooth = 1.0;
  } else {
    f.bluetooth = 0;
  }

  // Thread / Zigbee
  const ieee = conn.ieee802154;
  if (ieee && typeof ieee === 'object' && ieee.supported) {
    let score = 1.0;
    const protos = ieee.protocols || [];
    if (protos.some((p) => p.toLowerCase().includes('thread'))) score += 0.5;
    if (protos.some((p) => p.toLowerCase().includes('zigbee'))) score += 0.5;
    f.thread_zigbee = score;
  } else {
    f.thread_zigbee = 0;
  }

  f.matter = conn.matter_support ? 1.0 : 0;

  // CPU speed
  const clk = proc.max_clock_mhz;
  f.cpu_speed = clk ? Math.min(clk / 300, 3.0) : 0;

  // Cores
  const cores = proc.cores;
  f.cpu_cores = cores ? Math.min(cores / 2, 3.0) : 0;

  // SRAM
  const sram = mem.sram_kb;
  f.sram = sram ? Math.min(sram / 256, 3.0) : 0;

  // Flash
  const flash = mem.internal_flash_kb;
  f.flash = flash ? Math.min(flash / 2048, 3.0) : 0;

  // GPIO
  const gpio = periph.gpio_count;
  f.gpio = gpio ? Math.min(gpio / 30, 3.0) : 0;

  // USB
  const usb = periph.usb;
  if (usb && typeof usb === 'object' && usb.supported) {
    const t = String(usb.type || '').toLowerCase();
    if (t.includes('high') || t.includes('hs')) f.usb = 2.0;
    else if (t.includes('otg')) f.usb = 1.5;
    else f.usb = 1.0;
  } else {
    f.usb = 0;
  }

  // Security
  let secScore = 0;
  if (sec.secure_boot) secScore += 0.5;
  if (sec.flash_encryption) secScore += 0.5;
  if (sec.crypto_accelerator) secScore += 0.5;
  if (sec.tee || sec.arm_trustzone) secScore += 0.5;
  if (sec.psa_certified) secScore += 0.5;
  if (sec.secure_element) secScore += 0.5;
  f.security = Math.min(secScore, 3.0);

  // Low power
  const ds = pwr.deep_sleep_ua;
  if (ds != null) {
    if (ds <= 5) f.low_power = 3.0;
    else if (ds <= 10) f.low_power = 2.5;
    else if (ds <= 25) f.low_power = 2.0;
    else if (ds <= 100) f.low_power = 1.0;
    else f.low_power = 0.5;
  } else {
    f.low_power = 0;
  }

  f.camera = periph.camera_interface ? 1.0 : 0;

  const adc = periph.adc;
  f.adc_channels = adc && typeof adc === 'object' && adc.channels ? Math.min(adc.channels / 6, 3.0) : 0;

  return f;
}

/**
 * Compute weighted similarity score (0-100).
 */
export function computeSimilarity(targetFeats, candidateFeats, weights = DEFAULT_WEIGHTS) {
  let score = 0;
  let maxScore = 0;

  for (const [key, weight] of Object.entries(weights)) {
    const t = targetFeats[key] || 0;
    const c = candidateFeats[key] || 0;
    if (t === 0 && c === 0) continue;

    maxScore += weight * 3.0;

    if (t > 0) {
      const matchRatio = t > 0 ? Math.min(c / t, 1.5) : 0;
      score += weight * matchRatio * t;
    } else {
      score += weight * c * 0.3;
    }
  }

  return maxScore > 0 ? (score / maxScore) * 100 : 0;
}

/**
 * Find top-N Espressif replacements for a target chip.
 */
export function recommend(targetChip, espChips, { topN = 3, weights = DEFAULT_WEIGHTS } = {}) {
  const targetFeats = extractFeatures(targetChip);

  const results = espChips.map((esp) => {
    const espFeats = extractFeatures(esp);
    const score = computeSimilarity(targetFeats, espFeats, weights);

    // Find advantages and gaps
    const advantages = [];
    const gaps = [];
    for (const key of Object.keys(targetFeats)) {
      const tv = targetFeats[key] || 0;
      const ev = espFeats[key] || 0;
      if (ev > tv && tv > 0) advantages.push(key.replace(/_/g, ' '));
      if (tv > ev && tv > 0 && ev === 0) gaps.push(key.replace(/_/g, ' '));
    }

    return { chip: esp, score: Math.round(score * 10) / 10, features: espFeats, advantages, gaps };
  });

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topN);
}

export { DEFAULT_WEIGHTS };
