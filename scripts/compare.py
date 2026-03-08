#!/usr/bin/env python3
"""
compare.py - Side-by-side chip comparison tool.

Usage:
    python compare.py ESP32-S3 nRF5340 STM32WBA55
    python compare.py ESP32-C6 BL616 CC2652R --section connectivity
    python compare.py ESP32-H2 --list-chips
    python compare.py --list-manufacturers
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

try:
    from tabulate import tabulate
    HAS_TABULATE = True
except ImportError:
    HAS_TABULATE = False

# ── Constants ──────────────────────────────────────────────────────────────
KG_DIR = Path(__file__).resolve().parent.parent / "knowledge_graph"
SKIP_FILES = {"schema.json"}

SECTIONS = [
    "connectivity", "processing", "memory", "peripherals",
    "security", "power_management", "package", "software_ecosystem", "pricing",
]


# ── Data Loading ───────────────────────────────────────────────────────────
def load_all_chips() -> dict[str, dict]:
    """Load every chip from every manufacturer JSON, keyed by chip_model (upper-cased)."""
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


def find_chip(chips: dict, query: str) -> dict | None:
    """Fuzzy-find a chip by model name (case-insensitive, partial match)."""
    q = query.upper().strip()
    # Exact match first
    if q in chips:
        return chips[q]
    # Partial match
    matches = [k for k in chips if q in k]
    if len(matches) == 1:
        return chips[matches[0]]
    if len(matches) > 1:
        print(f"  Ambiguous query '{query}', matches: {', '.join(sorted(matches))}")
        return chips[matches[0]]
    return None


# ── Formatting Helpers ─────────────────────────────────────────────────────
def flatten(obj: Any, prefix: str = "") -> list[tuple[str, str]]:
    """Flatten a nested dict/list into (label, value) pairs."""
    rows = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k.startswith("_"):
                continue
            label = f"{prefix}{k}" if prefix else k
            if isinstance(v, dict):
                rows.extend(flatten(v, f"{label}."))
            elif isinstance(v, list):
                rows.append((label, ", ".join(str(i) for i in v) if v else "—"))
            elif v is None:
                rows.append((label, "—"))
            elif isinstance(v, bool):
                rows.append((label, "Yes" if v else "No"))
            else:
                rows.append((label, str(v)))
    return rows


def format_table(headers: list[str], rows: list[list[str]]) -> str:
    """Render a table using tabulate if available, else simple columns."""
    if HAS_TABULATE:
        return tabulate(rows, headers=headers, tablefmt="grid", maxcolwidths=40)
    # Fallback: simple column-aligned output
    col_widths = [max(len(str(row[i])) for row in [headers] + rows) for i in range(len(headers))]
    lines = []
    hdr = " | ".join(h.ljust(w) for h, w in zip(headers, col_widths))
    lines.append(hdr)
    lines.append("-+-".join("-" * w for w in col_widths))
    for row in rows:
        lines.append(" | ".join(str(c).ljust(w) for c, w in zip(row, col_widths)))
    return "\n".join(lines)


# ── Compare Logic ──────────────────────────────────────────────────────────
def compare_chips(chip_dicts: list[dict], sections: list[str] | None = None):
    """Print a side-by-side comparison of multiple chips."""
    if not chip_dicts:
        print("No chips to compare.")
        return

    names = [c["chip_model"] for c in chip_dicts]
    mfrs = [c.get("_manufacturer", "?") for c in chip_dicts]

    print("\n" + "=" * 80)
    print("  CHIP COMPARISON")
    print("=" * 80)

    # Header info
    headers = ["Attribute"] + [f"{n}\n({m})" for n, m in zip(names, mfrs)]

    # Top-level fields
    top_fields = ["chip_family", "status", "release_year", "target_applications"]
    rows = []
    for field in top_fields:
        row = [field]
        for c in chip_dicts:
            v = c.get(field)
            if isinstance(v, list):
                row.append(", ".join(v) if v else "—")
            elif v is None:
                row.append("—")
            else:
                row.append(str(v))
        rows.append(row)

    print("\n── General ──")
    print(format_table(headers, rows))

    # Section-by-section
    active_sections = sections if sections else SECTIONS
    for section in active_sections:
        rows = []
        # Gather all keys across all chips for this section
        all_keys: dict[str, None] = {}
        for c in chip_dicts:
            sec_data = c.get(section)
            if isinstance(sec_data, dict):
                for pair in flatten(sec_data):
                    all_keys[pair[0]] = None

        for key in all_keys:
            row = [key]
            for c in chip_dicts:
                sec_data = c.get(section)
                if not isinstance(sec_data, dict):
                    row.append("—")
                    continue
                flat = dict(flatten(sec_data))
                row.append(flat.get(key, "—"))
            rows.append(row)

        if rows:
            print(f"\n── {section.replace('_', ' ').title()} ──")
            print(format_table(headers, rows))

    print()


def list_all_chips(chips: dict):
    """Print all available chips grouped by manufacturer."""
    by_mfr: dict[str, list[str]] = {}
    for key, c in sorted(chips.items()):
        mfr = c.get("_manufacturer", "Unknown")
        by_mfr.setdefault(mfr, []).append(c["chip_model"])

    print("\n" + "=" * 60)
    print("  AVAILABLE CHIPS IN KNOWLEDGE GRAPH")
    print("=" * 60)
    total = 0
    for mfr in sorted(by_mfr):
        models = by_mfr[mfr]
        total += len(models)
        print(f"\n  {mfr} ({len(models)} chips):")
        for m in sorted(models):
            print(f"    - {m}")
    print(f"\n  Total: {total} chips across {len(by_mfr)} manufacturers\n")


def list_manufacturers(chips: dict):
    """Print all manufacturers and chip counts."""
    by_mfr: dict[str, int] = {}
    for c in chips.values():
        mfr = c.get("_manufacturer", "Unknown")
        by_mfr[mfr] = by_mfr.get(mfr, 0) + 1
    print("\n  Manufacturers:")
    for mfr in sorted(by_mfr):
        print(f"    {mfr}: {by_mfr[mfr]} chips")
    print()


# ── CLI ────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Compare IoT/embedded chips side-by-side",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python compare.py ESP32-S3 nRF5340 BL616
  python compare.py ESP32-C6 CC2652R --section connectivity security
  python compare.py --list-chips
  python compare.py --list-manufacturers
        """,
    )
    parser.add_argument("chips", nargs="*", help="Chip models to compare (2+ recommended)")
    parser.add_argument("--section", "-s", nargs="+", choices=SECTIONS, help="Limit to specific sections")
    parser.add_argument("--list-chips", "-l", action="store_true", help="List all available chips")
    parser.add_argument("--list-manufacturers", "-m", action="store_true", help="List all manufacturers")
    parser.add_argument("--json", "-j", action="store_true", help="Output raw JSON instead of table")
    args = parser.parse_args()

    all_chips = load_all_chips()

    if args.list_chips:
        list_all_chips(all_chips)
        return

    if args.list_manufacturers:
        list_manufacturers(all_chips)
        return

    if len(args.chips) < 1:
        parser.print_help()
        return

    found = []
    for name in args.chips:
        chip = find_chip(all_chips, name)
        if chip:
            found.append(chip)
        else:
            print(f"  [WARN] Chip '{name}' not found in knowledge graph. Skipping.")

    if not found:
        print("No matching chips found. Use --list-chips to see available options.")
        sys.exit(1)

    if args.json:
        # Strip internal fields
        output = []
        for c in found:
            output.append({k: v for k, v in c.items() if not k.startswith("_")})
        print(json.dumps(output, indent=2))
    else:
        compare_chips(found, args.section)


if __name__ == "__main__":
    main()
