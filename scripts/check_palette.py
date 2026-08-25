#!/usr/bin/env python3
"""
Check that the two benefit colours survive colour blindness and small sizes.

The whole map hinges on telling a fighter-card place from a vacation-voucher
place at the size of a dot, so this is a real constraint, not decoration.

Runs three checks:
  1. CIEDE2000 between the two benefit colours under normal vision and under
     simulated protanopia, deuteranopia and tritanopia (Vienot 1999).
     Anything under 20 is too close to trust at dot size.
  2. WCAG contrast of each colour used as text against both page backgrounds.
  3. Contrast of the label that sits on top of each colour used as a fill.

Usage: python scripts/check_palette.py
"""

from __future__ import annotations

import math
import sys

# Keep in sync with the tokens at the top of src/app/globals.css. Each theme
# gets its own accent values: one blue cannot be both dark enough for a white
# page and light enough for a dark one.
THEMES = {
    "light": {
        "bg":      "#F6F7F5",
        "ink":     "#0E1116",
        "fighter": "#1B4FD8",   # signage blue
        "voucher": "#A66100",   # signage amber
        "warn":    "#A8321E",
        "ok":      "#1C6438",
    },
    "dark": {
        "bg":      "#12151A",
        "ink":     "#EDF0F3",
        "fighter": "#7DA5FF",
        "voucher": "#E0A03A",
        "warn":    "#FF9080",
        "ok":      "#74D3A0",
    },
}

# Accents that are ever used as a solid fill with a label on top. The voucher
# amber is deliberately absent: darkening it enough to read on the page and
# lightening it enough to carry dark text pull in opposite directions, so it is
# only ever a dot, a border or text, never a filled button.
ON_ACCENT = {
    "light": {"fighter": "#FFFFFF", "warn": "#FFFFFF"},
    "dark":  {"fighter": "#0B1020", "warn": "#2A0B06"},
}

VIENOT = {
    "protanopia": (
        (0.11238, 0.88762, 0.0),
        (0.11238, 0.88762, 0.0),
        (0.00401, -0.00401, 1.0),
    ),
    "deuteranopia": (
        (0.29275, 0.70725, 0.0),
        (0.29275, 0.70725, 0.0),
        (-0.02234, 0.02234, 1.0),
    ),
    "tritanopia": (
        (1.0, 0.14461, -0.14461),
        (0.0, 1.0, 0.0),
        (0.0, 0.85924, 0.14076),
    ),
}


def hex_to_rgb(value: str):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def to_srgb(c: float) -> float:
    c = max(0.0, min(1.0, c))
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def simulate(rgb, matrix):
    lin = [to_linear(c) for c in rgb]
    out = [sum(m[i] * lin[i] for i in range(3)) for m in matrix]
    return tuple(to_srgb(c) for c in out)


def relative_luminance(rgb) -> float:
    r, g, b = (to_linear(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b) -> float:
    la, lb = relative_luminance(a), relative_luminance(b)
    lo, hi = sorted((la, lb))
    return (hi + 0.05) / (lo + 0.05)


def to_lab(rgb):
    r, g, b = (to_linear(c) for c in rgb)
    x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375
    y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750
    z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041
    xn, yn, zn = 0.95047, 1.0, 1.08883

    def f(t):
        return t ** (1 / 3) if t > (6 / 29) ** 3 else t / (3 * (6 / 29) ** 2) + 4 / 29

    fx, fy, fz = f(x / xn), f(y / yn), f(z / zn)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def ciede2000(lab1, lab2) -> float:
    l1, a1, b1 = lab1
    l2, a2, b2 = lab2
    kl = kc = kh = 1.0

    c1 = math.hypot(a1, b1)
    c2 = math.hypot(a2, b2)
    cbar = (c1 + c2) / 2
    g = 0.5 * (1 - math.sqrt(cbar**7 / (cbar**7 + 25.0**7))) if cbar > 0 else 0.0

    a1p, a2p = (1 + g) * a1, (1 + g) * a2
    c1p, c2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360 if (a1p or b1) else 0.0
    h2p = math.degrees(math.atan2(b2, a2p)) % 360 if (a2p or b2) else 0.0

    dlp = l2 - l1
    dcp = c2p - c1p
    if c1p * c2p == 0:
        dhp = 0.0
    elif abs(h2p - h1p) <= 180:
        dhp = h2p - h1p
    elif h2p - h1p > 180:
        dhp = h2p - h1p - 360
    else:
        dhp = h2p - h1p + 360
    dHp = 2 * math.sqrt(c1p * c2p) * math.sin(math.radians(dhp) / 2)

    lbar = (l1 + l2) / 2
    cbarp = (c1p + c2p) / 2
    if c1p * c2p == 0:
        hbarp = h1p + h2p
    elif abs(h1p - h2p) <= 180:
        hbarp = (h1p + h2p) / 2
    elif h1p + h2p < 360:
        hbarp = (h1p + h2p + 360) / 2
    else:
        hbarp = (h1p + h2p - 360) / 2

    t = (1 - 0.17 * math.cos(math.radians(hbarp - 30))
         + 0.24 * math.cos(math.radians(2 * hbarp))
         + 0.32 * math.cos(math.radians(3 * hbarp + 6))
         - 0.20 * math.cos(math.radians(4 * hbarp - 63)))
    dtheta = 30 * math.exp(-(((hbarp - 275) / 25) ** 2))
    rc = 2 * math.sqrt(cbarp**7 / (cbarp**7 + 25.0**7)) if cbarp > 0 else 0.0
    sl = 1 + (0.015 * (lbar - 50) ** 2) / math.sqrt(20 + (lbar - 50) ** 2)
    sc = 1 + 0.045 * cbarp
    sh = 1 + 0.015 * cbarp * t
    rt = -math.sin(math.radians(2 * dtheta)) * rc

    return math.sqrt(
        (dlp / (kl * sl)) ** 2
        + (dcp / (kc * sc)) ** 2
        + (dHp / (kh * sh)) ** 2
        + rt * (dcp / (kc * sc)) * (dHp / (kh * sh))
    )


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    failures = []

    for theme, tokens in THEMES.items():
        bg = hex_to_rgb(tokens["bg"])
        fighter = hex_to_rgb(tokens["fighter"])
        voucher = hex_to_rgb(tokens["voucher"])
        print("== %s theme   fighter %s   voucher %s"
              % (theme, tokens["fighter"], tokens["voucher"]))

        print("  1. can the two be told apart?  (CIEDE2000, want >= 20)")
        checks = [("normal vision", fighter, voucher)]
        for name, matrix in VIENOT.items():
            checks.append((name, simulate(fighter, matrix), simulate(voucher, matrix)))
        for name, a, b in checks:
            delta = ciede2000(to_lab(a), to_lab(b))
            ok = delta >= 20
            failures += [] if ok else ["%s/%s deltaE %.1f" % (theme, name, delta)]
            print("     %-14s deltaE %6.1f   %s" % (name, delta, "ok" if ok else "TOO CLOSE"))

        print("  2. is each accent readable as text on the page?  (want >= 4.5)")
        for key in ("fighter", "voucher", "warn", "ok"):
            ratio = contrast(hex_to_rgb(tokens[key]), bg)
            ok = ratio >= 4.5
            failures += [] if ok else ["%s/%s on bg %.2f" % (theme, key, ratio)]
            print("     %-8s %5.2f:1  %s" % (key, ratio, "ok" if ok else "TOO LOW"))

        print("  3. is the label on each filled accent readable?  (want >= 4.5)")
        for key in ON_ACCENT[theme]:
            fg = hex_to_rgb(ON_ACCENT[theme][key])
            ratio = contrast(fg, hex_to_rgb(tokens[key]))
            ok = ratio >= 4.5
            failures += [] if ok else ["%s/label on %s %.2f" % (theme, key, ratio)]
            print("     on %-8s %5.2f:1  %s" % (key, ratio, "ok" if ok else "TOO LOW"))

        ratio = contrast(hex_to_rgb(tokens["ink"]), bg)
        ok = ratio >= 7.0
        failures += [] if ok else ["%s/body text %.2f" % (theme, ratio)]
        print("  4. body text %5.2f:1  %s" % (ratio, "ok" if ok else "TOO LOW"))
        print()

    if failures:
        print("\nFAILED: " + "; ".join(failures))
        return 1
    print("\nall palette checks pass")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
