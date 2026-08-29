# Adding a place by its Google Maps link

## The problem

People email to say a shop honours the card, and cannot add it themselves. The
`/add` form only accepts a pick from the OpenStreetMap typeahead, and OSM does
not know most small Israeli businesses: the import found coordinates for 209 of
610 places, and the same gap that left 396 rows in the moderation queue is what
turns a contributor away at the form.

Every one of these businesses is on Google Maps. So the form should accept a
Google Maps link as a second way to fix a location.

## What changes, and what it costs

`0002_osm_provider.sql` made one claim the whole dataset rests on: a physical
place has one stable external identity, so two people reporting the same shop
land on the same row. `0004_publish_on_arrival.sql` leaned on a second: "they
cannot type a place: `/add` only accepts a pick from the search provider, so
every row is a real business at real coordinates."

This design weakens the second claim on purpose, and defends the first by other
means. Both are worth stating plainly.

**Identity.** There is now more than one issuer. An `osm:node/123` row and a
`gmaps:ftid/0x…:0x…` row for the same shop do not join on their refs. A
proximity-and-name merge replaces that join: before inserting, the route looks
for a published place within 75 m whose name is similar, and turns the
submission into a confirmation of that row. This also catches the case a ref
never could, which is two people pinning the same unlisted shop from two
slightly different dropped pins.

**Typing a place.** A Google link plus a typed name is, in substance, typing a
place. What still holds is narrower but not nothing: the coordinates come from
Google rather than from a text box, they must fall inside Israel, the submitter
is capped at five submissions an hour against a server-computed `ip_hash`, and
under 0004 a row standing on one person's word is drawn hollow and one
`not_working` report pulls it. Publishing stays cheap and removal stays cheap,
which is the trade 0004 already chose.

The alternative was to require the link to carry a Google place id, proving it
points at a listed business rather than a dropped pin. It is rejected because
it fails exactly the places this feature exists for: a small shop that no
database lists well is the one most likely to be shared as a bare pin.

## Placement

The link is a fallback, not a peer of the search. The search stays first,
because when it works it supplies an address, a category and an identity that
joins with the imported corpus. A disclosure sits under it, and opens by itself
the moment a search returns no results, which is the instant the person is
stuck.

## Components

### `src/lib/gmaps.ts` — the parser

Pure, no network, no framework. Takes pasted text, because people paste a link
with a sentence wrapped around it, and finds the first Google-hosted URL in it:
`google.com`, `google.co.il` and other `google.<tld>`, `maps.google.*`,
`goo.gl`, `maps.app.goo.gl`.

Returns `{ lat, lng, providerRef, name, needsExpanding }` or `null`.

**Coordinates**, first match wins:

1. `!8m2!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)` — the place marker Google itself
   resolved. Authoritative.
2. any `!3d…!4d…` pair — same field, older link layouts.
3. `/@(-?\d+\.\d+),(-?\d+\.\d+),` — the viewport centre. On a `/maps/place/`
   URL this is the place, unless the sharer panned before copying, which is why
   it ranks below the marker.
4. `[?&](?:q|query|ll|center|daddr)=(-?\d+\.\d+),\s*(-?\d+\.\d+)`
5. `/maps/search/(-?\d+\.\d+),(-?\d+\.\d+)`

Coordinates outside `29.4 ≤ lat ≤ 33.4`, `34.2 ≤ lng ≤ 35.9` are rejected. That
is the box `06_add_partner.py` already guards its batch with, and a geocoder or
a paste that lands in the Atlantic is the classic way this goes wrong
unnoticed.

**Identity**, first match wins, `null` if none:

1. `!1s(0x[0-9a-f]+):(0x[0-9a-f]+)` → `gmaps:ftid/0x…:0x…`
2. `[?&]cid=(\d+)` → `gmaps:cid/…`
3. `[?&](?:query_place_id|place_id)=([\w-]+)` → `gmaps:place/…`

**Name**: the `/maps/place/<Name>/` segment, `+` to space, URL-decoded, and
discarded when it is really a coordinate pair or a plus code rather than a name.
Only a suggestion; the person confirms or replaces it.

### `src/app/api/resolve-link/route.ts` — the expander

Needed because the Share button on a phone produces `https://maps.app.goo.gl/…`,
which carries no coordinates at all. That is the form most of these links
arrive in, so "regex the URL" alone does not cover the common case. A long URL
never reaches this route; the client parses it directly.

This is an outbound fetch an anonymous caller triggers, so the shape is
deliberately narrow:

- only hosts on a short-link allowlist are ever fetched — `maps.app.goo.gl`,
  `goo.gl`, `g.co`. Any other input is parsed, never requested. This is what
  keeps the route from being a server-side request forgery hole.
- `redirect: "manual"`, at most 3 hops, every hop's host re-checked against the
  Google allowlist before it is followed
- `AbortSignal.timeout(6000)`
- short links are immutable, so `next: { revalidate: 86400 }`

No rate limit of its own. It performs no write, it cannot be aimed anywhere but
Google, and repeats are absorbed by the edge cache; borrowing the five-per-hour
submission budget for a resolve would spend a contributor's quota on getting
the form to work.

With coordinates in hand it also asks Photon's reverse endpoint for a city and
street, so the row is not poorer than one from the search. Photon is already
this project's geocoder. A failure there leaves both null and does not fail the
resolve.

**Expanded, but no coordinates.** Some share links expand to
`/maps/place//data=!4m2!3m1!1s0x…:0x…` — identity, no position. Nothing short of
the paid Google API turns that ref into a point, so the route returns a specific
instruction rather than a generic failure: open the link, then copy the URL out
of the browser's address bar, which will carry `@lat,lng`.

### `src/components/GoogleLinkPicker.tsx`

A disclosure headed `לא מצאתם? הדביקו קישור מגוגל מפות`, opened by default once
a search has returned nothing. Paste triggers a debounced resolve. On success it
shows the pin and a name field, pre-filled from the URL, falling back to
whatever the person already typed into the search box.

It emits the same `PickedPlace` that `PlacePicker` emits, so `AddPlaceForm`
gains a second source and no new submit path. Category cannot be guessed from a
link, so it defaults to `other` and the existing select does the work.

### `src/components/MiniMap.tsx`

A ~160 px MapLibre instance, `interactive: false`, on the existing
`public/map/light.json` and `dark.json` styles, with one marker.

It earns its place because a wrong pin is the main failure mode of this feature
and it is invisible as text — nobody reads `31.8005, 35.3105` and notices it is
the wrong side of town. The renderer and the styles are already in the project.

### `supabase/migrations/0005_link_submissions.sql`

One function:

```sql
place_near_match(p_lat, p_lng, p_name, p_radius_m default 75)
returns table (id uuid, name_he text, name_similarity real, distance_m double precision)
```

`st_dwithin` on the existing GIST index narrows to a handful of rows, then
pg_trgm `similarity(name_he, p_name) > 0.45` picks among them. Both extensions
are enabled in 0001. Only `published` and `reported_not_working` rows are
candidates: merging into a `rejected` row would quietly resurrect it, and
merging into a flagged one is right, since that is the "the business changed its
policy back" signal `/admin` looks for.

The output column is `name_similarity`, not `similarity`, because a `RETURNS
TABLE` column named `similarity` shadows the pg_trgm function of that name
inside the body. That mistake parses cleanly and returns wrong data, which is
the class of bug `check_migration.py` exists to catch.

Requiring proximity **and** name similarity is what keeps גולף and זיפ, two
different shops in one mall, from collapsing into each other.

### `src/app/api/submissions/route.ts`

After the exact `provider_ref` lookup misses, call `place_near_match`. A hit
takes the same branch as an exact hit: widen the benefits, insert a `confirm`
report, return `outcome: "confirmed_existing"`. The contributor lands on that
place's page, so a wrong merge is visible to the one person able to notice it.

The existing "confirm an existing place" body moves into a helper shared by
both paths.

### `src/lib/schemas.ts`

`providerRef` is `z.string().min(1)` today — any string at all. With a second
issuer in play that is too loose, so it becomes a pattern over the issuers that
actually exist:

```
osm:(node|way|relation)/<digits>
gmaps:ftid/0x<hex>:0x<hex>
gmaps:cid/<digits>
gmaps:place/<id>
```

and it becomes nullable, for a link that carries no Google id. `null` is the
honest answer there, and the reasoning is the one `06_add_partner.py` already
records: minting `gmaps:at/31.80,35.31` would write a false identity that a
later submission collides with. The column is nullable and merely `UNIQUE`, and
Postgres permits many nulls, so nothing downstream changes.

## Testing

`tools/gmaps_cases.mjs` — a table of real URLs of every shape above against
expected output, run under Node 22's type stripping so `gmaps.ts` is imported
directly and no test framework is added. Covers: desktop copy-link, `?api=1`
search, `cid`, bare `?q=`, `google.co.il`, a DMS place URL, a link wrapped in a
sentence, a non-Google URL, and coordinates outside Israel.

`scripts/test_api.py` — cases for the merge, and one fix that is not optional:
every submission the suite posts today sits at `32.0853, 34.7818`, so
"פלאפל בדיקה" and "בורגר בדיקה" are 0 m apart and the new merge would decide
whether they are one place on trigram similarity alone. The fixtures need
distinct coordinates, plus a deliberate pair that *should* merge and a
deliberate pair that should not.

`scripts/check_migration.py` covers 0005 as it covers the others.

Short-link expansion is not unit-testable without the network. It gets one
live check against a real share link during implementation.

## Out of scope

Editing a pin by dragging. Correcting a location by hand is what the current
design refuses on purpose, and this feature does not change that argument.
