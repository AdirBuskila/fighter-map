# A landing page whose hero is the data

## The problem

There is nowhere to send someone who has not used the site.

`/` is the working tool: a map, a filter bar and a thousand-row list. That is
right for a reservist standing outside a shop, and wrong for the WhatsApp
message that says "there's a map for this". A first-time reader lands in the
middle of an interface and has to infer what it is, who made it, and why the
information should be believed — three questions the map does not answer
because it is busy answering a fourth.

The request that started this was "give it a 2026 feel". The honest version of
that is not decoration. It is: make the thing explain itself in one screen, and
make the explanation something no competitor could copy.

## Why not ThreeUI

The brief named [ThreeUI](https://github.com/MengTo/threeui) as the reference.
It was investigated and rejected as a dependency. Three findings decided it,
each checked rather than assumed:

- **Its components are iframes, not React.** Every one renders as
  `<iframe sandbox="allow-scripts" srcDoc="<!DOCTYPE html>…">` wrapping a
  complete standalone page, configured over `postMessage`.
- **They are finished marketing pages.** 34 component sources were sampled and
  **none** was copy-free; each carries 140–620 words of baked-in English.
  `TopoField`, which looked like a contour-line backdrop, is a hero section
  reading "Orchestrate the neural…".
- **They fetch third parties at runtime, from the reader's browser.** Most load
  `cdn.tailwindcss.com`; several add `cdnjs.cloudflare.com` and
  `code.iconify.design`. `flow-field` loads `static.cloudflareinsights.com`
  (analytics) and `glassmorphism-cta` calls a Supabase project belonging to the
  library's author.

That last point is disqualifying on its own. `/api/search` exists in the shape
it does specifically so "the reader's browser never talks to a third party, so
no address of theirs leaves this origin". Embedding these would undo that
deliberately. All 12 sampled were also `lang="en"` and LTR, which no Hebrew RTL
page can use.

ThreeUI stays as a moodboard. The aesthetic it sells — constellation fields,
topographic point clouds — is genuinely right for a map product. The packaging
is not.

## The design

**The hero is the real map, drawn by its own pins.**

Israel's outline, with every currently pinned place igniting as a dot in a wave
that runs from the Negev northward — fighter blue circles, voucher amber
diamonds, the same two shapes the map already uses. Beside it, one Hebrew line
and the counts.

The wow is that it is true. It needs no copy to explain the product, it cannot
be reproduced by anyone without this dataset, and it obeys the road-signage
system in `globals.css` rather than fighting it: no decorative gradient, no
glow, no ornament. The scale and the motion do the work, and the only colour is
the data — which is the same rule `design/README.md` sets for the basemap.

Two alternatives were mocked and rejected: a split-flap highway sign (cheapest,
but says nothing about coverage) and a country-to-doorway zoom (most cinematic,
heaviest to tune, and it dramatises a journey rather than showing evidence).

### Route

A new `/about`. `/` stays exactly as it is, so every shared link keeps meaning
what it meant and both smoke suites keep passing untouched. Linked from the
masthead and the footer.

### Data

Reuse `fetchMappedPlaces()` from `src/lib/places.ts`. It already calls the
`places_all` RPC, so there is no new query, no new RLS surface and no second
definition of "a place worth drawing". The page is a server component with
`export const revalidate = 120`, the same window `page.tsx` and
`place/[id]/page.tsx` already use; there is no reason for the landing page to
be fresher or staler than the map it advertises.

The published total is a second, cheap count — a `head: true` select with
`count: "exact"` on `places` filtered to `status = 'published'` — because
`fetchMappedPlaces()` returns only the pinned rows and cannot know it.

Counts are computed per render, never hardcoded. This matters more than it
looks: the corpus moved from 935 to 1010 rows during the design of this page,
and a baked-in number would already be wrong.

### The numbers, and the gap between them

Three counts are true at once, and the page has to be honest about all three:

| | now |
|---|---|
| Published places | 1003 |
| Of those, with coordinates | 271 |
| Queued in `/admin` | 6 |

The hero draws 271 dots while the site holds 1003 places. That gap is not an
embarrassment to hide — since `0006_pin_unavailable.sql` it is a documented
property of the corpus, and it is explainable in one line: OpenStreetMap does
not know most small Israeli businesses, so the rest are listed rather than
mapped. The stat row therefore shows the published total *and* the mapped
count, rather than picking whichever is larger. Concretely, three figures:
published total, fighter-card count, voucher count — the last two taken from
the pinned set the hero is drawing, and labelled so it is clear which is which.

**Copy is provisional.** The mockup reads `איפה הכרטיס באמת עובד.` over
`כל נקודה כאן היא מקום שמילואימניק שילם בו ודיווח. בלי פרסומות, בלי הבטחות.`
with `פתחו את המפה` and `הוסיפו מקום`. That is a starting point to react to,
not a decision; the layout does not depend on the exact words.

### Geometry

The outline ships as `src/lib/israel-outline.ts`: eight absolute path strings
derived from `israel.svg` by a parser, not by hand.

`israel.svg` itself must be committed. It is currently untracked at the repo
root, and without it the derived module is a wall of coordinates nobody can
regenerate or check. The derivation script belongs in `scripts/` for the same
reason.

The Gaza Strip is removed. It is the first subpath of the file's `PS` compound
path; Judea and Samaria is the second, and it stays, because בית אל, שילה and
מעלה אדומים are all there and all have places in the corpus. The two are told
apart by centroid — Gaza at 34.390°E/31.402°N, Judea and Samaria at
35.234°E/31.996°N — rather than by index, so the derivation survives the file
being re-exported.

**The trap, recorded because it was already fallen into once.** The second
subpath begins with a *relative* `m`, and rewriting it as `M` to re-anchor it
also silently reinterprets all 175 following linetos from relative to absolute,
which scatters the shape across the canvas and draws a stray diagonal line. The
subpath must be converted to absolute coordinates properly, or left relative
with an absolute start.

Projection is one documented function using the file's own
`mapsvg:geoViewBox="34.228663 33.434207 35.935383 29.496766"`:

```
x = (lng - 34.228663) / (35.935383 - 34.228663) * 294.62534
y = (33.434207 - lat) / (33.434207 - 29.496766) * 792.60406
```

### Rendering

Inline SVG in the server component: one `<circle>` or `<rect>` per pinned
place, each carrying an `animation-delay` computed server-side from its
latitude so the wave runs south to north.

**No client JavaScript, no WebGL, no canvas.** It works with JS off, it cannot
contend with MapLibre for the GPU, and it sidesteps every failure mode in this
project's smoke-test history — the 60,719px map pane, the worker that requested
no tiles, the masthead that reported itself pinned and was not. A hero that
renders as static markup cannot fail in any of those ways.

Colours come from existing tokens, so light and dark follow for free. The page
inherits `dir="rtl"` from the layout; the mockups were rebuilt in RTL after the
first pass was silently mirrored.

### Motion

- Desktop: opacity and `transform: scale`. Measured on the mockup at 270 dots —
  158 frames, 16.7 ms median, **0 frames over 32 ms**.
- Under 860px: opacity only. Scaling 270 SVG nodes forces geometry
  re-rasterisation every frame; the stagger is what carries the wave, not the
  pop, so dropping scale costs nothing visible and removes the per-frame work.
- `prefers-reduced-motion: reduce`: the finished constellation, no wave.

### Layout

Side by side above 860px, map on the left and copy on the right in RTL.
Stacked below it, map first — Israel is tall and narrow and so is a phone, so
the map stays the largest thing on screen without overlapping text.

## Failure and edge cases

- `fetchMappedPlaces()` already logs and returns `[]` when the RPC fails. The
  hero then renders outline, copy and counts of zero rather than blanking. The
  page must never depend on the dots existing.
- Every projected point is asserted inside the viewBox before render — the same
  class of guard as `BOUNDS` in `07_add_reported.py`, catching the same class of
  bug, a geocoder quietly returning the middle of the Atlantic.
- A place with `lat` or `lng` null never reaches the hero; `places_all` filters
  `location is not null`.

## Testing

- `npm run check` for types and lint.
- A projection unit check: known lat/lng pairs land at known SVG coordinates,
  and every real point is inside the viewBox.
- A smoke check that `/about` renders a dot count matching what the API
  reports, in the existing `tools/smoke.js`, at both viewports.
- No new colours, so `scripts/check_palette.py` is unaffected.

## Cost, and when to revisit

271 dots is roughly 30 KB of HTML before gzip. Worth revisiting past ~1500
pinned places, at which point the options are decimating by zoom or moving the
field to a single `<path>`.

## What this deliberately does not do

- It does not touch `/`, the map, the list or the add flow.
- It adds no dependency. Not ThreeUI, not three.js, not an animation library.
- It does not put a second WebGL context on any page.
- It does not hardcode a count, an outline that was hand-traced, or a
  coordinate that was guessed.
