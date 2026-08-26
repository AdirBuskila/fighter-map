#!/usr/bin/env python3
"""
Regenerate the static Heebo cuts the social card needs.

Google ships Heebo only as a variable font, and satori (next/og) cannot read
one: it fails with "Cannot read properties of undefined", which says nothing
about fonts at all. So the weights are pinned into plain static TTFs and
committed. Heebo is SIL Open Font License, so redistributing it is fine.

    python tools/make_fonts.py
"""
import pathlib
import sys

import requests
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

SOURCE = "https://github.com/google/fonts/raw/main/ofl/heebo/Heebo%5Bwght%5D.ttf"
OUT = pathlib.Path(__file__).resolve().parent.parent / "src" / "app" / "_fonts"

def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = OUT / "_heebo-variable.ttf"
    response = requests.get(SOURCE, timeout=60)
    response.raise_for_status()
    tmp.write_bytes(response.content)

    for weight, name in ((400, "Heebo-Regular.ttf"), (800, "Heebo-ExtraBold.ttf")):
        font = TTFont(str(tmp))
        instancer.instantiateVariableFont(font, {"wght": weight}, inplace=True)
        font.save(str(OUT / name))
        print("wrote %s" % name)
    tmp.unlink()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
