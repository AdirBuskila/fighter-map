#!/usr/bin/env python3
"""
Phase 3a - build a local index of every named business in Israel from OSM.

Replaces per-place calls to a geocoding API. The whole country's named POIs are
about one download, after which matching is local: no key, no card, no rate
limit, and free retries while the matching is tuned. Overpass cannot serve a
query this size on its public instances (both mirrors time out), so the data
comes from a Geofabrik extract instead.

    data/israel.osm.pbf        the extract, downloaded once
    data/osm_pois.json         name, coordinates and category per business
    data/osm_places.json       towns and villages, so a match can be checked
                               against the city the reporter named

Re-run after `--refresh` to pick up a newer extract. Geofabrik rebuilds daily;
for this dataset a monthly refresh is plenty.

Usage:
    python scripts/03a_osm_extract.py
    python scripts/03a_osm_extract.py --refresh
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import osmium
import requests

ROOT = Path(__file__).resolve().parent.parent
PBF = ROOT / "data" / "israel.osm.pbf"
OUT = ROOT / "data" / "osm_pois.json"
PLACES_OUT = ROOT / "data" / "osm_places.json"

SOURCE = "https://download.geofabrik.de/asia/israel-and-palestine-latest.osm.pbf"
UA = "fighter-map/0.1 (https://github.com/; community benefit map)"

# The tags a place a reservist can walk into actually carries. Anything without
# a name is useless to us, and so is anything that is not a business.
WANTED = {
    "amenity": {
        "restaurant", "cafe", "fast_food", "bar", "pub", "ice_cream",
        "food_court", "biergarten", "nightclub", "cinema", "theatre",
        "marketplace", "pharmacy", "fuel", "bank",
    },
    "tourism": {
        "hotel", "hostel", "guest_house", "motel", "apartment", "chalet",
        "resort", "attraction", "museum", "theme_park", "zoo", "aquarium",
        "camp_site", "caravan_site", "picnic_site", "viewpoint",
    },
    "leisure": {
        "fitness_centre", "sports_centre", "water_park", "bowling_alley",
        "swimming_pool", "golf_course", "beach_resort", "amusement_arcade",
    },
    "office": {"travel_agent", "estate_agent"},
    "craft": None,   # any value
    "shop": None,    # any value, this is the big one
}

# Localities. A reporter writes "לחם בשר ירושלים"; without somewhere to anchor
# "ירושלים" the matcher cannot tell the Jerusalem branch from the Herzliya one.
PLACE_KINDS = {"city", "town", "village", "suburb", "neighbourhood", "hamlet"}


def download(path: Path, refresh: bool) -> None:
    if path.exists() and not refresh:
        age_days = (time.time() - path.stat().st_mtime) / 86400
        print("using %s (%.0f MB, %.0f days old)"
              % (path.name, path.stat().st_size / 1e6, age_days))
        return

    print("downloading %s" % SOURCE)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    with requests.get(SOURCE, headers={"User-Agent": UA}, stream=True, timeout=600) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        done = 0
        with open(tmp, "wb") as handle:
            for chunk in r.iter_content(chunk_size=1 << 20):
                handle.write(chunk)
                done += len(chunk)
                if total:
                    print("\r  %5.1f / %5.1f MB" % (done / 1e6, total / 1e6),
                          end="", flush=True)
    print()
    tmp.replace(path)


def category_of(tags) -> str | None:
    for key, values in WANTED.items():
        value = tags.get(key)
        if value is None:
            continue
        if values is None or value in values:
            return "%s=%s" % (key, value)
    return None


class PoiHandler(osmium.SimpleHandler):
    """Collects named businesses as points."""

    def __init__(self):
        super().__init__()
        self.rows: list = []
        self.places: list = []
        self.seen: set = set()

    def _add_locality(self, obj, lat, lon) -> bool:
        kind = obj.tags.get("place")
        name = obj.tags.get("name")
        if kind not in PLACE_KINDS or not name:
            return False
        self.places.append({
            "name": name,
            "name_he": obj.tags.get("name:he"),
            "name_en": obj.tags.get("name:en"),
            "kind": kind,
            "lat": round(lat, 6),
            "lon": round(lon, 6),
        })
        return True

    def _add(self, obj, lat, lon, osm_type):
        tags = obj.tags
        name = tags.get("name")
        if not name:
            return
        category = category_of(tags)
        if category is None:
            return
        key = (name, round(lat, 5), round(lon, 5))
        if key in self.seen:
            return
        self.seen.add(key)
        self.rows.append({
            "osm": "%s/%d" % (osm_type, obj.id),
            "name": name,
            "name_he": tags.get("name:he"),
            "name_en": tags.get("name:en"),
            "brand": tags.get("brand"),
            "city": tags.get("addr:city"),
            "street": tags.get("addr:street"),
            "housenumber": tags.get("addr:housenumber"),
            "phone": tags.get("phone") or tags.get("contact:phone"),
            "website": tags.get("website") or tags.get("contact:website"),
            "category": category,
            "lat": round(lat, 6),
            "lon": round(lon, 6),
        })

    def node(self, n):
        if self._add_locality(n, n.location.lat, n.location.lon):
            return
        self._add(n, n.location.lat, n.location.lon, "node")

    def way(self, w):
        # A shop mapped as a building outline still only ever draws as a dot
        # here, so reduce it to the average of its nodes. This avoids the area
        # assembler entirely, which needs a second pass and buys us nothing.
        lats, lons = [], []
        for node in w.nodes:
            try:
                if node.location.valid():
                    lats.append(node.location.lat)
                    lons.append(node.location.lon)
            except osmium.InvalidLocationError:
                continue
        if lats:
            self._add(w, sum(lats) / len(lats), sum(lons) / len(lons), "way")


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser(description="Build a local OSM business index")
    ap.add_argument("--refresh", action="store_true", help="re-download the extract")
    ap.add_argument("--pbf", type=Path, default=PBF)
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    download(args.pbf, args.refresh)

    print("reading %s" % args.pbf.name)
    started = time.time()
    handler = PoiHandler()
    handler.apply_file(str(args.pbf), locations=True)

    rows = handler.rows
    rows.sort(key=lambda r: r["name"])
    args.out.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")

    localities = sorted(handler.places, key=lambda r: r["name"])
    PLACES_OUT.write_text(json.dumps(localities, ensure_ascii=False), encoding="utf-8")

    hebrew = sum(1 for r in rows
                 if any("֐" <= c <= "׿" for c in (r["name_he"] or r["name"])))
    print("\n%d named businesses in %.0fs" % (len(rows), time.time() - started))
    print("  with a Hebrew name : %d" % hebrew)
    print("  with a phone       : %d" % sum(1 for r in rows if r["phone"]))
    print("  with a website     : %d" % sum(1 for r in rows if r["website"]))
    print("  localities         : %d" % len(localities))
    print("wrote %s (%.1f MB) and %s"
          % (args.out.name, args.out.stat().st_size / 1e6, PLACES_OUT.name))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
