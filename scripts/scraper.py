#!/usr/bin/env python3
"""
scraper.py - Reusable web scraping utilities for updating chip data.

Provides functions to scrape manufacturer product pages, distributor sites
(DigiKey, Mouser), and datasheet repositories. Outputs structured JSON
conforming to the knowledge graph schema.

Usage:
    python scraper.py --source espressif           # Scrape Espressif product pages
    python scraper.py --source digikey --query "ESP32-S3"  # Search DigiKey
    python scraper.py --datasheet ESP32-C6         # Find & download datasheet URL
    python scraper.py --validate                   # Validate all JSON files against schema
    python scraper.py --stats                      # Print knowledge graph statistics
"""

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, quote_plus

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False

try:
    import jsonschema
    HAS_JSONSCHEMA = True
except ImportError:
    HAS_JSONSCHEMA = False

KG_DIR = Path(__file__).resolve().parent.parent / "knowledge_graph"
DS_DIR = Path(__file__).resolve().parent.parent / "datasheets"
SCHEMA_FILE = KG_DIR / "schema.json"
SKIP_FILES = {"schema.json"}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


# ── Validation ─────────────────────────────────────────────────────────────
def validate_all():
    """Validate all manufacturer JSON files against the schema."""
    if not HAS_JSONSCHEMA:
        print("Error: jsonschema package not installed. Run: pip install jsonschema")
        sys.exit(1)

    with open(SCHEMA_FILE, encoding="utf-8") as f:
        schema = json.load(f)

    errors = 0
    total = 0
    for fp in sorted(KG_DIR.glob("*.json")):
        if fp.name in SKIP_FILES:
            continue
        total += 1
        with open(fp, encoding="utf-8") as f:
            try:
                data = json.load(f)
            except json.JSONDecodeError as e:
                print(f"  [FAIL] {fp.name}: Invalid JSON - {e}")
                errors += 1
                continue

        try:
            jsonschema.validate(data, schema)
            chip_count = len(data.get("chips", []))
            print(f"  [OK]   {fp.name} ({chip_count} chips)")
        except jsonschema.ValidationError as e:
            print(f"  [FAIL] {fp.name}: {e.message}")
            errors += 1

    print(f"\n  Validated {total} files: {total - errors} passed, {errors} failed")
    return errors == 0


# ── Statistics ─────────────────────────────────────────────────────────────
def print_stats():
    """Print statistics about the knowledge graph."""
    total_chips = 0
    total_files = 0
    by_status = {}
    by_arch = {}
    by_protocol = {"WiFi": 0, "BLE": 0, "Thread": 0, "Zigbee": 0, "Matter": 0, "LoRa": 0, "Cellular": 0}
    mfr_chips = {}

    for fp in sorted(KG_DIR.glob("*.json")):
        if fp.name in SKIP_FILES:
            continue
        total_files += 1
        with open(fp, encoding="utf-8") as f:
            data = json.load(f)

        mfr = data.get("manufacturer", fp.stem)
        chips = data.get("chips", [])
        mfr_chips[mfr] = len(chips)
        total_chips += len(chips)

        for chip in chips:
            # Status
            status = chip.get("status", "unknown")
            by_status[status] = by_status.get(status, 0) + 1

            # Architecture
            arch = chip.get("processing", {}).get("cpu_architecture", "unknown")
            by_arch[arch] = by_arch.get(arch, 0) + 1

            # Protocols
            conn = chip.get("connectivity", {})
            wifi = conn.get("wifi")
            if isinstance(wifi, dict) and wifi.get("supported"):
                by_protocol["WiFi"] += 1
            bt = conn.get("bluetooth")
            if isinstance(bt, dict) and bt.get("supported"):
                by_protocol["BLE"] += 1
            ieee = conn.get("ieee802154")
            if isinstance(ieee, dict) and ieee.get("supported"):
                protos = ieee.get("protocols", [])
                if "Thread" in protos or "Thread 1.3" in protos:
                    by_protocol["Thread"] += 1
                if "Zigbee" in protos or "Zigbee 3.0" in protos:
                    by_protocol["Zigbee"] += 1
            if conn.get("matter_support"):
                by_protocol["Matter"] += 1
            if conn.get("lora"):
                by_protocol["LoRa"] += 1
            cell = conn.get("cellular")
            if isinstance(cell, dict) and cell.get("supported"):
                by_protocol["Cellular"] += 1

    print("\n" + "=" * 60)
    print("  KNOWLEDGE GRAPH STATISTICS")
    print("=" * 60)
    print(f"\n  Files: {total_files}")
    print(f"  Total chips: {total_chips}")

    print("\n  Chips per manufacturer:")
    for mfr, count in sorted(mfr_chips.items(), key=lambda x: -x[1]):
        bar = "#" * count
        print(f"    {mfr:<35s} {count:>3d} {bar}")

    print("\n  By status:")
    for status, count in sorted(by_status.items(), key=lambda x: -x[1]):
        print(f"    {status:<15s} {count}")

    print("\n  Protocol support:")
    for proto, count in sorted(by_protocol.items(), key=lambda x: -x[1]):
        bar = "#" * count
        print(f"    {proto:<10s} {count:>3d} {bar}")

    print("\n  CPU architectures:")
    for arch, count in sorted(by_arch.items(), key=lambda x: -x[1]):
        print(f"    {arch:<45s} {count}")

    print()


# ── Scraping Functions ─────────────────────────────────────────────────────
def scrape_espressif_products() -> list[dict]:
    """Scrape Espressif product listing page for chip information."""
    if not HAS_REQUESTS or not HAS_BS4:
        print("Error: requests and beautifulsoup4 required. Run: pip install requests beautifulsoup4")
        return []

    url = "https://www.espressif.com/en/products/socs"
    print(f"  Fetching {url}...")

    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"  Error fetching page: {e}")
        return []

    soup = BeautifulSoup(resp.text, "lxml")
    products = []

    # Find product entries (this is a basic scraper - may need updating if page changes)
    for link in soup.select("a[href*='/products/socs/']"):
        name = link.get_text(strip=True)
        href = link.get("href", "")
        if name and "ESP" in name.upper():
            product_url = urljoin(url, href)
            products.append({"name": name, "url": product_url})
            print(f"    Found: {name} -> {product_url}")

    return products


def search_digikey(query: str, max_results: int = 10) -> list[dict]:
    """Search DigiKey for chip pricing and availability (basic scraper)."""
    if not HAS_REQUESTS:
        print("Error: requests required. Run: pip install requests")
        return []

    url = f"https://www.digikey.com/en/products/result?keywords={quote_plus(query)}"
    print(f"  Searching DigiKey for '{query}'...")
    print(f"  URL: {url}")
    print("  Note: DigiKey may block automated requests. Use their API for production use.")
    print("  DigiKey API: https://developer.digikey.com/")

    return [{"query": query, "url": url, "note": "Manual search recommended - DigiKey blocks scraping"}]


def search_mouser(query: str) -> list[dict]:
    """Search Mouser for chip pricing (basic scraper)."""
    url = f"https://www.mouser.com/c/?q={quote_plus(query)}"
    print(f"  Mouser search URL: {url}")
    print("  Note: Use Mouser API for production use: https://www.mouser.com/api-hub/")
    return [{"query": query, "url": url, "note": "Manual search recommended"}]


def find_datasheet_url(chip_model: str) -> list[dict]:
    """Find datasheet URLs for a given chip model."""
    results = []

    # Common datasheet sources
    sources = [
        f"https://www.espressif.com/sites/default/files/documentation/{chip_model.lower()}_datasheet_en.pdf",
        f"https://www.espressif.com/sites/default/files/documentation/{chip_model.lower().replace('-', '_')}_datasheet_en.pdf",
    ]

    if HAS_REQUESTS:
        for url in sources:
            try:
                resp = requests.head(url, headers=HEADERS, timeout=10, allow_redirects=True)
                if resp.status_code == 200:
                    results.append({"url": url, "status": "found", "size_bytes": resp.headers.get("content-length")})
                    print(f"    [FOUND] {url}")
                else:
                    print(f"    [MISS]  {url} ({resp.status_code})")
            except requests.RequestException:
                print(f"    [ERR]   {url}")
    else:
        results = [{"url": url, "status": "unchecked"} for url in sources]

    return results


# ── Data Update Helpers ────────────────────────────────────────────────────
def merge_chip_data(existing: dict, updates: dict) -> dict:
    """Merge new data into an existing chip entry, preferring non-null values."""
    merged = dict(existing)
    for key, value in updates.items():
        if key.startswith("_"):
            continue
        if value is None:
            continue
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = merge_chip_data(merged[key], value)
        else:
            merged[key] = value
    return merged


def update_manufacturer_file(filename: str, chip_model: str, updates: dict):
    """Update a specific chip in a manufacturer JSON file."""
    fp = KG_DIR / filename
    if not fp.exists():
        print(f"  Error: {fp} not found")
        return

    with open(fp, encoding="utf-8") as f:
        data = json.load(f)

    found = False
    for i, chip in enumerate(data.get("chips", [])):
        if chip["chip_model"].upper() == chip_model.upper():
            data["chips"][i] = merge_chip_data(chip, updates)
            found = True
            print(f"  Updated {chip_model} in {filename}")
            break

    if not found:
        print(f"  Chip {chip_model} not found in {filename}")
        return

    with open(fp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"  Saved {filename}")


# ── CLI ────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Web scraping utilities for updating the chip knowledge graph",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scraper.py --validate                   # Validate JSON files
  python scraper.py --stats                      # Print statistics
  python scraper.py --source espressif           # Scrape Espressif
  python scraper.py --source digikey -q ESP32-S3 # Search DigiKey
  python scraper.py --datasheet ESP32-C6         # Find datasheet
        """,
    )
    parser.add_argument("--validate", action="store_true", help="Validate all JSON against schema")
    parser.add_argument("--stats", action="store_true", help="Print knowledge graph statistics")
    parser.add_argument("--source", choices=["espressif", "digikey", "mouser"], help="Scrape source")
    parser.add_argument("--query", "-q", help="Search query for distributor search")
    parser.add_argument("--datasheet", help="Find datasheet URL for a chip model")
    parser.add_argument("--json", "-j", action="store_true", help="Output as JSON")
    args = parser.parse_args()

    if args.validate:
        validate_all()
        return

    if args.stats:
        print_stats()
        return

    if args.source == "espressif":
        products = scrape_espressif_products()
        if args.json:
            print(json.dumps(products, indent=2))
        return

    if args.source == "digikey":
        if not args.query:
            print("Error: --query required for DigiKey search")
            sys.exit(1)
        results = search_digikey(args.query)
        if args.json:
            print(json.dumps(results, indent=2))
        return

    if args.source == "mouser":
        if not args.query:
            print("Error: --query required for Mouser search")
            sys.exit(1)
        results = search_mouser(args.query)
        if args.json:
            print(json.dumps(results, indent=2))
        return

    if args.datasheet:
        results = find_datasheet_url(args.datasheet)
        if args.json:
            print(json.dumps(results, indent=2))
        return

    parser.print_help()


if __name__ == "__main__":
    main()
