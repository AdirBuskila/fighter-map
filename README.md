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

### 2. Google Cloud, two keys

Create one project, enable **Places API (New)** and **Maps JavaScript API**,
then create two separate keys. One key restricted two ways is a key restricted
neither way.

| Key | Restriction | APIs | Goes in |
|---|---|---|---|
| Server | IP address, your machine and any CI runner | Places API (New) | `GOOGLE_MAPS_SERVER_KEY` |
| Browser | HTTP referrer: `localhost:3000/*` and your Vercel domain | Maps JavaScript API, Places API (New) | `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` |

Then Google Maps Platform → Map Management → create a **Map ID** with the
JavaScript / vector renderer, and put it in
`NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`. Advanced markers do not render without one;
the app falls back to `DEMO_MAP_ID`, which is watermarked.

Set a **budget alert** before you run the geocoder. It makes exactly 610 Text
Search calls on the first pass and zero on every rerun, because every response
is cached to `data/geocode_cache.json`. The field mask asks for `location` and
`displayName`, which puts it on the Pro tier: 610 × $32/1000 ≈ **$19.50**,
inside Google's $200 monthly credit. 499 of the 610 queries carry a city, the
rest are a name biased to Israel.

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

# Phase 3 - resolve to Google place ids
export GOOGLE_MAPS_SERVER_KEY=...
./.venv/Scripts/python.exe scripts/03_geocode.py --verbose

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

`scripts/check_palette.py` is the accessibility test for the two benefit
colours. Run it after touching any colour token; it fails the build's intent
if the two stop being distinguishable.

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
  |  03_geocode.py     Places API Text Search, place_id becomes the key
  v
data/places.json
  |  05_seed_supabase.py
  v
Supabase -> the app
```

Nothing under `data/` is committed, and neither is `fighter.pdf`. Both carry
private individuals' mobile numbers verbatim.

## Trust rules

| Rule | Where it lives |
|---|---|
| A submission publishes at 2 independent confirmations | `apply_report()` trigger |
| 3 "not working" reports in 60 days greys a place out | `apply_report()` trigger |
| Nothing older than 6 months claims to be verified | `isStale()` in `src/lib/format.ts` |
| 5 reports per reporter per hour | `rateLimited()` in the route handlers |

A place is never un-flipped automatically. `/admin` lists the ones that were
flagged and then kept collecting confirmations, which is the signal a business
changed its policy back, and leaves the call to a person.

## Deploying

Vercel, project root as-is. Add every variable from `.env.example` to the
project's environment. Add the deployed domain to the browser key's referrer
restrictions and to the Turnstile site's hostname list.
