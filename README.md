# מפת הטבות פייטר · Fighter Map

An unofficial, community-run map of places where Israeli reservists have
successfully paid with the Fighter card (כרטיס פייטר) or redeemed a vacation
voucher (שובר חופשה). Not affiliated with the Ministry of Defense, Fighter, or
any card issuer.

Seed data comes from a crowd-reported spreadsheet exported to `fighter.pdf`.
Users of the live site add places themselves.

---

## What you need to do by hand

Everything below needs an account or a key, so none of it could be done for
you. Work down the list; each step says how to check it worked.

### 1. Supabase

1. Create a project at <https://supabase.com/dashboard>.
2. SQL Editor → paste `supabase/migrations/0001_init.sql` → Run.
   It enables PostGIS and pg_trgm, creates `places` and `reports`, the trust
   trigger, three RPCs and the RLS policies.
3. Settings → API. Copy into `.env.local`:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server only, never
     prefixed `NEXT_PUBLIC_`)

   Check: `select postgis_version();` returns a version, and
   `select count(*) from places;` returns 0.

### 2. Nothing. There is no map account to create.

The map is [OpenFreeMap](https://openfreemap.org/) vector tiles rendered by
MapLibre, and place search is [Photon](https://photon.komoot.io/), OSM's
typeahead geocoder. Neither takes an API key, a billing account or a card, so
there is nothing to sign up for and nothing that can run up a bill.

The basemap styles live in `public/map/light.json` and `dark.json`. They are
ours, not a vendor default: coastline, road network and town names only, so the
only colour on the map is our own dots. `design/README.md` explains each rule.

Seed geocoding does not call anything either. `03a_osm_extract.py` downloads a
119 MB Geofabrik extract once and builds a local index of every named business
in Israel; `03_locate.py` matches against it offline. Retries are free, which
is what let the matching thresholds be tuned against real output rather than
guessed.

### 3. Cloudflare Turnstile

<https://dash.cloudflare.com> → Turnstile → add a site. Site key goes in
`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, secret in `TURNSTILE_SECRET_KEY`. Leave both
empty and the check is skipped, which is fine locally and not fine in public.

### 4. Two secrets of your own

```
ADMIN_PASSWORD=          # gates /admin
IP_HASH_SALT=            # any long random string, set once and leave it
```

`IP_HASH_SALT` salts the pseudonym each reporter is counted by. Changing it
later resets every "independent confirmations" count.

---

## Running the pipeline

```bash
py -3.13 -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements.txt

# Phase 1 - PDF to structured rows (no keys needed)
./.venv/Scripts/python.exe scripts/01_extract.py

# Phase 2 - free text to canonical places (cached, no API call needed)
./.venv/Scripts/python.exe scripts/02_normalize.py --offline

# Phase 3a - build the local OSM business index (one 119 MB download)
./.venv/Scripts/python.exe scripts/03a_osm_extract.py

# Phase 3b - match places against it, entirely offline
./.venv/Scripts/python.exe scripts/03_locate.py --verbose

# Phase 3c - ask Nominatim and Photon about the leftovers (cached, ~9 min)
./.venv/Scripts/python.exe scripts/03b_locate_remote.py

# Load it
export NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
./.venv/Scripts/python.exe scripts/05_seed_supabase.py --dry-run
./.venv/Scripts/python.exe scripts/05_seed_supabase.py
```

Every script is idempotent and resumable. Rerun any of them freely: Phase 2
reads `data/llm_cache.json`, Phase 3 reads `data/geocode_cache.json`, and the
loader upserts on `places.source_key` rather than inserting.

`scripts/02_normalize.py` normally calls Claude, batching 25 cells per request.
The full corpus is already cached, so `--offline` reproduces it without a key.
Drop `--offline` and set `ANTHROPIC_API_KEY` to re-normalise after a prompt
change; only the cells whose text actually changed get re-asked.

`scripts/seed_cache.py` writes hand-corrected results into that same cache, so
a fix you make survives every future rerun.

---

## Tests

```bash
npm run check                                          # types and lint
npm run smoke                                          # real browser, 16 checks
./.venv/Scripts/python.exe scripts/check_palette.py    # colour blindness, contrast
./.venv/Scripts/python.exe scripts/check_migration.py  # SQL grammar, column contracts
./.venv/Scripts/python.exe scripts/test_db.py          # trust rules, needs Docker
```

`check_migration.py` parses the migration with libpg_query, the real Postgres
parser, then checks what a parser cannot: a function's RETURNS TABLE list and
its SELECT list are matched by position, so a mismatch parses cleanly and
returns the wrong data.

`test_db.py` starts a throwaway PostGIS container, applies the migration and
runs `supabase/tests/trust_rules.sql`: 30 assertions over both flows, the
constraints and the RPCs. It is not a vacuous suite; the bugs it was written
for were re-introduced deliberately and it caught each one.

For the layer above the database, run the whole stack:

```bash
npx supabase start        # Postgres, PostgREST, the lot, on 54321
npm run dev
./.venv/Scripts/python.exe scripts/test_api.py    # 24 assertions
npx supabase stop         # when you are done
```

`npm run smoke` drives a real browser. It exists because the two worst bugs
this project has had were both invisible to every other suite: a map pane that
grew to 60,719px so exactly one tile loaded, and a MapLibre version whose
worker Next could not bundle, which requested no tiles and raised no error.
Both render a blank map with a clean console. Pass `mobile` as a third argument
to check a phone, which is how a pane that was zero pixels wide turned up.

`test_api.py` drives the real route handlers, acting as several different
reporters via `X-Forwarded-For`, which is what the rate limiter hashes. It
covers what SQL cannot: Zod at the edge, the rate limit, the
duplicate-submission branch, and whether PostgREST accepts the EWKT literal
the submission route sends for a geography column.

---

## Running the app

```bash
npm install
cp .env.example .env.local     # then fill it in
npm run dev
```

Before Supabase exists, `npm run dev` reads `data/places.json` off disk so the
UI is inspectable. Production never does this.

---

## How the data flows

```
fighter.pdf
  |  01_extract.py     drawn text runs, RTL repaired, columns split by rule
  v
data/raw_rows.json                     759 rows
  |  02_normalize.py   Claude splits multi-place cells, classifies, dedups
  v
data/normalized.json                   857 places
data/needs_review.json                 low confidence, for /admin
  |  03a_osm_extract.py    30,270 named businesses in Israel, from OSM
  |  03_locate.py          matched locally, the OSM ref becomes the key
  |  03b_locate_remote.py  Nominatim then Photon for the leftovers
  v
data/places.json                       209 located, 396 to review
  |  05_seed_supabase.py
  v
Supabase -> the app
```

Nothing under `data/` is committed, and neither is `fighter.pdf`. Both carry
private individuals' mobile numbers verbatim, and the OSM extract is 119 MB.

## Trust rules

| Rule | Where it lives |
|---|---|
| A submission publishes at 2 independent vouches, the submitter counting as the first | `apply_report()` trigger |
| 3 "not working" reports from 3 **distinct** reporters in 60 days greys a place out | `apply_report()` trigger |
| A moderator's restore retires the old reports so they cannot re-flip it | `superseded_at` on `reports` |
| Confirmed here, then quiet for 6 months, badges "לא מאומת לאחרונה" | `isStale()` in `src/lib/format.ts` |
| Confirmed in the last 30 days badges "אומת החודש" | `isFresh()` in `src/lib/format.ts` |
| Never confirmed here states its age in plain text, no badge | `isUnverified()` + `LastSignalLine` |
| 5 reports per reporter per hour | `rateLimited()` in the route handlers |

Coverage is the honest weak spot of going key-free. OSM knows 209 of the 610
imported single locations; Google would have found most of the rest. The other
396 are not lost: `/admin` lets a moderator search and pin one in a few
seconds, and a pinned place merges correctly with any later user submission for
the same shop because identity still comes from the provider.

A place is never un-flipped automatically. `/admin` lists the ones that were
flagged and then kept collecting confirmations, which is the signal a business
changed its policy back, and leaves the call to a person.

## Deploying

Vercel, project root as-is. Add every variable from `.env.example` to the
project's environment. Add the deployed domain to the browser key's referrer
restrictions and to the Turnstile site's hostname list.
