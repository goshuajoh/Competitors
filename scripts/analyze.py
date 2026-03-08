#!/usr/bin/env python3
"""
analyze.py - Generate competitive strength/weakness reports.

Produces per-manufacturer and per-chip competitive analysis against Espressif,
plus market segment summaries.

Usage:
    python analyze.py                         # Full competitive landscape report
    python analyze.py --manufacturer nordic   # Focus on one competitor
    python analyze.py --segment "Smart Home"  # Analyze a market segment
    python analyze.py --export report.json    # Export structured JSON report
"""

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

KG_DIR = Path(__file__).resolve().parent.parent / "knowledge_graph"
SKIP_FILES = {"schema.json"}


# ── Data Loading ───────────────────────────────────────────────────────────
def load_manufacturers() -> dict[str, dict]:
    """Load all manufacturer data files, keyed by filename stem."""
    mfrs = {}
    for fp in sorted(KG_DIR.glob("*.json")):
        if fp.name in SKIP_FILES:
            continue
        with open(fp, encoding="utf-8") as f:
            data = json.load(f)
        data["_file"] = fp.name
        mfrs[fp.stem] = data
    return mfrs


def load_all_chips(mfrs: dict) -> list[dict]:
    chips = []
    for stem, data in mfrs.items():
        for chip in data.get("chips", []):
            chip["_manufacturer"] = data.get("manufacturer", stem)
            chip["_file"] = stem
            chips.append(chip)
    return chips


# ── Feature Analysis Helpers ───────────────────────────────────────────────
def has_wifi(chip: dict) -> bool:
    w = chip.get("connectivity", {}).get("wifi")
    return isinstance(w, dict) and w.get("supported", False)

def get_wifi_version(chip: dict) -> str:
    w = chip.get("connectivity", {}).get("wifi")
    if isinstance(w, dict) and w.get("supported"):
        return str(w.get("version", "unknown"))
    return "none"

def has_ble(chip: dict) -> bool:
    b = chip.get("connectivity", {}).get("bluetooth")
    return isinstance(b, dict) and b.get("supported", False)

def get_ble_version(chip: dict) -> str:
    b = chip.get("connectivity", {}).get("bluetooth")
    if isinstance(b, dict) and b.get("supported"):
        return str(b.get("version", "unknown"))
    return "none"

def has_thread(chip: dict) -> bool:
    i = chip.get("connectivity", {}).get("ieee802154")
    if isinstance(i, dict) and i.get("supported"):
        protos = i.get("protocols", [])
        return "Thread" in protos or "Thread 1.3" in protos
    return False

def has_zigbee(chip: dict) -> bool:
    i = chip.get("connectivity", {}).get("ieee802154")
    if isinstance(i, dict) and i.get("supported"):
        protos = i.get("protocols", [])
        return "Zigbee" in protos or "Zigbee 3.0" in protos
    return False

def has_matter(chip: dict) -> bool:
    return chip.get("connectivity", {}).get("matter_support", False)

def get_cpu_mhz(chip: dict) -> int:
    return chip.get("processing", {}).get("max_clock_mhz") or 0

def get_sram_kb(chip: dict) -> int:
    return chip.get("memory", {}).get("sram_kb") or 0

def get_cores(chip: dict) -> int:
    return chip.get("processing", {}).get("cores") or 0

def has_usb(chip: dict) -> bool:
    u = chip.get("peripherals", {}).get("usb")
    return isinstance(u, dict) and u.get("supported", False)

def has_camera(chip: dict) -> bool:
    return bool(chip.get("peripherals", {}).get("camera_interface"))

def has_secure_boot(chip: dict) -> bool:
    return chip.get("security", {}).get("secure_boot", False)

def has_tee(chip: dict) -> bool:
    sec = chip.get("security", {})
    return sec.get("tee", False) or sec.get("arm_trustzone", False)

def get_deep_sleep_ua(chip: dict) -> float | None:
    return chip.get("power_management", {}).get("deep_sleep_ua")

def get_arch(chip: dict) -> str:
    return chip.get("processing", {}).get("cpu_architecture", "unknown")


# ── Analysis Functions ─────────────────────────────────────────────────────
def analyze_manufacturer(mfr_name: str, mfr_chips: list[dict], esp_chips: list[dict]) -> dict:
    """Generate strength/weakness analysis for one manufacturer vs Espressif."""
    report = {
        "manufacturer": mfr_name,
        "chip_count": len(mfr_chips),
        "strengths": [],
        "weaknesses": [],
        "unique_features": [],
        "head_to_head": [],
        "threat_level": "low",
    }

    # Collect capabilities across all chips
    mfr_has_wifi = any(has_wifi(c) for c in mfr_chips)
    mfr_has_ble = any(has_ble(c) for c in mfr_chips)
    mfr_has_thread = any(has_thread(c) for c in mfr_chips)
    mfr_has_matter = any(has_matter(c) for c in mfr_chips)
    mfr_max_mhz = max((get_cpu_mhz(c) for c in mfr_chips), default=0)
    mfr_max_sram = max((get_sram_kb(c) for c in mfr_chips), default=0)
    mfr_has_usb = any(has_usb(c) for c in mfr_chips)
    mfr_has_cam = any(has_camera(c) for c in mfr_chips)
    mfr_has_sb = any(has_secure_boot(c) for c in mfr_chips)
    mfr_has_tee = any(has_tee(c) for c in mfr_chips)

    esp_has_wifi = any(has_wifi(c) for c in esp_chips)
    esp_has_ble = any(has_ble(c) for c in esp_chips)
    esp_has_thread = any(has_thread(c) for c in esp_chips)
    esp_has_matter = any(has_matter(c) for c in esp_chips)
    esp_max_mhz = max((get_cpu_mhz(c) for c in esp_chips), default=0)
    esp_max_sram = max((get_sram_kb(c) for c in esp_chips), default=0)
    esp_has_usb = any(has_usb(c) for c in esp_chips)
    esp_has_cam = any(has_camera(c) for c in esp_chips)
    esp_has_sb = any(has_secure_boot(c) for c in esp_chips)

    # Strengths
    if mfr_max_mhz > esp_max_mhz:
        report["strengths"].append(f"Higher max CPU speed ({mfr_max_mhz}MHz vs ESP {esp_max_mhz}MHz)")
    if mfr_max_sram > esp_max_sram:
        report["strengths"].append(f"More SRAM available ({mfr_max_sram}KB vs ESP {esp_max_sram}KB)")
    if mfr_has_tee and not any(has_tee(c) for c in esp_chips):
        report["strengths"].append("TrustZone / TEE security")
    if mfr_has_ble and not esp_has_ble:
        report["strengths"].append("Bluetooth support (ESP lacks in some segments)")

    # Check for WiFi 6/6E advantage
    mfr_wifi_versions = [get_wifi_version(c) for c in mfr_chips if has_wifi(c)]
    if any("6" in v for v in mfr_wifi_versions):
        report["strengths"].append("WiFi 6/6E capable chips")

    # Unique features
    for chip in mfr_chips:
        other = chip.get("peripherals", {}).get("other", [])
        if isinstance(other, list):
            for feat in other:
                if feat and len(feat) > 5:
                    report["unique_features"].append(f"{chip['chip_model']}: {feat}")

    # Weaknesses
    if esp_has_wifi and not mfr_has_wifi:
        report["weaknesses"].append("No integrated WiFi (ESP advantage)")
    if esp_has_matter and not mfr_has_matter:
        report["weaknesses"].append("No Matter support")
    if esp_has_cam and not mfr_has_cam:
        report["weaknesses"].append("No camera interface")
    if esp_max_mhz > mfr_max_mhz:
        report["weaknesses"].append(f"Lower max CPU speed ({mfr_max_mhz}MHz vs ESP {esp_max_mhz}MHz)")
    if esp_max_sram > mfr_max_sram:
        report["weaknesses"].append(f"Less SRAM ({mfr_max_sram}KB vs ESP {esp_max_sram}KB)")

    # Head-to-head comparisons
    for mc in mfr_chips:
        if not has_wifi(mc) and not has_ble(mc):
            continue  # Skip pure MCUs for head-to-head
        best_esp = None
        best_overlap = 0
        for ec in esp_chips:
            overlap = 0
            if has_wifi(mc) and has_wifi(ec):
                overlap += 2
            if has_ble(mc) and has_ble(ec):
                overlap += 2
            if has_thread(mc) and has_thread(ec):
                overlap += 1
            if has_matter(mc) and has_matter(ec):
                overlap += 1
            if overlap > best_overlap:
                best_overlap = overlap
                best_esp = ec
        if best_esp:
            report["head_to_head"].append({
                "competitor": mc["chip_model"],
                "espressif_match": best_esp["chip_model"],
                "overlap_score": best_overlap,
            })

    # Threat level
    threat_score = 0
    if mfr_has_wifi:
        threat_score += 3
    if mfr_has_ble:
        threat_score += 2
    if mfr_has_thread:
        threat_score += 2
    if mfr_has_matter:
        threat_score += 2
    if mfr_max_mhz > esp_max_mhz:
        threat_score += 1
    if len(mfr_chips) > 3:
        threat_score += 1

    if threat_score >= 8:
        report["threat_level"] = "high"
    elif threat_score >= 5:
        report["threat_level"] = "medium"
    else:
        report["threat_level"] = "low"

    return report


def analyze_segment(segment: str, all_chips: list[dict]) -> dict:
    """Analyze a market segment showing which chips from which manufacturers target it."""
    matches = []
    for chip in all_chips:
        apps = chip.get("target_applications", [])
        if any(segment.lower() in a.lower() for a in apps):
            matches.append(chip)

    by_mfr = defaultdict(list)
    for c in matches:
        by_mfr[c["_manufacturer"]].append(c["chip_model"])

    return {
        "segment": segment,
        "total_chips": len(matches),
        "manufacturers": dict(by_mfr),
        "chips": [{"model": c["chip_model"], "mfr": c["_manufacturer"],
                    "wifi": has_wifi(c), "ble": has_ble(c), "thread": has_thread(c),
                    "cpu_mhz": get_cpu_mhz(c), "sram_kb": get_sram_kb(c)}
                   for c in matches],
    }


# ── Display Functions ──────────────────────────────────────────────────────
def print_separator(char="=", width=80):
    print(char * width)

def display_manufacturer_report(report: dict):
    print_separator()
    threat_emoji = {"high": "[HIGH]", "medium": "[MED]", "low": "[LOW]"}
    t = report["threat_level"]
    print(f"  {report['manufacturer']}  —  {report['chip_count']} chips  |  Threat: {threat_emoji.get(t, t)} {t.upper()}")
    print_separator("-")

    if report["strengths"]:
        print("\n  STRENGTHS (vs Espressif):")
        for s in report["strengths"]:
            print(f"    + {s}")

    if report["weaknesses"]:
        print("\n  WEAKNESSES (vs Espressif):")
        for w in report["weaknesses"]:
            print(f"    - {w}")

    if report["head_to_head"]:
        print("\n  HEAD-TO-HEAD MATCHES:")
        for h in report["head_to_head"]:
            print(f"    {h['competitor']} <-> {h['espressif_match']} (overlap: {h['overlap_score']})")

    if report["unique_features"][:5]:
        print("\n  NOTABLE FEATURES:")
        for uf in report["unique_features"][:5]:
            print(f"    * {uf}")

    print()


def display_landscape_summary(reports: list[dict], all_chips: list[dict]):
    print("\n" + "=" * 80)
    print("  COMPETITIVE LANDSCAPE SUMMARY")
    print("=" * 80)

    # Chip counts
    esp_count = sum(1 for c in all_chips if c["_file"] == "espressif")
    comp_count = len(all_chips) - esp_count
    print(f"\n  Total chips in knowledge graph: {len(all_chips)}")
    print(f"    Espressif: {esp_count} chips")
    print(f"    Competitors: {comp_count} chips across {len(reports)} manufacturers")

    # Protocol coverage
    print("\n  PROTOCOL COVERAGE:")
    protocols = {"WiFi": has_wifi, "BLE": has_ble, "Thread": has_thread, "Zigbee": has_zigbee, "Matter": has_matter}
    for proto_name, proto_fn in protocols.items():
        esp_support = sum(1 for c in all_chips if c["_file"] == "espressif" and proto_fn(c))
        comp_support = sum(1 for c in all_chips if c["_file"] != "espressif" and proto_fn(c))
        print(f"    {proto_name:12s}  ESP: {esp_support:2d} chips  |  Competitors: {comp_support:2d} chips")

    # Architecture distribution
    print("\n  CPU ARCHITECTURES:")
    archs = defaultdict(int)
    for c in all_chips:
        archs[get_arch(c)] += 1
    for arch, count in sorted(archs.items(), key=lambda x: -x[1]):
        print(f"    {arch}: {count} chips")

    # Threat ranking
    print("\n  THREAT RANKING:")
    sorted_reports = sorted(reports, key=lambda r: {"high": 3, "medium": 2, "low": 1}.get(r["threat_level"], 0), reverse=True)
    for r in sorted_reports:
        t = r["threat_level"]
        tag = {"high": "[HIGH]", "medium": "[MED]", "low": "[LOW]"}.get(t, t)
        print(f"    {tag:8s} {r['manufacturer']} ({r['chip_count']} chips)")

    # Key market segments
    segments = ["Smart Home", "Wearable", "Industrial", "Gateway"]
    print("\n  MARKET SEGMENTS:")
    for seg in segments:
        matches = [c for c in all_chips if any(seg.lower() in a.lower() for a in c.get("target_applications", []))]
        mfrs = set(c["_manufacturer"] for c in matches)
        print(f"    {seg}: {len(matches)} chips from {len(mfrs)} manufacturers")

    print("\n" + "=" * 80 + "\n")


def display_segment_report(seg_report: dict):
    print("\n" + "=" * 80)
    print(f"  SEGMENT ANALYSIS: {seg_report['segment']}")
    print("=" * 80)
    print(f"\n  {seg_report['total_chips']} chips target this segment:\n")
    for mfr, models in sorted(seg_report["manufacturers"].items()):
        print(f"    {mfr}: {', '.join(models)}")
    print()
    if seg_report["chips"]:
        print("  Chip Details:")
        print(f"    {'Model':<20s} {'Mfr':<25s} {'WiFi':>5s} {'BLE':>5s} {'Thread':>7s} {'MHz':>5s} {'SRAM':>7s}")
        print("    " + "-" * 75)
        for c in seg_report["chips"]:
            print(f"    {c['model']:<20s} {c['mfr']:<25s} {'Y' if c['wifi'] else '-':>5s} "
                  f"{'Y' if c['ble'] else '-':>5s} {'Y' if c['thread'] else '-':>7s} "
                  f"{c['cpu_mhz']:>5d} {c['sram_kb']:>6d}K")
    print()


# ── CLI ────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Generate competitive analysis reports for Espressif vs competitors",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python analyze.py                           # Full landscape report
  python analyze.py --manufacturer nordic     # Focus on Nordic
  python analyze.py --segment "Smart Home"    # Segment analysis
  python analyze.py --export report.json      # Export to JSON
        """,
    )
    parser.add_argument("--manufacturer", "-m", help="Focus analysis on one manufacturer (filename stem)")
    parser.add_argument("--segment", "-s", help="Analyze a market segment (e.g., 'Smart Home', 'Wearable')")
    parser.add_argument("--export", "-e", help="Export report as JSON to file")
    parser.add_argument("--list-segments", action="store_true", help="List all target application segments")
    args = parser.parse_args()

    mfrs = load_manufacturers()
    all_chips = load_all_chips(mfrs)
    esp_chips = [c for c in all_chips if c["_file"] == "espressif"]

    if args.list_segments:
        segments = set()
        for c in all_chips:
            for app in c.get("target_applications", []):
                segments.add(app)
        print("\n  Available segments:")
        for s in sorted(segments):
            count = sum(1 for c in all_chips if s in c.get("target_applications", []))
            print(f"    {s} ({count} chips)")
        print()
        return

    if args.segment:
        seg_report = analyze_segment(args.segment, all_chips)
        if args.export:
            with open(args.export, "w", encoding="utf-8") as f:
                json.dump(seg_report, f, indent=2)
            print(f"  Exported segment report to {args.export}")
        else:
            display_segment_report(seg_report)
        return

    # Manufacturer analysis
    reports = []
    target_mfrs = {args.manufacturer: mfrs[args.manufacturer]} if args.manufacturer and args.manufacturer in mfrs else {
        k: v for k, v in mfrs.items() if k != "espressif"
    }

    if args.manufacturer and args.manufacturer not in mfrs:
        print(f"Error: Manufacturer '{args.manufacturer}' not found.")
        print(f"Available: {', '.join(sorted(mfrs.keys()))}")
        sys.exit(1)

    for stem, data in sorted(target_mfrs.items()):
        if stem == "espressif":
            continue
        mfr_chips = [c for c in all_chips if c["_file"] == stem]
        if not mfr_chips:
            continue
        report = analyze_manufacturer(data.get("manufacturer", stem), mfr_chips, esp_chips)
        reports.append(report)

    if args.export:
        output = {
            "generated": "2026-03-07",
            "espressif_chips": len(esp_chips),
            "competitor_reports": reports,
        }
        with open(args.export, "w", encoding="utf-8") as f:
            json.dump(output, f, indent=2)
        print(f"  Exported report to {args.export}")
        return

    # Display
    for report in reports:
        display_manufacturer_report(report)

    if not args.manufacturer:
        display_landscape_summary(reports, all_chips)


if __name__ == "__main__":
    main()
