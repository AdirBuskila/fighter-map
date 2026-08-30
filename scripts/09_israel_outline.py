#!/usr/bin/env python3
"""
Turn israel.svg into the outline the hero draws.

The source is a MapSVG export with eight district paths plus a compound `PS`
path holding two subpaths. It cannot be used as-is for three reasons, and this
script exists to deal with all three in a way somebody can re-run and check
rather than trust.

1. THE GAZA SUBPATH COMES OUT.

   `PS` is Gaza *and* Judea and Samaria in one path. Judea and Samaria has to
   stay -- בית אל, שילה and מעלה אדומים are all there and all have places in
   the corpus -- so the path has to be split rather than dropped.

   The two are told apart by centroid, not by index: Gaza sits at roughly
   34.39E 31.40N and Judea and Samaria at 35.23E 32.00N, so whichever subpath
   is further west is Gaza. Indices would silently pick the wrong one if the
   file is ever re-exported in a different order.

2. THE RELATIVE-MOVETO TRAP.

   Every path in the file is written with a relative `m` and implicit relative
   linetos. The second subpath's `m` is relative to the *start of the first
   subpath*, which is where the pen sits after `z`. So splitting the compound
   path means re-anchoring it.

   The obvious way to re-anchor -- rewrite the leading `m` as an absolute `M`
   -- is wrong, and wrong silently. After `M`, the following coordinate pairs
   are implicit *absolute* linetos, not relative ones, so all 175 of them are
   reinterpreted: the shape scatters across the canvas and draws a long
   diagonal line through the map. It renders, it throws nothing, and it looks
   like a styling bug. This script converts every subpath to explicit absolute
   M/L commands instead, so there is no leading-command ambiguity left.

3. THE PROJECTION HAS TO COME FROM THE FILE.

   The export carries `mapsvg:geoViewBox`, which is what makes lat/lng to SVG
   a documented mapping rather than a fitted guess. It is read out here and
   written into the module beside the paths, so the two can never drift.

    python scripts/09_israel_outline.py            # writes src/lib/israel-outline.ts
    python scripts/09_israel_outline.py --check    # verify without writing
"""

from __future__ import annotations

import argparse
import io
import os
import re
import sys

SOURCE = "israel.svg"
TARGET = os.path.join("src", "lib", "israel-outline.ts")

PATH_RE = re.compile(r'<path\s+d="([^"]+)"\s+title="([^"]*)"\s+id="([^"]*)"', re.S)
GEO_RE = re.compile(r'mapsvg:geoViewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"')
SIZE_RE = re.compile(r'width="([\d.]+)"\s+height="([\d.]+)"')
TOKEN_RE = re.compile(r"([MmZzLlHhVvCcSsQqTtAa])|(-?\d*\.?\d+)")


def to_absolute(d: str) -> list[str]:
    """Every subpath of `d`, as explicit absolute M/L commands.

    The source only ever uses `m` and `z`, so this handles those and refuses
    anything else rather than quietly mis-drawing a curve it does not know.
    """
    seq: list[tuple[str, object]] = []
    for letter, number in TOKEN_RE.findall(d):
        seq.append(("cmd", letter) if letter else ("num", float(number)))

    subpaths: list[str] = []
    current: list[str] | None = None
    pen = (0.0, 0.0)
    start = (0.0, 0.0)
    command = None
    i = 0
    while i < len(seq):
        kind, value = seq[i]
        if kind == "cmd":
            command = value
            i += 1
            if command in "Zz":
                if current:
                    current.append("Z")
                    subpaths.append(" ".join(current))
                    current = None
                # After a closepath the pen returns to the subpath's start,
                # which is what the next relative moveto is measured from.
                pen = start
            continue

        numbers: list[float] = []
        while i < len(seq) and seq[i][0] == "num":
            numbers.append(seq[i][1])
            i += 1
        if command not in ("m", "M"):
            sys.exit("unsupported path command %r in %s" % (command, SOURCE))

        x, y = numbers[0], numbers[1]
        pen = (pen[0] + x, pen[1] + y) if command == "m" else (x, y)
        start = pen
        if current:
            subpaths.append(" ".join(current))
        current = ["M %.5f,%.5f" % pen]
        for j in range(2, len(numbers) - 1, 2):
            dx, dy = numbers[j], numbers[j + 1]
            pen = (pen[0] + dx, pen[1] + dy) if command == "m" else (dx, dy)
            current.append("L %.5f,%.5f" % pen)

    if current:
        subpaths.append(" ".join(current))
    return subpaths


def centroid(d: str) -> tuple[float, float]:
    xs = [float(v) for v in re.findall(r"[ML] (-?[\d.]+),", d)]
    ys = [float(v) for v in re.findall(r"[ML] -?[\d.]+,(-?[\d.]+)", d)]
    return sum(xs) / len(xs), sum(ys) / len(ys)


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser(description="Generate the hero outline module")
    ap.add_argument("--check", action="store_true",
                    help="report what would be written, and exit non-zero if stale")
    args = ap.parse_args()

    if not os.path.exists(SOURCE):
        sys.exit("%s is missing. It is the source of the outline and is committed "
                 "alongside this script." % SOURCE)

    svg = io.open(SOURCE, encoding="utf-8").read()
    geo = GEO_RE.search(svg)
    size = SIZE_RE.search(svg)
    if not geo or not size:
        sys.exit("%s has no mapsvg:geoViewBox or no width/height; the projection "
                 "cannot be derived from it." % SOURCE)
    lng_lo, lat_hi, lng_hi, lat_lo = (float(g) for g in geo.groups())
    width, height = (float(s) for s in size.groups())

    shapes: list[tuple[str, str, str]] = []
    for d, title, pid in PATH_RE.findall(svg):
        parts = to_absolute(d)
        if len(parts) == 1:
            shapes.append((pid, title, parts[0]))
            continue
        # The compound path. Whichever subpath sits furthest west is Gaza.
        west = min(range(len(parts)), key=lambda k: centroid(parts[k])[0])
        for index, part in enumerate(parts):
            if index == west:
                cx, cy = centroid(part)
                print("  dropping %s subpath %d (centroid %.3fE %.3fN) = Gaza"
                      % (pid, index, lng_lo + (cx / width) * (lng_hi - lng_lo),
                         lat_hi - (cy / height) * (lat_hi - lat_lo)))
                continue
            shapes.append(("%s-%d" % (pid, index), "Judea and Samaria", part))

    for pid, title, d in shapes:
        cx, cy = centroid(d)
        assert 0 <= cx <= width and 0 <= cy <= height, \
            "%s has a centroid outside the viewBox" % pid

    body = ",\n".join(
        '  { id: %r, title: %r, d: %r }' % (pid, title, d) for pid, title, d in shapes
    ).replace("'", '"')

    module = '''/**
 * The outline the landing-page hero draws, and the projection that puts places
 * on it.
 *
 * GENERATED by scripts/09_israel_outline.py from israel.svg. Do not hand-edit:
 * re-run the script, which is also where the reasoning lives for why Gaza is
 * removed from the compound path, why the two subpaths are told apart by
 * centroid rather than index, and why every path here is absolute.
 */

export type OutlineShape = { id: string; title: string; d: string };

/** Viewport of the source export, and therefore of every path below. */
export const OUTLINE_WIDTH = %(width)s;
export const OUTLINE_HEIGHT = %(height)s;

/**
 * The geographic box the artwork covers, read out of the source file's own
 * `mapsvg:geoViewBox`. It lives next to the paths so the two cannot drift:
 * a re-export with a different box regenerates both together.
 */
export const OUTLINE_GEO = {
  lngLo: %(lng_lo)s,
  latHi: %(lat_hi)s,
  lngHi: %(lng_hi)s,
  latLo: %(lat_lo)s,
};

export const ISRAEL_OUTLINE: OutlineShape[] = [
%(body)s,
];

/** Where a place sits on the outline, in its SVG coordinates. */
export function projectToOutline(lat: number, lng: number): { x: number; y: number } {
  const { lngLo, latHi, lngHi, latLo } = OUTLINE_GEO;
  return {
    x: ((lng - lngLo) / (lngHi - lngLo)) * OUTLINE_WIDTH,
    y: ((latHi - lat) / (latHi - latLo)) * OUTLINE_HEIGHT,
  };
}

/**
 * Whether a projected point is on the artwork at all.
 *
 * The hero asserts this per place before rendering. It is the same guard as
 * BOUNDS in scripts/07_add_reported.py and it catches the same thing: a
 * coordinate that is quietly wrong draws a dot in the sea, looks deliberate,
 * and nobody notices for weeks.
 */
export function isOnOutline(x: number, y: number): boolean {
  return x >= 0 && x <= OUTLINE_WIDTH && y >= 0 && y <= OUTLINE_HEIGHT;
}
''' % {"width": width, "height": height, "lng_lo": lng_lo, "lat_hi": lat_hi,
       "lng_hi": lng_hi, "lat_lo": lat_lo, "body": body}

    print("  %d shapes, viewBox %g x %g, geo %gE..%gE %gN..%gN"
          % (len(shapes), width, height, lng_lo, lng_hi, lat_lo, lat_hi))

    existing = io.open(TARGET, encoding="utf-8").read() if os.path.exists(TARGET) else None
    if args.check:
        if existing == module:
            print("%s is up to date" % TARGET)
            return 0
        print("%s is STALE; re-run without --check" % TARGET)
        return 1

    io.open(TARGET, "w", encoding="utf-8", newline="\n").write(module)
    print("wrote %s (%.1f KB)" % (TARGET, len(module) / 1024))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
