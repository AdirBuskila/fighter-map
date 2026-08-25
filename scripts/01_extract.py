#!/usr/bin/env python3
"""
Phase 1 - extract the Fighter benefit spreadsheet from fighter.pdf.

Why not page.extract_text():
    The document is a Hebrew (RTL) spreadsheet export. pdfplumber emits glyphs in
    *visual* order, so plain extraction reverses every Hebrew word and interleaves
    the four columns. Two further traps in this particular file:

    1. Cells are CENTRE aligned, and a cell whose text is wider than its column
       overflows past the ruling lines on both sides. A word-by-word column
       assignment therefore drops fragments of the (ignored) refund column into
       the voucher and fighter columns.
    2. When that happens the overflow is drawn on the same baseline as the
       neighbouring cell, so sorting glyphs by x interleaves the two strings
       character by character ("aXbYcZ" out of "abc" and "XYZ").

    Both are solved by working with *drawn runs*: consecutive characters in the
    content stream that are geometrically contiguous. A run is exactly one text
    fragment as the exporter emitted it, so it never mixes two cells, and it is
    assigned to a column by its own centroid.

Pipeline per page:
    1. Column boundaries  <- vertical ruling edges (fallback: previous page)
    2. Row boundaries     <- horizontal ruling edges (fallback: `top` clustering)
    3. Chars -> drawn runs -> (row, column) by run centroid
    4. Each run reordered right-to-left, runs in a cell joined top-down
    5. Drop repeated header rows; margin annotations fall outside the rules

Output: data/raw_rows.json
    [{ "fighter_card": str|null, "vacation_voucher": str|null,
       "reported_at": ISO8601|null, "page": int, "row": int }]

Idempotent and resumable: a pure function of fighter.pdf, safe to rerun.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
PDF_PATH = ROOT / "fighter.pdf"
OUT_PATH = ROOT / "data" / "raw_rows.json"

# Column order on the page, left to right. Index 1 is the refund column, which
# the brief says to ignore entirely.
COL_DATE, COL_REFUND, COL_VOUCHER, COL_FIGHTER = 0, 1, 2, 3

# ---------------------------------------------------------------- bidi repair

HEBREW = re.compile(r"[֐-׿יִ-ﭏ]")
LATIN = re.compile(r"[A-Za-z]")
# In an RTL run the PDF stores the *mirrored* glyph, so undo it when we reverse.
MIRROR = str.maketrans("()[]{}<>“”", ")(][}{><”“")
# Latin / numeric islands inside a Hebrew word keep their own LTR direction.
LTR_ISLAND = re.compile(r"[A-Za-z0-9][A-Za-z0-9.,:/&+_'\-]*")


def fix_token(text: str) -> str:
    """Restore logical character order for a single extracted word."""
    if not HEBREW.search(text):
        return text  # Latin / digits / punctuation are already logical
    flipped = text.translate(MIRROR)[::-1]
    return LTR_ISLAND.sub(lambda m: m.group(0)[::-1], flipped)


def order_run(tokens: list) -> str:
    """Rebuild one drawn run into logical reading order.

    Tokens arrive left-to-right. In an RTL run the logical first word sits
    furthest right, so we walk right-to-left, except that a contiguous group of
    Latin words is an embedded LTR island and keeps its own order
    ("Beer garden", not "garden Beer").
    """
    groups = []
    for t in tokens:
        latin = bool(LATIN.search(t)) and not HEBREW.search(t)
        if latin and groups and groups[-1][0]:
            groups[-1][1].append(t)
        else:
            groups.append((latin, [t]))
    parts = [" ".join(fix_token(t) for t in group) for _, group in reversed(groups)]
    return " ".join(parts)


# ------------------------------------------------------------------ geometry


def cluster(values: list, tol: float) -> list:
    """Collapse near-identical coordinates (one ruled line yields several edges)."""
    out = []
    for v in sorted(values):
        if out and v - out[-1][-1] <= tol:
            out[-1].append(v)
        else:
            out.append([v])
    return [sum(g) / len(g) for g in out]


def column_bounds(page):
    xs = cluster([e["x0"] for e in page.edges if e["orientation"] == "v"], tol=3.0)
    # The table is the leftmost four-column block; the sheet's margin notes are
    # ruled separately to the right of it.
    xs = [x for x in xs if x < page.width - 40]
    return xs[:5] if len(xs) >= 5 else None


def row_bounds(page, tops: list):
    ys = cluster([e["top"] for e in page.edges if e["orientation"] == "h"], tol=3.0)
    if len(ys) >= 3:
        return ys
    if not tops:
        return None
    # Fallback: cluster baselines and cut midway between consecutive lines.
    lines = cluster(tops, tol=3.0)
    cuts = [lines[0] - 6.0]
    cuts += [(a + b) / 2 for a, b in zip(lines, lines[1:])]
    cuts.append(lines[-1] + 12.0)
    return cuts


def bucket(value: float, bounds: list):
    for i in range(len(bounds) - 1):
        if bounds[i] <= value < bounds[i + 1]:
            return i
    return None


# --------------------------------------------------------------- drawn runs

X_CONTIGUITY = 0.6  # pt; glyphs inside one drawn fragment abut exactly
Y_SAME_LINE = 1.2  # pt; the exporter jitters the baseline of space glyphs


def drawn_runs(page) -> list:
    """Split the page's characters into the fragments the exporter drew.

    Returns [{"tokens": [str, ...], "x0", "x1", "top", "bottom"}], where tokens
    are the run's words in left-to-right visual order.
    """
    runs = []
    current = None
    for ch in page.chars:
        if current is not None:
            contiguous = (
                abs(ch["x0"] - current["x1"]) <= X_CONTIGUITY
                and abs(ch["top"] - current["top"]) <= Y_SAME_LINE
            )
        else:
            contiguous = False
        if not contiguous:
            current = {
                "chars": [],
                "x0": ch["x0"],
                "x1": ch["x1"],
                "top": ch["top"],
                "bottom": ch["bottom"],
            }
            runs.append(current)
        current["chars"].append(ch["text"])
        current["x1"] = max(current["x1"], ch["x1"])
        current["bottom"] = max(current["bottom"], ch["bottom"])

    out = []
    for r in runs:
        tokens = "".join(r["chars"]).split()
        if tokens:
            r["tokens"] = tokens
            out.append(r)
    return out


# ------------------------------------------------------------------- parsing

TIMESTAMP = re.compile(
    r"(?P<h>\d{1,2}):(?P<mi>\d{2}):(?P<s>\d{2})\D+(?P<d>\d{1,2})/(?P<mo>\d{1,2})/(?P<y>\d{4})"
    r"|(?P<d2>\d{1,2})/(?P<mo2>\d{1,2})/(?P<y2>\d{4})\D+(?P<h2>\d{1,2}):(?P<mi2>\d{2}):(?P<s2>\d{2})"
)


def parse_timestamp(cell):
    if not cell:
        return None
    m = TIMESTAMP.search(cell)
    if not m:
        return None
    g = m.groupdict()
    d, mo, y = g["d"] or g["d2"], g["mo"] or g["mo2"], g["y"] or g["y2"]
    h, mi, s = g["h"] or g["h2"], g["mi"] or g["mi2"], g["s"] or g["s2"]
    try:
        d, mo, y, h, mi, s = int(d), int(mo), int(y), int(h), int(mi), int(s)
    except (TypeError, ValueError):
        return None
    if not (1 <= mo <= 12 and 1 <= d <= 31 and h < 24 and mi < 60 and s < 60):
        return None
    return "%04d-%02d-%02dT%02d:%02d:%02d" % (y, mo, d, h, mi, s)


def squash(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    for junk in ("‎", "‏", " ", "﻿"):
        text = text.replace(junk, " ")
    text = re.sub(r"\s+", " ", text).strip()
    return re.sub(r"^[\s,;.\-–]+|[\s,;]+$", "", text)


HEADER_MARKERS = ("מקום שבו", "תאריך דיווח", "מקומות שבהם", "החזר זוגי")


def is_header_row(cells: list) -> bool:
    joined = " ".join(c for c in cells if c)
    return sum(marker in joined for marker in HEADER_MARKERS) >= 2


# ---------------------------------------------------------------------- main


def extract(pdf_path: Path, verbose: bool = False) -> list:
    rows = []
    cols = None

    with pdfplumber.open(pdf_path) as pdf:
        for page_no, page in enumerate(pdf.pages, start=1):
            cols = column_bounds(page) or cols
            if cols is None:
                print("  page %d: no column rules, skipped" % page_no, file=sys.stderr)
                continue

            runs = drawn_runs(page)
            bounds = row_bounds(page, [r["top"] for r in runs])
            if not bounds:
                continue

            grid = {}
            for r in runs:
                cx = (r["x0"] + r["x1"]) / 2
                cy = (r["top"] + r["bottom"]) / 2
                col = bucket(cx, cols)
                row = bucket(cy, bounds)
                if col is None or row is None:
                    continue  # margin annotations, page furniture
                grid.setdefault(row, {}).setdefault(col, []).append(r)

            for row in sorted(grid):
                cells = []
                for col in range(len(cols) - 1):
                    cell_runs = grid[row].get(col, [])
                    if not cell_runs:
                        cells.append(None)
                        continue
                    # Top-down; within a line the rightmost fragment reads first.
                    cell_runs.sort(key=lambda r: (round(r["top"], 1), -r["x1"]))
                    cells.append(squash(" ".join(order_run(r["tokens"]) for r in cell_runs)) or None)

                if is_header_row(cells):
                    continue
                voucher, fighter = cells[COL_VOUCHER], cells[COL_FIGHTER]
                if not (voucher or fighter):
                    continue
                rows.append(
                    {
                        "fighter_card": fighter,
                        "vacation_voucher": voucher,
                        "reported_at": parse_timestamp(cells[COL_DATE]),
                        "page": page_no,
                        "row": row,
                    }
                )
                if verbose:
                    print("p%-3d r%-3d F=%s | V=%s" % (page_no, row, fighter, voucher))
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description="Extract fighter.pdf into data/raw_rows.json")
    ap.add_argument("--pdf", type=Path, default=PDF_PATH)
    ap.add_argument("--out", type=Path, default=OUT_PATH)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    rows = extract(args.pdf, verbose=args.verbose)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote %d rows -> %s" % (len(rows), args.out))


if __name__ == "__main__":
    main()
