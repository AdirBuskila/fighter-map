#!/usr/bin/env python3
"""
Phase 1b - fold a fresh CSV export of the same sheet into raw_rows.json.

fighter.pdf is a snapshot. The sheet it was printed from keeps filling up, and
a CSV export of that sheet is strictly better input than the PDF: no bidi
damage, no column overflow, and the voucher column intact on rows where the
PDF's ruling lines lost it.

This does not REPLACE raw_rows.json, and that is deliberate. Re-keying the
whole corpus off a second source would churn every source_key already in the
database to buy nothing. It adds only the cells the PDF does not already have.

Two things make that diff harder than it sounds.

  1. It has to run at CELL granularity, not row. The two sources disagree per
     cell rather than per row: ten rows the PDF extracted carry a voucher cell
     it dropped entirely, so keying on "have we seen this timestamp" would
     silently skip ten real places.
  2. Cell text cannot be compared literally. 01_extract.py's RTL repair
     reorders Latin islands ("Beer garden אילת" -> "אילת Beer garden"), joins
     words the sheet had spaced ("ביגוד B" -> "ביגודB") and drops a URL's
     scheme. So a cell is fingerprinted by its tokens, sorted, stripped of
     punctuation and case.

The fingerprint is loose on purpose, and the check that it is not TOO loose is
temporal: no CSV cell newer than the PDF's last row may match anything in it.
Against the current export that holds - 922 of 998 cells match, every
unmatched one is either newer than the PDF or a voucher cell the PDF lost, and
zero post-snapshot cells match. --verify re-runs exactly that.

The refund column stays ignored, the same call 01_extract.py makes: this map
is about the card and the voucher, and a refund is neither.

Idempotent. A rerun after the sheet grows adds only what grew.

Usage:
    python scripts/01b_csv_rows.py --verify        # diff only, writes nothing
    python scripts/01b_csv_rows.py --dry-run
    python scripts/01b_csv_rows.py
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "places.csv"
ROWS_PATH = ROOT / "data" / "raw_rows.json"
NEW_PATH = ROOT / "data" / "csv_new_cells.json"

# Column order in the sheet export, left to right. Index 1 is the refund
# column, ignored here for the same reason 01_extract.py ignores it.
COL_DATE, COL_REFUND, COL_VOUCHER, COL_FIGHTER = 0, 1, 2, 3

FIELDS = {COL_VOUCHER: "vacation_voucher", COL_FIGHTER: "fighter_card"}

# The bidi repair loses the space where a Hebrew word meets a Latin one, so
# the sheet's "ביגוד B" comes out of the PDF as "ביגודB" and "מועדון ה-MAZE"
# as "MAZEמועדון ה". Splitting at every script boundary makes both sides agree.
SCRIPT_EDGE = re.compile(
    r"(?<=[֐-׿])(?=[A-Za-z0-9])|(?<=[A-Za-z0-9])(?=[֐-׿])"
)
# A URL's scheme is the one token the repair reliably drops: the sheet's
# "https://www.ellasun.co.il/" is printed as "/www.ellasun.co.il".
SCHEME_TOKENS = {"https", "http"}


def fingerprint(text: str) -> str:
    """Order- and punctuation-insensitive identity for one cell of free text."""
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = SCRIPT_EDGE.sub(" ", text)
    text = re.sub(r"[^\w֐-׿]+", " ", text)
    tokens = (t for t in text.lower().split() if t and t not in SCHEME_TOKENS)
    return " ".join(sorted(tokens))


def parse_stamp(text: str) -> str | None:
    """The sheet writes dd/mm/yyyy hh:mm:ss; raw_rows.json holds ISO 8601."""
    text = text.strip()
    if not text:
        return None
    try:
        return datetime.strptime(text, "%d/%m/%Y %H:%M:%S").isoformat()
    except ValueError:
        print("  unparseable timestamp %r, treating the row as undated" % text[:40],
              file=sys.stderr)
        return None


def read_csv_cells(path: Path) -> list:
    """One record per non-empty benefit cell, in sheet order."""
    with path.open(encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.reader(fh))
    if not rows:
        sys.exit("%s is empty" % path)

    cells = []
    for line_no, row in enumerate(rows[1:], start=2):
        if len(row) <= COL_FIGHTER:
            continue
        stamp = parse_stamp(row[COL_DATE])
        for col, field in FIELDS.items():
            text = row[col].strip()
            if text:
                cells.append({"row": line_no, "reported_at": stamp,
                              "field": field, "text": text})
    return cells


def existing_fingerprints(rows: list) -> set:
    seen = set()
    for row in rows:
        for field in FIELDS.values():
            text = (row.get(field) or "").strip()
            if text:
                seen.add(fingerprint(text))
    return seen


def diff(cells: list, rows: list) -> tuple:
    """Return (new_cells, snapshot_end) where snapshot_end is the newest
    timestamp the PDF got to, which is what the verification leans on."""
    seen = existing_fingerprints(rows)
    stamps = [r["reported_at"] for r in rows if r.get("reported_at")]
    snapshot_end = max(stamps) if stamps else None
    new = [c for c in cells if fingerprint(c["text"]) not in seen]
    return new, snapshot_end


def verify(cells: list, new: list, snapshot_end: str | None) -> int:
    """A cell recorded after the PDF was printed cannot already be in it.

    If one appears to be, the fingerprint has collapsed two different cells
    into one and the diff is dropping real places. That is the failure worth
    catching, because it is silent: the run just reports fewer new cells.
    """
    if snapshot_end is None:
        print("raw_rows.json carries no timestamps, nothing to verify against")
        return 0
    new_rows = {(c["row"], c["field"]) for c in new}
    false_matches = [
        c for c in cells
        if c["reported_at"] and c["reported_at"] > snapshot_end
        and (c["row"], c["field"]) not in new_rows
    ]
    print("PDF snapshot ends at      : %s" % snapshot_end)
    print("cells recorded after it   : %d"
          % sum(1 for c in cells if c["reported_at"] and c["reported_at"] > snapshot_end))
    print("of those, wrongly matched : %d" % len(false_matches))
    for c in false_matches[:10]:
        print("    row %s %s %r" % (c["row"], c["field"], c["text"][:60]))
    return 1 if false_matches else 0


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser(description="Merge a sheet CSV export into raw_rows.json")
    ap.add_argument("--csv", type=Path, default=CSV_PATH)
    ap.add_argument("--rows", type=Path, default=ROWS_PATH)
    ap.add_argument("--new", type=Path, default=NEW_PATH,
                    help="where to write just the added cells, for Phase 2")
    ap.add_argument("--verify", action="store_true", help="check the diff, write nothing")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.csv.exists():
        sys.exit("%s does not exist" % args.csv)
    if not args.rows.exists():
        sys.exit("%s does not exist. Run scripts/01_extract.py first." % args.rows)

    rows = json.loads(args.rows.read_text(encoding="utf-8"))
    cells = read_csv_cells(args.csv)
    new, snapshot_end = diff(cells, rows)

    print("=" * 62)
    print("CHECKPOINT 1b")
    print("=" * 62)
    print("cells in %-16s : %d" % (args.csv.name, len(cells)))
    print("already in raw_rows.json  : %d" % (len(cells) - len(new)))
    print("new                       : %d" % len(new))
    for field in FIELDS.values():
        print("    %-21s %d" % (field, sum(1 for c in new if c["field"] == field)))
    print("    %-21s %d" % ("newer than the PDF",
                            sum(1 for c in new if c["reported_at"] and snapshot_end
                                and c["reported_at"] > snapshot_end)))
    print("    %-21s %d" % ("cells the PDF lost",
                            sum(1 for c in new if not (c["reported_at"] and snapshot_end
                                and c["reported_at"] > snapshot_end))))
    print()
    failed = verify(cells, new, snapshot_end)

    # One raw row per added cell. A row here is a single benefit rather than a
    # pair, because the added cells are mostly the other half of a row the PDF
    # already contributed, and pairing them again would duplicate that half.
    # page is null: this cell did not come off a page.
    added = [
        {
            c["field"]: c["text"],
            ("vacation_voucher" if c["field"] == "fighter_card" else "fighter_card"): None,
            "reported_at": c["reported_at"],
            "page": None,
            "row": c["row"],
        }
        for c in new
    ]

    if args.verify:
        print("\nverify only, nothing written")
        return failed
    if not new:
        print("\nnothing to add")
        return failed

    args.new.write_text(json.dumps(added, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\nwrote %d added cells -> %s" % (len(added), args.new))

    if args.dry_run:
        print("dry run, raw_rows.json left alone")
        return failed

    args.rows.write_text(json.dumps(rows + added, ensure_ascii=False, indent=2),
                         encoding="utf-8")
    print("raw_rows.json now holds %d rows (was %d)" % (len(rows) + len(added), len(rows)))
    return failed


if __name__ == "__main__":
    raise SystemExit(main())
