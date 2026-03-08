#!/usr/bin/env python3
"""
recommend.py - Given a competitor chip, recommend the best Espressif replacement.

Uses weighted feature similarity scoring across connectivity, processing,
memory, peripherals, security, and power management.

Usage:
    python recommend.py nRF52840
    python recommend.py BL616 --top 5 --verbose
    python recommend.py CC2652R --weights connectivity=3 security=2
    python recommend.py STM32WBA55 --json
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any

try:
    from tabulate import tabulate
    HAS_TABULATE = True
except ImportError:
    HAS_TABULATE = False

KG_DIR = Path(__file__).resolve().parent.parent / "knowledge_graph"
SKIP_FILES = {"schema.json"}

# Default weights for each scoring dimension (higher = more important)
DEFAULT_WEIGHTS = {
    "wifi": 3.0,
    "bluetooth": 3.0,
    "thread_zigbee": 2.5,
    "matter": 2.0,
    "cpu_speed": 1.5,
    "cpu_cores": 1.0,
    "sram": 2.0,
    "flash": 1.5,
    "gpio": 1.0,
    "usb": 1.5,
    "security": 2.0,
    "low_power": 1.5,
    "camera": 1.0,
    "adc_channels": 0.5,
    "price": 1.5,
}


# ── Data Loading ───────────────────────────────────────────────────────────
def load_all_chips() -> dict[str, dict]:
    chips: dict[str, dict] = {}
    for fp in sorted(KG_DIR.glob("*.json")):
        if fp.name in SKIP_FILES:
            continue
        with open(fp, encoding="utf-8") as f:
            data = json.load(f)
        mfr = data.get("manufacturer", fp.stem)
        for chip in data.get("chips", []):
            key = chip["chip_model"].upper()
            chip["_manufacturer"] = mfr
            chip["_source_file"] = fp.name
            chips[key] = chip
    return chips


def get_espressif_chips(all_chips: dict) -> list[dict]:
    return [c for c in all_chips.values() if "espressif" in c.get("_source_file", "").lower()]


def find_chip(chips: dict, query: str) -> dict | None:
    q = query.upper().strip()
    if q in chips:
        return chips[q]
    matches = [k for k in chips if q in k]
    if matches:
        return chips[matches[0]]
    return None


# ── Feature Extraction ─────────────────────────────────────────────────────
def extract_features(chip: dict) -> dict[str, float]:
    """Extract normalized feature scores from a chip dict."""
    f: dict[str, float] = {}
    conn = chip.get("connectivity", {}) or {}
    proc = chip.get("processing", {}) or {}
    mem = chip.get("memory", {}) or {}
    periph = chip.get("peripherals", {}) or {}
    sec = chip.get("security", {}) or {}
    pwr = chip.get("power_management", {}) or {}

    # WiFi capability (0-3 scale: none, WiFi4, WiFi5, WiFi6/6E/7)
    wifi = conn.get("wifi")
    if wifi and isinstance(wifi, dict) and wifi.get("supported"):
        ver = str(wifi.get("version", "")).lower()
        if "7" in ver:
            f["wifi"] = 3.0
        elif "6e" in ver or "6" in ver:
            f["wifi"] = 2.5
        elif "5" in ver:
            f["wifi"] = 2.0
        elif "4" in ver:
            f["wifi"] = 1.5
        else:
            f["wifi"] = 1.0
    else:
        f["wifi"] = 0.0

    # Bluetooth (0-3 scale)
    bt = conn.get("bluetooth")
    if bt and isinstance(bt, dict) and bt.get("supported"):
        ver = str(bt.get("version", "5.0"))
        if "6" in ver:
            f["bluetooth"] = 3.0
        elif "5.4" in ver or "5.3" in ver:
            f["bluetooth"] = 2.5
        elif "5.2" in ver or "5.1" in ver:
            f["bluetooth"] = 2.0
        elif "5" in ver:
            f["bluetooth"] = 1.5
        else:
            f["bluetooth"] = 1.0
    else:
        f["bluetooth"] = 0.0

    # Thread / Zigbee / 802.15.4
    ieee = conn.get("ieee802154")
    if ieee and isinstance(ieee, dict) and ieee.get("supported"):
        score = 1.0
        protos = ieee.get("protocols", [])
        if isinstance(protos, list):
            if "Thread 1.3" in protos or "Thread" in protos:
                score += 0.5
            if "Zigbee 3.0" in protos or "Zigbee" in protos:
                score += 0.5
        f["thread_zigbee"] = score
    else:
        f["thread_zigbee"] = 0.0

    # Matter
    f["matter"] = 1.0 if conn.get("matter_support") else 0.0

    # CPU speed (normalized 0-3, where 800MHz+ = 3)
    clk = proc.get("max_clock_mhz")
    if clk and isinstance(clk, (int, float)):
        f["cpu_speed"] = min(clk / 300.0, 3.0)
    else:
        f["cpu_speed"] = 0.0

    # CPU cores
    cores = proc.get("cores")
    if cores and isinstance(cores, (int, float)):
        f["cpu_cores"] = min(cores / 2.0, 3.0)
    else:
        f["cpu_cores"] = 0.0

    # SRAM (normalized, 512KB = 2.0, 2MB+ = 3.0)
    sram = mem.get("sram_kb")
    if sram and isinstance(sram, (int, float)):
        f["sram"] = min(sram / 256.0, 3.0)
    else:
        f["sram"] = 0.0

    # Flash (normalized)
    flash = mem.get("internal_flash_kb")
    if flash and isinstance(flash, (int, float)):
        f["flash"] = min(flash / 2048.0, 3.0)
    else:
        f["flash"] = 0.0

    # GPIO
    gpio = periph.get("gpio_count")
    if gpio and isinstance(gpio, (int, float)):
        f["gpio"] = min(gpio / 30.0, 3.0)
    else:
        f["gpio"] = 0.0

    # USB
    usb = periph.get("usb")
    if usb and isinstance(usb, dict) and usb.get("supported"):
        usb_type = str(usb.get("type", "")).lower()
        if "high" in usb_type or "2.0 hs" in usb_type:
            f["usb"] = 2.0
        elif "otg" in usb_type:
            f["usb"] = 1.5
        else:
            f["usb"] = 1.0
    else:
        f["usb"] = 0.0

    # Security score
    sec_score = 0.0
    if sec.get("secure_boot"):
        sec_score += 0.5
    if sec.get("flash_encryption"):
        sec_score += 0.5
    if sec.get("crypto_accelerator"):
        sec_score += 0.5
    if sec.get("tee") or sec.get("arm_trustzone"):
        sec_score += 0.5
    if sec.get("psa_certified"):
        sec_score += 0.5
    if sec.get("secure_element"):
        sec_score += 0.5
    f["security"] = min(sec_score, 3.0)

    # Low power
    ds = pwr.get("deep_sleep_ua")
    if ds and isinstance(ds, (int, float)):
        if ds <= 5:
            f["low_power"] = 3.0
        elif ds <= 10:
            f["low_power"] = 2.5
        elif ds <= 25:
            f["low_power"] = 2.0
        elif ds <= 100:
            f["low_power"] = 1.0
        else:
            f["low_power"] = 0.5
    else:
        f["low_power"] = 0.0

    # Camera
    cam = periph.get("camera_interface")
    f["camera"] = 1.0 if cam else 0.0

    # ADC
    adc = periph.get("adc")
    if adc and isinstance(adc, dict):
        ch = adc.get("channels", 0)
        f["adc_channels"] = min(ch / 6.0, 3.0) if ch else 0.0
    else:
        f["adc_channels"] = 0.0

    # Price (inverse — cheaper is better; placeholder since many are null)
    f["price"] = 0.0  # neutral if unknown

    return f


def compute_similarity(target_feats: dict, candidate_feats: dict, weights: dict) -> float:
    """Compute weighted similarity score. Higher = better match."""
    score = 0.0
    max_score = 0.0
    for key, weight in weights.items():
        t = target_feats.get(key, 0.0)
        c = candidate_feats.get(key, 0.0)
        if t == 0.0 and c == 0.0:
            # Both lack feature — neutral
            continue
        max_score += weight * 3.0  # max feature value
        # Reward matching capability, penalize missing features target has
        if t > 0:
            # Target has this feature — score based on how well candidate matches/exceeds
            match_ratio = min(c / t, 1.5) if t > 0 else 0  # cap at 150% (exceeding is good but diminishing)
            score += weight * match_ratio * t
        else:
            # Target doesn't have this feature — bonus if candidate has it
            score += weight * c * 0.3  # small bonus for extra capability

    if max_score == 0:
        return 0.0
    return (score / max_score) * 100.0


# ── Recommendation Engine ─────────────────────────────────────────────────
def recommend(target_chip: dict, esp_chips: list[dict], weights: dict,
              top_n: int = 3, verbose: bool = False) -> list[tuple[dict, float, dict]]:
    """Return top-N Espressif chip recommendations sorted by similarity score."""
    target_feats = extract_features(target_chip)
    results = []

    for esp in esp_chips:
        esp_feats = extract_features(esp)
        score = compute_similarity(target_feats, esp_feats, weights)
        results.append((esp, score, esp_feats))

    results.sort(key=lambda x: x[1], reverse=True)

    if verbose:
        print(f"\n  Target features ({target_chip['chip_model']}):")
        for k, v in sorted(target_feats.items()):
            if v > 0:
                print(f"    {k}: {v:.1f}")

    return results[:top_n]


# ── Display ────────────────────────────────────────────────────────────────
def display_recommendations(target: dict, recommendations: list, verbose: bool = False):
    target_feats = extract_features(target)

    print("\n" + "=" * 80)
    print(f"  ESPRESSIF REPLACEMENT RECOMMENDATIONS FOR: {target['chip_model']}")
    print(f"  Manufacturer: {target.get('_manufacturer', '?')}")
    print(f"  Status: {target.get('status', '?')}  |  Applications: {', '.join(target.get('target_applications', []))}")
    print("=" * 80)

    # Key features of the target
    print("\n  Target Key Features:")
    conn = target.get("connectivity", {}) or {}
    wifi = conn.get("wifi")
    bt = conn.get("bluetooth")
    ieee = conn.get("ieee802154")
    proc = target.get("processing", {}) or {}
    mem = target.get("memory", {}) or {}

    if wifi and isinstance(wifi, dict) and wifi.get("supported"):
        print(f"    WiFi: {wifi.get('version', 'Yes')}")
    if bt and isinstance(bt, dict) and bt.get("supported"):
        print(f"    Bluetooth: {bt.get('version', 'Yes')}")
    if ieee and isinstance(ieee, dict) and ieee.get("supported"):
        print(f"    802.15.4: {', '.join(ieee.get('protocols', []))}")
    print(f"    CPU: {proc.get('cpu_architecture', '?')} @ {proc.get('max_clock_mhz', '?')}MHz, {proc.get('cores', '?')} core(s)")
    print(f"    SRAM: {mem.get('sram_kb', '?')}KB | Flash: {mem.get('internal_flash_kb', '?')}KB")

    print("\n  " + "-" * 76)

    for rank, (esp, score, esp_feats) in enumerate(recommendations, 1):
        esp_conn = esp.get("connectivity", {}) or {}
        esp_proc = esp.get("processing", {}) or {}
        esp_mem = esp.get("memory", {}) or {}

        emoji = ["", "  "][0]
        print(f"\n  #{rank}  {esp['chip_model']}  —  Match Score: {score:.1f}%")
        print(f"      Status: {esp.get('status', '?')}")

        # Connectivity summary
        parts = []
        ew = esp_conn.get("wifi")
        if ew and isinstance(ew, dict) and ew.get("supported"):
            parts.append(f"WiFi {ew.get('version', '')}")
        eb = esp_conn.get("bluetooth")
        if eb and isinstance(eb, dict) and eb.get("supported"):
            parts.append(f"BLE {eb.get('version', '')}")
        ei = esp_conn.get("ieee802154")
        if ei and isinstance(ei, dict) and ei.get("supported"):
            parts.append("802.15.4")
        if esp_conn.get("matter_support"):
            parts.append("Matter")
        print(f"      Connectivity: {', '.join(parts) if parts else 'None'}")
        print(f"      CPU: {esp_proc.get('cpu_architecture', '?')} @ {esp_proc.get('max_clock_mhz', '?')}MHz")
        print(f"      SRAM: {esp_mem.get('sram_kb', '?')}KB | Flash: {esp_mem.get('internal_flash_kb', '?')}KB")

        # Advantages / gaps
        adv = []
        gaps = []
        for key in sorted(target_feats):
            tv = target_feats.get(key, 0)
            ev = esp_feats.get(key, 0)
            if ev > tv and tv > 0:
                adv.append(key.replace("_", " "))
            elif tv > ev and tv > 0 and ev == 0:
                gaps.append(key.replace("_", " "))

        if adv:
            print(f"      Advantages: {', '.join(adv)}")
        if gaps:
            print(f"      Gaps: {', '.join(gaps)}")

        notes = esp.get("metadata", {}).get("notes", "")
        if notes and verbose:
            print(f"      Notes: {notes[:120]}...")

    print("\n" + "=" * 80 + "\n")


# ── CLI ────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Recommend best Espressif replacement for a competitor chip",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python recommend.py nRF52840
  python recommend.py BL616 --top 5 --verbose
  python recommend.py CC2652R --weights connectivity=3 security=2
  python recommend.py STM32WBA55 --json
        """,
    )
    parser.add_argument("chip", help="Competitor chip model to find ESP replacement for")
    parser.add_argument("--top", "-t", type=int, default=3, help="Number of recommendations (default: 3)")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show detailed scoring")
    parser.add_argument("--json", "-j", action="store_true", help="Output as JSON")
    parser.add_argument("--weights", "-w", nargs="*", help="Override weights: key=value pairs (e.g., connectivity=3)")
    args = parser.parse_args()

    all_chips = load_all_chips()
    esp_chips = get_espressif_chips(all_chips)

    target = find_chip(all_chips, args.chip)
    if not target:
        print(f"Error: Chip '{args.chip}' not found in knowledge graph.")
        print("Available chips:")
        for k in sorted(all_chips.keys()):
            if "espressif" not in all_chips[k].get("_source_file", ""):
                print(f"  {k}")
        sys.exit(1)

    if "espressif" in target.get("_source_file", "").lower():
        print(f"Note: '{args.chip}' is already an Espressif chip! Showing closest siblings.")

    weights = dict(DEFAULT_WEIGHTS)
    if args.weights:
        for w in args.weights:
            if "=" in w:
                k, v = w.split("=", 1)
                weights[k] = float(v)

    results = recommend(target, esp_chips, weights, args.top, args.verbose)

    if args.json:
        output = []
        for esp, score, feats in results:
            output.append({
                "chip_model": esp["chip_model"],
                "match_score": round(score, 1),
                "status": esp.get("status"),
                "features": {k: round(v, 2) for k, v in feats.items()},
            })
        print(json.dumps(output, indent=2))
    else:
        display_recommendations(target, results, args.verbose)


if __name__ == "__main__":
    main()
