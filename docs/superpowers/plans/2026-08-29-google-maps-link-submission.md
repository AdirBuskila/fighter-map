# Google Maps Link Submission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let somebody add a place to the map by pasting its Google Maps link, when the OpenStreetMap search cannot find it.

**Architecture:** A pure regex parser turns a Google Maps URL into a point, an optional Google place id and a suggested name. Phone share links (`maps.app.goo.gl`) carry no coordinates, so a narrow server route expands them first against a host allowlist. Because Google is now a second issuer of place identity, the submission route gains a proximity-and-name merge so a link for a shop already on the map under an OSM ref becomes a confirmation rather than a duplicate pin.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Zod 4, Supabase (PostGIS + pg_trgm), MapLibre GL, Tailwind 4. Tests are plain Node scripts and Python scripts — the project has no test framework and this plan does not add one.

**Spec:** `docs/superpowers/specs/2026-08-29-google-maps-link-submission-design.md`

## Global Constraints

- All user-facing copy is Hebrew. Error messages say what happened and what to do, never a code.
- Israel bounding box, used verbatim everywhere: `29.4 ≤ lat ≤ 33.4`, `34.2 ≤ lng ≤ 35.9`. This is the box `scripts/06_add_partner.py` already guards with.
- Proximity merge radius: **75 m**. Trigram similarity threshold: **0.45**. Both must hold.
- `npm run check` (`tsc --noEmit && eslint src --max-warnings=0`) must pass at the end of every task that touches `src/`.
- Never add a runtime dependency. Everything here uses what `package.json` already has.
- Comments in this codebase explain *why*, not *what*, and name the failure the code prevents. Match that. Do not add narration comments.
- `.env.local` points at **production**. Never run a write test without pointing at a local Supabase first.

---

### Task 1: The URL parser

**Files:**
- Create: `src/lib/gmaps.ts`
- Create: `tools/gmaps_cases.mjs`
- Modify: `package.json` (add the `gmaps` script)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type GoogleMapsPin = { lat: number; lng: number; providerRef: string | null; name: string | null }`
  - `type GoogleMapsParse = { kind: "pin"; pin: GoogleMapsPin } | { kind: "needs_expanding"; url: string } | { kind: "no_position"; providerRef: string } | { kind: "outside_israel"; lat: number; lng: number } | { kind: "not_a_map_link" }`
  - `function parseGoogleMapsUrl(input: string): GoogleMapsParse`
  - `function isGoogleShortLink(input: string): boolean`
  - `const ISRAEL_BOUNDS = { latLo: 29.4, latHi: 33.4, lngLo: 34.2, lngHi: 35.9 }`

- [ ] **Step 1: Write the failing test**

Create `tools/gmaps_cases.mjs`. It is the test for this task — a table of real URL shapes against expected output, run under Node 22's type stripping so the TypeScript module is imported directly.

```js
// Every shape of Google Maps URL a contributor has actually pasted, against
// what the parser must make of it.
//
// Run with:  npm run gmaps
//
// Node 22 strips the types at load, so this imports src/lib/gmaps.ts directly
// rather than duplicating the regexes into a fixture, which is the way a table
// like this normally rots.
import { parseGoogleMapsUrl, isGoogleShortLink } from "../src/lib/gmaps.ts";

const DESKTOP =
  "https://www.google.com/maps/place/%D7%A2%D7%9E%D7%A0%D7%95%D7%90%D7%9C+%D7%A9%D7%9C%D7%9D/" +
  "@31.8005,35.3105,17z/data=!3m1!4b1!4m6!3m5!" +
  "1s0x1502b5c0e1f2a3b4:0x5d6e7f8091a2b3c4!8m2!3d31.8006!4d35.3107!16s%2Fg%2F11abc123";

const CASES = [
  {
    name: "desktop copy-link prefers the marker over the viewport",
    input: DESKTOP,
    expect: {
      kind: "pin",
      lat: 31.8006,
      lng: 35.3107,
      providerRef: "gmaps:ftid/0x1502b5c0e1f2a3b4:0x5d6e7f8091a2b3c4",
      name: "עמנואל שלם",
    },
  },
  {
    name: "a link wrapped in a sentence is still found",
    input: "היי, זה המקום שלנו https://www.google.com/maps/place/x/@31.8005,35.3105,17z תודה!",
    expect: { kind: "pin", lat: 31.8005, lng: 35.3105, providerRef: null, name: "x" },
  },
  {
    name: "phone share link needs expanding",
    input: "https://maps.app.goo.gl/AbCdEf12345",
    expect: { kind: "needs_expanding", url: "https://maps.app.goo.gl/AbCdEf12345" },
  },
  {
    name: "old short link needs expanding too",
    input: "https://goo.gl/maps/AbCdEf",
    expect: { kind: "needs_expanding", url: "https://goo.gl/maps/AbCdEf" },
  },
  {
    name: "api=1 search link, comma-encoded",
    input: "https://www.google.com/maps/search/?api=1&query=31.8005%2C35.3105",
    expect: { kind: "pin", lat: 31.8005, lng: 35.3105, providerRef: null, name: null },
  },
  {
    name: "api=1 with a place id keeps the id",
    input: "https://www.google.com/maps/search/?api=1&query=31.8005,35.3105&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4",
    expect: {
      kind: "pin",
      lat: 31.8005,
      lng: 35.3105,
      providerRef: "gmaps:place/ChIJN1t_tDeuEmsRUsoyG83frY4",
      name: null,
    },
  },
  {
    name: "cid link with no position is not a pin",
    input: "https://maps.google.com/?cid=6732789012345678901",
    expect: { kind: "no_position", providerRef: "gmaps:cid/6732789012345678901" },
  },
  {
    name: "bare q= coordinates",
    input: "https://maps.google.com/?q=31.8005,35.3105",
    expect: { kind: "pin", lat: 31.8005, lng: 35.3105, providerRef: null, name: null },
  },
  {
    name: "the Israeli domain works",
    input: "https://www.google.co.il/maps/place/%D7%92%D7%95%D7%A4%D7%A0%D7%90/@32.0550,35.2900,17z",
    expect: { kind: "pin", lat: 32.055, lng: 35.29, providerRef: null, name: "גופנא" },
  },
  {
    name: "a dropped pin has DMS in the name slot, which is not a name",
    input: "https://www.google.com/maps/place/31%C2%B048'01.8%22N+35%C2%B018'37.9%22E/@31.8005,35.3105,17z/data=!3m1!1e3",
    expect: { kind: "pin", lat: 31.8005, lng: 35.3105, providerRef: null, name: null },
  },
  {
    name: "a plus code is not a name either",
    input: "https://www.google.com/maps/place/8G3Q%2B7X+Shilo/@32.0550,35.2900,17z",
    expect: { kind: "pin", lat: 32.055, lng: 35.29, providerRef: null, name: null },
  },
  {
    name: "expanded share link with the id but no position",
    input: "https://www.google.com/maps/place//data=!4m2!3m1!1s0x1502b5c0e1f2a3b4:0x5d6e7f8091a2b3c4?utm_source=mstt_1",
    expect: { kind: "no_position", providerRef: "gmaps:ftid/0x1502b5c0e1f2a3b4:0x5d6e7f8091a2b3c4" },
  },
  {
    name: "Berlin is a mistake, not a contribution",
    input: "https://www.google.com/maps/place/Brandenburger+Tor/@52.5163,13.3777,17z",
    expect: { kind: "outside_israel", lat: 52.5163, lng: 13.3777 },
  },
  {
    name: "somebody else's map is refused",
    input: "https://www.waze.com/live-map/directions?to=ll.31.8005%2C35.3105",
    expect: { kind: "not_a_map_link" },
  },
  {
    name: "plain text is refused",
    input: "אופירה 6, מישור אדומים",
    expect: { kind: "not_a_map_link" },
  },
  {
    name: "an open redirect dressed as Google is refused",
    input: "https://google.com.evil.example/maps/place/x/@31.8,35.3,17z",
    expect: { kind: "not_a_map_link" },
  },
];

let failed = 0;

function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) {
    failed += 1;
    console.log(`  FAIL  ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  return ok;
}

for (const testCase of CASES) {
  const got = parseGoogleMapsUrl(testCase.input);
  const want = testCase.expect;
  const before = failed;

  check(`${testCase.name} / kind`, got.kind, want.kind);
  if (got.kind === "pin" && want.kind === "pin") {
    check(`${testCase.name} / lat`, got.pin.lat, want.lat);
    check(`${testCase.name} / lng`, got.pin.lng, want.lng);
    check(`${testCase.name} / ref`, got.pin.providerRef, want.providerRef);
    check(`${testCase.name} / name`, got.pin.name, want.name);
  } else if (got.kind === "needs_expanding" && want.kind === "needs_expanding") {
    check(`${testCase.name} / url`, got.url, want.url);
  } else if (got.kind === "no_position" && want.kind === "no_position") {
    check(`${testCase.name} / ref`, got.providerRef, want.providerRef);
  } else if (got.kind === "outside_israel" && want.kind === "outside_israel") {
    check(`${testCase.name} / lat`, got.lat, want.lat);
    check(`${testCase.name} / lng`, got.lng, want.lng);
  }

  if (failed === before) console.log(`  ok    ${testCase.name}`);
}

// isGoogleShortLink gates the only outbound fetch in this feature, so it is
// checked on its own rather than inferred from the table above.
const SHORT = [
  ["https://maps.app.goo.gl/x", true],
  ["https://goo.gl/maps/x", true],
  ["https://www.google.com/maps/place/x/@31.8,35.3,17z", false],
  ["https://goo.gl.evil.example/x", false],
  ["not a url", false],
];
for (const [input, want] of SHORT) {
  if (check(`isGoogleShortLink(${input})`, isGoogleShortLink(input), want)) {
    console.log(`  ok    isGoogleShortLink(${input}) === ${want}`);
  }
}

console.log(failed === 0 ? `\nall ${CASES.length + SHORT.length} cases passed` : `\n${failed} failures`);
process.exit(failed === 0 ? 0 : 1);
```

Add the script to `package.json`, inside `"scripts"`, after `"smoke"`:

```json
    "gmaps": "node --experimental-strip-types tools/gmaps_cases.mjs"
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run gmaps`
Expected: FAIL — `Cannot find module '.../src/lib/gmaps.ts'`.

- [ ] **Step 3: Write the parser**

Create `src/lib/gmaps.ts`:

```ts
/**
 * A Google Maps link, turned into a point.
 *
 * This exists because the OSM typeahead cannot find most small Israeli
 * businesses, which is the whole reason people write in asking for a place to
 * be added rather than adding it. Every one of those businesses is on Google.
 *
 * Pure and network-free on purpose: the same function runs in the browser for
 * instant feedback and on the server for the authoritative answer, and it is
 * testable without a fixture server. The one thing it cannot do is expand a
 * phone share link, which carries no coordinates at all; that is
 * /api/resolve-link, and `needs_expanding` is how this says so.
 */

export const ISRAEL_BOUNDS = { latLo: 29.4, latHi: 33.4, lngLo: 34.2, lngHi: 35.9 };

export type GoogleMapsPin = {
  lat: number;
  lng: number;
  /** Google's own id for the place, when the link carries one. */
  providerRef: string | null;
  /** A suggestion only. The contributor confirms or replaces it. */
  name: string | null;
};

export type GoogleMapsParse =
  | { kind: "pin"; pin: GoogleMapsPin }
  | { kind: "needs_expanding"; url: string }
  | { kind: "no_position"; providerRef: string }
  | { kind: "outside_israel"; lat: number; lng: number }
  | { kind: "not_a_map_link" };

const SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl", "g.co"]);

/** google.com, google.co.il, maps.google.com, maps.google.co.il. */
const MAPS_HOST = /^(?:maps\.)?google\.[a-z]{2,3}(?:\.[a-z]{2,3})?$/;

const NUM = String.raw`-?\d{1,3}(?:\.\d+)?`;
// The marker Google itself resolved. Authoritative, and the reason !3d!4d
// outranks the /@ pair: a sharer who panned before copying moves /@ and
// leaves this alone.
const MARKER = new RegExp(`!8m2!3d(${NUM})!4d(${NUM})`);
const ANY_MARKER = new RegExp(`!3d(${NUM})!4d(${NUM})`);
const VIEWPORT = new RegExp(`/@(${NUM}),(${NUM})[,/]`);
const SEARCH_PATH = new RegExp(`/maps/search/(${NUM}),(${NUM})`);
const PAIR = new RegExp(`^\\s*(${NUM}),\\s*(${NUM})\\s*$`);

const FTID = /!1s(0x[0-9a-f]+):(0x[0-9a-f]+)/i;
const PLACE_SEGMENT = /\/maps\/place\/([^/@?]+)/;

const COORD_TEXT = /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/;
const DMS_TEXT = /\d+°\d+'[\d.]+"[NSEW]/;
const PLUS_CODE = /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}\b/i;

const URL_IN_TEXT = /https?:\/\/[^\s<>"'\])]+/gi;

function hostKind(host: string): "short" | "maps" | null {
  const bare = host.toLowerCase().replace(/^www\./, "");
  if (SHORT_HOSTS.has(bare)) return "short";
  if (MAPS_HOST.test(bare)) return "maps";
  return null;
}

/** The first Google URL in whatever was pasted, because people paste a link
 *  with a sentence wrapped around it. */
function firstGoogleUrl(input: string): URL | null {
  for (const candidate of input.match(URL_IN_TEXT) ?? []) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    if (hostKind(url.host)) return url;
  }
  return null;
}

export function isGoogleShortLink(input: string): boolean {
  const url = firstGoogleUrl(input);
  return url !== null && hostKind(url.host) === "short";
}

function fromParams(url: URL): [number, number] | null {
  for (const key of ["q", "query", "ll", "center", "daddr", "sll"]) {
    const raw = url.searchParams.get(key);
    const match = raw?.match(PAIR);
    if (match) return [Number(match[1]), Number(match[2])];
  }
  return null;
}

function position(url: URL): [number, number] | null {
  const whole = url.href;
  for (const pattern of [MARKER, ANY_MARKER, VIEWPORT, SEARCH_PATH]) {
    const match = whole.match(pattern);
    if (match) return [Number(match[1]), Number(match[2])];
  }
  return fromParams(url);
}

function identity(url: URL): string | null {
  const ftid = url.href.match(FTID);
  if (ftid) return `gmaps:ftid/${ftid[1].toLowerCase()}:${ftid[2].toLowerCase()}`;

  const cid = url.searchParams.get("cid");
  if (cid && /^\d{1,20}$/.test(cid)) return `gmaps:cid/${cid}`;

  const placeId =
    url.searchParams.get("query_place_id") ?? url.searchParams.get("place_id");
  if (placeId && /^[\w-]{10,128}$/.test(placeId)) return `gmaps:place/${placeId}`;

  return null;
}

function suggestedName(url: URL): string | null {
  const segment = url.pathname.match(PLACE_SEGMENT)?.[1];
  if (!segment) return null;

  let text: string;
  try {
    text = decodeURIComponent(segment.replace(/\+/g, " ")).trim();
  } catch {
    return null;
  }
  // A dropped pin puts the position in the name slot. Offering "31°48'01.8"N"
  // as the shop's name is worse than offering nothing.
  if (!text || COORD_TEXT.test(text) || DMS_TEXT.test(text) || PLUS_CODE.test(text)) {
    return null;
  }
  return text.slice(0, 160);
}

export function inIsrael(lat: number, lng: number): boolean {
  return (
    lat >= ISRAEL_BOUNDS.latLo &&
    lat <= ISRAEL_BOUNDS.latHi &&
    lng >= ISRAEL_BOUNDS.lngLo &&
    lng <= ISRAEL_BOUNDS.lngHi
  );
}

export function parseGoogleMapsUrl(input: string): GoogleMapsParse {
  const url = firstGoogleUrl(input);
  if (!url) return { kind: "not_a_map_link" };

  if (hostKind(url.host) === "short") {
    return { kind: "needs_expanding", url: url.href };
  }

  const providerRef = identity(url);
  const point = position(url);

  if (!point) {
    // Some share links expand to identity with no position. Nothing short of
    // the paid Google API turns that ref into a point, so say which of the two
    // is missing and let the caller give a usable instruction.
    return providerRef
      ? { kind: "no_position", providerRef }
      : { kind: "not_a_map_link" };
  }

  const [lat, lng] = point;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { kind: "not_a_map_link" };
  if (!inIsrael(lat, lng)) return { kind: "outside_israel", lat, lng };

  return { kind: "pin", pin: { lat, lng, providerRef, name: suggestedName(url) } };
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm run gmaps`
Expected: PASS — `all 21 cases passed`.

Then run: `npm run check`
Expected: PASS. If eslint objects to `tools/` it will not — `check` lints `src` only.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gmaps.ts tools/gmaps_cases.mjs package.json
git commit -m "Read a point out of a Google Maps link"
```

---

### Task 2: The short-link expander

**Files:**
- Create: `src/app/api/resolve-link/route.ts`
- Modify: `scripts/test_api.py` (add a `resolve-link` section)

**Interfaces:**
- Consumes: `parseGoogleMapsUrl`, `isGoogleShortLink`, `GoogleMapsPin` from `@/lib/gmaps`; `jsonError` from `@/lib/server/security`.
- Produces: `GET /api/resolve-link?url=<pasted text>` returning either
  `{ lat: number, lng: number, providerRef: string | null, name: string | null, city: string | null, address: string | null }`
  or `{ error: string }` with a 4xx status.

- [ ] **Step 1: Write the failing test**

Add to `scripts/test_api.py`, as a new section function. Place it after the existing submission sections and call it from `main()` alongside the others (match the surrounding call style).

```python
def resolve_link_cases(check) -> None:
    print("\nresolve-link")

    status, body = get("/api/resolve-link?url=" + quote(
        "https://www.google.com/maps/place/x/@31.8005,35.3105,17z/data="
        "!4m6!3m5!1s0x1502b5c0e1f2a3b4:0x5d6e7f8091a2b3c4!8m2!3d31.8006!4d35.3107"))
    check("a long link resolves without any outbound fetch", status, 200)
    check("  the marker wins over the viewport", body.get("lat"), 31.8006)
    check("  the google id comes through",
          body.get("providerRef"), "gmaps:ftid/0x1502b5c0e1f2a3b4:0x5d6e7f8091a2b3c4")

    status, _ = get("/api/resolve-link?url=" + quote(
        "https://www.google.com/maps/place/Brandenburger+Tor/@52.5163,13.3777,17z"))
    check("a link outside Israel is refused", status, 400)

    # The route performs an outbound fetch, so the host allowlist is the thing
    # standing between it and being a request-forgery hole. Both of these must
    # be refused without any request leaving the server.
    status, _ = get("/api/resolve-link?url=" + quote("http://169.254.169.254/latest/meta-data/"))
    check("a link to the metadata service is refused", status, 400)

    status, _ = get("/api/resolve-link?url=" + quote("https://goo.gl.evil.example/x"))
    check("a lookalike short-link host is refused", status, 400)

    status, _ = get("/api/resolve-link?url=" + quote("אופירה 6, מישור אדומים"))
    check("plain text is refused", status, 400)
```

If `scripts/test_api.py` has no `get()` helper next to its `post()` helper, add one directly above `post()`, and add `from urllib.parse import quote` to the imports:

```python
def get(path: str) -> tuple[int, dict]:
    response = requests.get(BASE + path, timeout=30)
    try:
        return response.status_code, response.json()
    except json.JSONDecodeError:
        return response.status_code, {"raw": response.text[:200]}
```

- [ ] **Step 2: Run it to make sure it fails**

Start the stack first, pointed at a **local** Supabase, never production:

```bash
npx supabase start
npm run dev
```

Run: `./.venv/Scripts/python.exe scripts/test_api.py`
Expected: the five new checks FAIL with status 404 — the route does not exist.

- [ ] **Step 3: Write the route**

Create `src/app/api/resolve-link/route.ts`:

```ts
import { jsonError } from "@/lib/server/security";
import {
  isGoogleShortLink,
  parseGoogleMapsUrl,
  type GoogleMapsPin,
} from "@/lib/gmaps";

/**
 * A Google Maps link, resolved to a point.
 *
 * This route exists for one reason: the Share button on a phone produces
 * https://maps.app.goo.gl/xxxx, which contains no coordinates at all, and a
 * browser cannot follow that redirect cross-origin. That is the form most of
 * these links arrive in, so "just regex the URL" does not cover the common
 * case. A long URL never reaches here; the client parses it itself.
 *
 * It is the only outbound fetch a stranger can trigger in this app, so the
 * shape is deliberately narrow. Only the three short-link hosts are ever
 * requested, every redirect hop is re-checked before it is followed, and the
 * whole thing is capped at three hops and six seconds. Point it at anything
 * else and it parses the string without opening a socket, which is what keeps
 * it from being a request-forgery hole.
 *
 * No rate limit of its own. It writes nothing, it cannot be aimed anywhere but
 * Google, and repeats are absorbed by the edge cache. Charging a resolve
 * against the five-per-hour submission budget would spend a contributor's
 * quota on getting the form to work.
 */

const MAX_HOPS = 3;
const PHOTON_REVERSE = "https://photon.komoot.io/reverse";
const UA = "fighter-map/1.0 (community benefit map for Israeli reservists)";

async function expand(shortUrl: string): Promise<string | null> {
  let current = shortUrl;
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    let response: Response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(6000),
        // Short links are immutable, so one resolve serves everybody who
        // pastes the same link.
        next: { revalidate: 86400 },
      });
    } catch {
      return null;
    }

    const location = response.headers.get("location");
    if (!location) return null;

    const next = new URL(location, current).href;
    // Re-check every hop. A redirect chain that starts at Google is not a
    // promise that it stays there.
    if (parseGoogleMapsUrl(next).kind === "not_a_map_link" && !isGoogleShortLink(next)) {
      return null;
    }
    if (!isGoogleShortLink(next)) return next;
    current = next;
  }
  return null;
}

/** City and street, so a link submission is not a poorer row than a searched
 *  one. Photon is already this project's geocoder. Failure is not fatal. */
async function reverse(
  lat: number,
  lng: number,
): Promise<{ city: string | null; address: string | null }> {
  const url = new URL(PHOTON_REVERSE);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("limit", "1");
  url.searchParams.set("lang", "default");

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 86400 },
    });
    if (!response.ok) return { city: null, address: null };
    const body = (await response.json()) as {
      features?: { properties?: Record<string, unknown> }[];
    };
    const props = body.features?.[0]?.properties ?? {};
    const text = (key: string) =>
      typeof props[key] === "string" ? (props[key] as string) : null;

    const city = text("city") ?? text("district") ?? text("county");
    const street = [text("street"), text("housenumber")].filter(Boolean).join(" ");
    return {
      city,
      address: [street || null, city].filter(Boolean).join(", ") || null,
    };
  } catch {
    return { city: null, address: null };
  }
}

function pinResponse(pin: GoogleMapsPin, city: string | null, address: string | null) {
  return Response.json({
    lat: pin.lat,
    lng: pin.lng,
    providerRef: pin.providerRef,
    name: pin.name,
    city,
    address,
  });
}

export async function GET(request: Request) {
  const raw = (new URL(request.url).searchParams.get("url") ?? "").trim();
  if (!raw) return jsonError("הדביקו קישור מגוגל מפות", 400);

  let parsed = parseGoogleMapsUrl(raw);

  if (parsed.kind === "needs_expanding") {
    const expanded = await expand(parsed.url);
    if (!expanded) {
      return jsonError(
        "לא הצלחנו לפתוח את הקישור. פתחו אותו בדפדפן והעתיקו את הכתובת משורת הכתובת",
        502,
      );
    }
    parsed = parseGoogleMapsUrl(expanded);
    // An expanded link that still wants expanding is a loop, not a location.
    if (parsed.kind === "needs_expanding") {
      return jsonError("לא הצלחנו לפתוח את הקישור. נסו שוב בעוד רגע", 502);
    }
  }

  if (parsed.kind === "not_a_map_link") {
    return jsonError("זה לא נראה כמו קישור מגוגל מפות. העתיקו את הקישור מכפתור השיתוף", 400);
  }
  if (parsed.kind === "outside_israel") {
    return jsonError("הקישור מצביע על מקום מחוץ לישראל. המפה מכסה רק מקומות בארץ", 400);
  }
  if (parsed.kind === "no_position") {
    return jsonError(
      "הקישור מזהה את העסק אבל בלי מיקום. פתחו אותו בגוגל מפות והעתיקו את הכתובת משורת הכתובת",
      400,
    );
  }

  const { city, address } = await reverse(parsed.pin.lat, parsed.pin.lng);
  return pinResponse(parsed.pin, city, address);
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `./.venv/Scripts/python.exe scripts/test_api.py`
Expected: all five new checks PASS, and every pre-existing check still passes.

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Verify a real short link end to end**

This is the one thing the table in Task 1 cannot cover, and it is the common
case, so it does not get skipped. Ask for a real `maps.app.goo.gl` link, then:

```bash
curl -s "http://localhost:3000/api/resolve-link?url=<the real link, URL-encoded>"
```

Expected: a JSON body with `lat` and `lng` inside Israel. If it returns the
"identify the business but no position" error instead, that tells us Google's
current share format omits the marker, and the message already says what to do.
Record which shape came back in the commit message.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/resolve-link/route.ts scripts/test_api.py
git commit -m "Expand a phone share link into a point"
```

---

### Task 3: The near-duplicate lookup

**Files:**
- Create: `supabase/migrations/0005_link_submissions.sql`
- Modify: `supabase/tests/trust_rules.sql` (append section K)

**Interfaces:**
- Consumes: `places` table, PostGIS and pg_trgm from `0001_init.sql`.
- Produces: RPC `place_near_match(p_lat double precision, p_lng double precision, p_name text, p_radius_m integer default 75)` returning at most one row of `(id uuid, name_he text, name_similarity real, distance_m double precision)`.

- [ ] **Step 1: Write the failing test**

Append to `supabase/tests/trust_rules.sql`, before the final `raise notice` block:

```sql
-- K. the near match that stands in for a shared identity
--
-- A Google link and an OSM pick for the same shop do not join on their refs,
-- because they come from different issuers. Proximity plus name is what joins
-- them instead, and it has to be both: two shops in one mall are metres apart
-- and must stay two rows, while the same shop pinned twice is metres apart and
-- must become one.
insert into places (
  id, source_key, name_he, category, location, city,
  benefit_fighter_card, source, status, first_reported_at
) values (
  '77777777-7777-7777-7777-777777777777', 'k8', 'גולף מעלה אדומים', 'clothing',
  'SRID=4326;POINT(35.2980 31.7770)', 'מעלה אדומים',
  true, 'user_submission', 'published', now()
), (
  '88888888-8888-8888-8888-888888888888', 'k9', 'זיפ מעלה אדומים', 'clothing',
  -- Roughly 30 m from the row above: the next unit along in the same mall.
  'SRID=4326;POINT(35.2983 31.7771)', 'מעלה אדומים',
  true, 'user_submission', 'published', now()
);

select assert_eq(
  (select id from place_near_match(31.7770, 35.2981, 'גולף מעלה אדומים')),
  '77777777-7777-7777-7777-777777777777'::uuid,
  'the same shop pinned a few metres off matches itself');

select assert_eq(
  (select count(*)::int from place_near_match(31.7771, 35.2983, 'אושיקה')),
  0,
  'a different shop in the same mall does not match');

select assert_eq(
  (select count(*)::int from place_near_match(31.7900, 35.2980, 'גולף מעלה אדומים')),
  0,
  'the same name a kilometre away does not match');

-- A rejected row must not quietly absorb a new submission and come back.
update places set status = 'rejected'
 where id = '88888888-8888-8888-8888-888888888888';
select assert_eq(
  (select count(*)::int from place_near_match(31.7771, 35.2983, 'זיפ מעלה אדומים')),
  0,
  'a rejected place is not a merge candidate');
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `./.venv/Scripts/python.exe scripts/test_db.py` (needs Docker running)
Expected: FAIL — `function place_near_match(...) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0005_link_submissions.sql`:

```sql
-- A place can now arrive as a Google Maps link, so identity has a second
-- issuer and the refs no longer join.
--
-- 0002 moved identity onto OpenStreetMap and rested one rule on it: two people
-- reporting the same shop land on the same row. That rule is what makes "is it
-- worth walking in" have a single answer. It holds as long as there is one
-- issuer of identity, and /add accepting a Google link means there is not:
-- osm:node/123 and gmaps:ftid/0x..:0x.. for the same shop are two strings that
-- will never be equal.
--
-- This is what replaces the join. Near in space AND near in name, because
-- either alone is wrong in a way that shows up immediately: two shops in one
-- shopping centre are thirty metres apart and must stay two rows, and a chain
-- has the same name in forty towns.
--
-- Read this together with 0004. A merged submission becomes a confirm on the
-- existing row, so a place that was standing on one person's word gains its
-- second voucher and stops being one report away from removal. That is the
-- correct outcome and it is why the radius is tight: 75 m is a building, not a
-- street.

create or replace function place_near_match(
  p_lat      double precision,
  p_lng      double precision,
  p_name     text,
  p_radius_m integer default 75
)
returns table (
  id              uuid,
  name_he         text,
  name_similarity real,
  distance_m      double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select p.id,
         p.name_he,
         similarity(p.name_he, p_name),
         st_distance(p.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography)
    from places p
   -- 'pending' and 'rejected' are excluded deliberately. Merging into a
   -- rejected row would resurrect something a moderator threw out, without
   -- anyone choosing to. 'reported_not_working' is included, because a fresh
   -- report on a flipped place is exactly the "they changed their policy back"
   -- signal /admin exists to show a person.
   where p.status in ('published', 'reported_not_working')
     and p.location is not null
     and st_dwithin(p.location,
                    st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
                    p_radius_m)
     and similarity(p.name_he, p_name) > 0.45
   order by similarity(p.name_he, p_name) desc,
            st_distance(p.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography) asc
   limit 1;
$$;

grant execute on function place_near_match to service_role;

comment on function place_near_match is
  'Best existing row within p_radius_m whose name is similar to p_name, or no
   rows. Stands in for a shared provider_ref now that a place can arrive from
   Google as well as from OpenStreetMap.';
```

**Note on the output column name.** It is `name_similarity`, not `similarity`.
A `RETURNS TABLE` column called `similarity` shadows the pg_trgm function of
that name inside the body, which parses cleanly and returns wrong data. That is
precisely the class of bug `scripts/check_migration.py` was written for, and it
is why the SELECT list here is positional and unaliased.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `./.venv/Scripts/python.exe scripts/check_migration.py`
Expected: PASS — it globs the migrations directory, so 0005 is parsed with no change needed.

Run: `./.venv/Scripts/python.exe scripts/test_db.py`
Expected: PASS, with the four new section-K assertions.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0005_link_submissions.sql supabase/tests/trust_rules.sql
git commit -m "Match a pasted pin to a place already on the map"
```

---

### Task 4: Merge on submission, and tighten the ref contract

**Files:**
- Modify: `src/lib/schemas.ts` (the `submissionInput.providerRef` field)
- Modify: `src/app/api/submissions/route.ts`
- Modify: `scripts/test_api.py` (fix the colliding fixtures, add merge cases)

**Interfaces:**
- Consumes: `place_near_match` from Task 3.
- Produces: `POST /api/submissions` accepts `providerRef: string | null` and returns `outcome: "confirmed_existing"` for a near match.

- [ ] **Step 1: Write the failing test**

First, the fixture fix, which is not optional. Every submission `test_api.py`
posts today sits at `32.0853, 34.7818`, so "בורגר בדיקה" and "פלאפל בדיקה" are
0 m apart and the new merge would decide whether they are one place on trigram
similarity alone. Change the `submission()` helper to take coordinates:

```python
def submission(provider_ref: str, name: str, **overrides) -> dict:
    body = {
        "providerRef": provider_ref,
        "nameHe": name,
        # Distinct by default. Every fixture used to sit on one point, which
        # was harmless until the near-duplicate merge started reading position.
        "lat": 32.0853,
        "lng": 34.7818,
        "addressHe": "דיזנגוף 1, תל אביב",
        "city": "תל אביב",
        "category": "restaurant",
        "benefitFighterCard": True,
        "benefitVacationVoucher": False,
    }
    body.update(overrides)
    return body
```

and give the "פלאפל בדיקה" submission at line ~172 its own point, far enough
that proximity cannot bind it to the burger fixture:

```python
    status, body = post("/api/submissions",
                        submission(solo_ref, "פלאפל בדיקה", lat=32.0951, lng=34.7749),
                        ip("nina"))
```

Then add the merge section:

```python
def merge_cases(check, run: str) -> None:
    print("\nnear-duplicate merge")

    # A shop added from the OSM search.
    osm_ref = "osm:node/7" + run[:8]
    status, first = post("/api/submissions",
                         submission(osm_ref, "מסעדת גופנא", lat=32.0550, lng=35.2900),
                         ip("dana"))
    check("the osm-sourced place is created", status, 200)
    check("  it publishes on arrival", first.get("outcome"), "published")
    place_id = first.get("placeId")

    # The same shop, pasted as a Google link by somebody else. Different
    # issuer, so the refs cannot join; 12 m and the same name must.
    status, second = post("/api/submissions",
                          submission("gmaps:cid/60000" + run[:6], "מסעדת גופנא",
                                     lat=32.05511, lng=35.29003),
                          ip("erez"))
    check("a google link for the same shop merges", status, 200)
    check("  it confirms rather than duplicating", second.get("outcome"), "confirmed_existing")
    check("  and lands on the same row", second.get("placeId"), place_id)

    # A different shop, metres away. Same mall, different unit.
    status, third = post("/api/submissions",
                         submission("gmaps:cid/60001" + run[:6], "אושיקה",
                                    lat=32.05512, lng=35.29005),
                         ip("gil"))
    check("a different shop metres away is its own row", status, 200)
    check("  it publishes rather than merging", third.get("outcome"), "published")
    check("  on a new id", third.get("placeId") != place_id, True)

    # A link submission with no google id at all is allowed; the merge is the
    # only dedupe it gets.
    status, fourth = post("/api/submissions",
                          submission(None, "צימר מנוחה בשמחה",
                                     lat=32.0560, lng=35.2930,
                                     category="zimmer",
                                     benefitFighterCard=False,
                                     benefitVacationVoucher=True),
                          ip("hila"))
    check("a dropped pin with no google id is accepted", status, 200)

    # But a made-up ref is not. With two issuers in play the field has to name
    # one of them.
    status, _ = post("/api/submissions",
                     submission("whatever-i-like", "חנות מזויפת",
                                lat=32.0570, lng=35.2940),
                     ip("ivan"))
    check("an unrecognised provider ref is refused", status, 400)
```

Call `merge_cases(check, run)` from `main()` alongside the existing sections.

- [ ] **Step 2: Run it to make sure it fails**

Run: `./.venv/Scripts/python.exe scripts/test_api.py`
Expected: the merge checks FAIL — the second submission returns `published` with a new id, and the made-up ref returns 200.

- [ ] **Step 3: Tighten the schema**

In `src/lib/schemas.ts`, replace the `providerRef` line of `submissionInput`:

```ts
/**
 * The issuers of place identity, and the shapes they issue.
 *
 * This used to be any non-empty string, which was fine while OpenStreetMap was
 * the only issuer and the ref could only come from picking a search result.
 * With Google links accepted the field is caller-supplied in a second way, and
 * an unconstrained identity column is how two rows quietly become
 * unjoinable — or one row gets claimed by a ref nobody can trace.
 */
export const PROVIDER_REF =
  /^(?:osm:(?:node|way|relation)\/\d{1,20}|gmaps:(?:ftid\/0x[0-9a-f]{1,16}:0x[0-9a-f]{1,16}|cid\/\d{1,20}|place\/[\w-]{10,128}))$/;
```

and in `submissionInput`:

```ts
  // Null for a Google link that carries no place id, which is the honest
  // answer: minting gmaps:at/31.80,35.31 would write a false identity that a
  // later submission collides with. The column is nullable and merely UNIQUE,
  // and Postgres permits many nulls, so the near match is the dedupe there.
  providerRef: z
    .string()
    .regex(PROVIDER_REF, "מזהה המקום לא תקין")
    .nullable(),
```

Also relax the admin `location.providerRef` in the same file to use the same
pattern, so both writers agree on what an identity looks like:

```ts
      providerRef: z.string().regex(PROVIDER_REF, "מזהה המקום לא תקין"),
```

- [ ] **Step 4: Add the merge to the submissions route**

In `src/app/api/submissions/route.ts`, first lift the existing "confirm an
existing place" body out of the `if (existing)` block into a helper above
`POST`, so both paths share one implementation:

```ts
type ExistingPlace = {
  id: string;
  benefit_fighter_card: boolean;
  benefit_vacation_voucher: boolean;
};

/** Another person vouching for a place we already have. Shared by the exact
 *  provider-ref hit and the near match, which must behave identically: the
 *  contributor cannot tell which one caught their submission and should not
 *  get a different outcome depending on it. */
async function confirmExisting(
  supabase: ReturnType<typeof serviceClient>,
  place: ExistingPlace,
  input: SubmissionInput,
  ipHash: string,
): Promise<Response> {
  const widen: Record<string, boolean> = {};
  if (input.benefitFighterCard && !place.benefit_fighter_card) {
    widen.benefit_fighter_card = true;
  }
  if (input.benefitVacationVoucher && !place.benefit_vacation_voucher) {
    widen.benefit_vacation_voucher = true;
  }
  if (Object.keys(widen).length > 0) {
    await supabase.from("places").update(widen).eq("id", place.id);
  }

  const { error } = await supabase.from("reports").insert({
    place_id: place.id,
    kind: "confirm",
    benefit_type: input.benefitFighterCard ? "fighter_card" : "vacation_voucher",
    note: input.note ?? null,
    ip_hash: ipHash,
  });
  if (error) {
    console.error("confirm insert failed", error.message);
    return jsonError("השליחה נכשלה. נסו שוב בעוד רגע", 500);
  }

  revalidatePath("/");
  revalidatePath(`/place/${place.id}`);
  return Response.json({ ok: true, placeId: place.id, outcome: "confirmed_existing" });
}
```

Add `import type { SubmissionInput } from "@/lib/schemas";` to the imports.

Then guard the exact lookup, because `provider_ref` may now be null and
`.eq("provider_ref", null)` does not mean what it looks like:

```ts
  let existing: ExistingPlace | null = null;
  if (input.providerRef) {
    const { data, error: lookupError } = await supabase
      .from("places")
      .select("id, status, benefit_fighter_card, benefit_vacation_voucher")
      .eq("provider_ref", input.providerRef)
      .maybeSingle();
    if (lookupError) {
      console.error("submission lookup failed", lookupError.message);
      return jsonError("השליחה נכשלה. נסו שוב בעוד רגע", 500);
    }
    existing = data;
  }

  if (existing) return confirmExisting(supabase, existing, input, ipHash);

  // No ref match. There may still be the same shop here under the other
  // issuer's id, or under none, so ask position and name before adding a
  // second pin to the same doorway.
  const { data: near, error: nearError } = await supabase.rpc("place_near_match", {
    p_lat: input.lat,
    p_lng: input.lng,
    p_name: input.nameHe,
  });
  if (nearError) {
    // A merge we failed to make is a duplicate row, which a moderator can
    // fix. Failing the submission outright loses the contribution, which
    // nobody can. Let it through and let the log show why.
    console.error("near match failed", nearError.message);
  }
  const match = (near as ExistingPlaceRow[] | null)?.[0];
  if (match) {
    const { data: full } = await supabase
      .from("places")
      .select("id, benefit_fighter_card, benefit_vacation_voucher")
      .eq("id", match.id)
      .single();
    if (full) return confirmExisting(supabase, full, input, ipHash);
  }
```

with, above `POST`:

```ts
type ExistingPlaceRow = { id: string; name_he: string };
```

Finally, in the insert, `provider_ref: input.providerRef` already carries null
correctly — confirm the line reads `provider_ref: input.providerRef,` and not
a non-null assertion.

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `./.venv/Scripts/python.exe scripts/test_api.py`
Expected: PASS, all sections including the merge cases and the pre-existing 34 assertions.

Run: `npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/schemas.ts src/app/api/submissions/route.ts scripts/test_api.py
git commit -m "Merge a pasted place into the one already at that doorway"
```

---

### Task 5: The pin preview

**Files:**
- Create: `src/components/MiniMap.tsx`

**Interfaces:**
- Consumes: `maplibre-gl`, the styles at `public/map/light.json` and `public/map/dark.json`.
- Produces: `export default function MiniMap({ lat, lng, label }: { lat: number; lng: number; label?: string })`

- [ ] **Step 1: Write the component**

There is no unit-test harness for React in this project; this component is
verified in Task 6 by `tools/add_flow.js` driving a real browser, which is how
every other map bug here was caught. Create `src/components/MiniMap.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

/**
 * The parsed point, drawn.
 *
 * A wrong pin is the main way adding a place by link goes wrong, and it is
 * completely invisible as text: nobody reads "31.8005, 35.3105" and notices it
 * is the wrong side of town. So the form shows it rather than stating it.
 *
 * Non-interactive on purpose. Correcting a pin by hand is what the submission
 * design refuses, and a map that pans invites exactly that.
 */
export default function MiniMap({
  lat,
  lng,
  label,
}: {
  lat: number;
  lng: number;
  label?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const styleFor = (isDark: boolean) => `/map/${isDark ? "dark" : "light"}.json`;

    const instance = new maplibregl.Map({
      container: host.current,
      style: styleFor(dark.matches),
      center: [lng, lat],
      zoom: 15,
      interactive: false,
      attributionControl: false,
    });
    map.current = instance;

    const marker = new maplibregl.Marker({ color: "#c8102e" })
      .setLngLat([lng, lat])
      .addTo(instance);

    const onScheme = (event: MediaQueryListEvent) => instance.setStyle(styleFor(event.matches));
    dark.addEventListener("change", onScheme);

    return () => {
      dark.removeEventListener("change", onScheme);
      marker.remove();
      instance.remove();
      map.current = null;
    };
  }, [lat, lng]);

  return (
    <div
      ref={host}
      role="img"
      aria-label={label ? `מפה: ${label}` : "מפה עם המיקום שנבחר"}
      className="mt-2 h-40 w-full overflow-hidden border-2 border-line-strong"
      style={{ borderRadius: "var(--radius)" }}
    />
  );
}
```

Check the marker colour against the project's palette before committing: read
`src/app/globals.css` for the `--fighter` custom property and use that value
rather than `#c8102e` if they differ. `scripts/check_palette.py` is the
authority on what colours this project uses.

- [ ] **Step 2: Verify it compiles**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/MiniMap.tsx
git commit -m "Show the pin, because coordinates as text prove nothing"
```

---

### Task 6: The form

**Files:**
- Create: `src/components/GoogleLinkPicker.tsx`
- Modify: `src/components/PlacePicker.tsx` (report the empty-result state and the current query)
- Modify: `src/components/AddPlaceForm.tsx` (mount the fallback)
- Modify: `tools/add_flow.js` (drive the new path)

**Interfaces:**
- Consumes: `PickedPlace` from `./PlacePicker`, `MiniMap` from `./MiniMap`, `GET /api/resolve-link`.
- Produces: `export default function GoogleLinkPicker({ open, suggestedName, onPick, onClear }: { open: boolean; suggestedName: string; onPick: (place: PickedPlace) => void; onClear: () => void })`

- [ ] **Step 1: Let PlacePicker report that it found nothing**

In `src/components/PlacePicker.tsx`, add two optional props and call them. Add
to the props type:

```ts
  /** Fires with the current query whenever a finished search returned nothing,
   *  and with null otherwise. The link fallback opens on it: that is the exact
   *  moment somebody is stuck, and a disclosure they have to notice is one
   *  most people do not. */
  onEmpty?: (query: string | null) => void;
```

Inside the debounced search effect, after `setResults(body.results ?? []);`:

```ts
        onEmpty?.((body.results ?? []).length === 0 ? term : null);
```

and in the `term.length < 2` early return, above `setOpen(false)`:

```ts
      onEmpty?.(null);
```

Add `onEmpty` to the effect's dependency array. To keep that dependency stable,
`AddPlaceForm` must pass a `useCallback`-wrapped handler; the plan does that in
Step 3.

- [ ] **Step 2: Write the link picker**

Create `src/components/GoogleLinkPicker.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import MiniMap from "./MiniMap";
import type { PickedPlace } from "./PlacePicker";

type Resolved = {
  lat: number;
  lng: number;
  providerRef: string | null;
  name: string | null;
  city: string | null;
  address: string | null;
};

const NAME_LIMIT = 160;

/**
 * Add a place the search cannot find, by pasting its Google Maps link.
 *
 * The search is still the better path when it works: it supplies an address, a
 * category and an identity that joins with the imported corpus. So this sits
 * underneath it and opens by itself when a search comes back empty, which is
 * the moment somebody would otherwise give up and send an email instead. That
 * email is what this feature exists to stop.
 */
export default function GoogleLinkPicker({
  open,
  suggestedName,
  onPick,
  onClear,
}: {
  open: boolean;
  suggestedName: string;
  onPick: (place: PickedPlace) => void;
  onClear: () => void;
}) {
  const fieldId = useId();
  const [expanded, setExpanded] = useState(false);
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A resolve in flight must not overwrite a newer one's answer.
  const attempt = useRef(0);

  useEffect(() => {
    if (open) setExpanded(true);
  }, [open]);

  const resolve = useCallback(async (raw: string) => {
    const trimmed = raw.trim();
    setResolved(null);
    onClear();
    if (!trimmed) {
      setError(null);
      return;
    }
    const mine = (attempt.current += 1);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/resolve-link?url=${encodeURIComponent(trimmed)}`);
      const body = (await response.json()) as Resolved & { error?: string };
      if (mine !== attempt.current) return;
      if (!response.ok) {
        setError(body.error ?? "לא הצלחנו לקרוא את הקישור");
        return;
      }
      setResolved(body);
      setName((current) => current || body.name || suggestedName);
    } catch {
      if (mine !== attempt.current) return;
      setError("אין חיבור לרשת. בדקו את החיבור ונסו שוב");
    } finally {
      if (mine === attempt.current) setBusy(false);
    }
  }, [onClear, suggestedName]);

  // Hand the pick up whenever both halves are present. The name is the half
  // the link cannot supply reliably, so it is a field rather than a guess.
  useEffect(() => {
    const trimmed = name.trim();
    if (!resolved || !trimmed) {
      onClear();
      return;
    }
    onPick({
      providerRef: resolved.providerRef,
      nameHe: trimmed,
      lat: resolved.lat,
      lng: resolved.lng,
      addressHe: resolved.address,
      city: resolved.city,
      category: "other",
    });
  }, [resolved, name, onPick, onClear]);

  if (!expanded) {
    return (
      <button
        type="button"
        className="tap mt-3 block text-ink-soft underline"
        style={{ fontSize: "var(--text-sm)" }}
        onClick={() => setExpanded(true)}
      >
        לא מצאתם את בית העסק? הדביקו קישור מגוגל מפות
      </button>
    );
  }

  return (
    <div
      className="mt-4 border-2 border-line-strong px-3 py-3"
      style={{ borderRadius: "var(--radius)" }}
    >
      <label
        htmlFor={fieldId}
        className="mb-1 block font-bold"
        style={{ fontSize: "var(--text-base)" }}
      >
        קישור מגוגל מפות
      </label>
      <input
        id={fieldId}
        className="field"
        type="url"
        inputMode="url"
        dir="ltr"
        autoComplete="off"
        placeholder="https://maps.app.goo.gl/..."
        value={link}
        onChange={(event) => {
          setLink(event.target.value);
          void resolve(event.target.value);
        }}
      />
      <p className="mt-1 text-ink-faint" style={{ fontSize: "var(--text-xs)" }}>
        {busy
          ? "בודק את הקישור"
          : "בגוגל מפות: חפשו את בית העסק, לחצו שיתוף, העתקת קישור, והדביקו כאן."}
      </p>

      {error && (
        <p role="alert" className="mt-2 text-warn" style={{ fontSize: "var(--text-sm)" }}>
          {error}
        </p>
      )}

      {resolved && (
        <>
          <MiniMap lat={resolved.lat} lng={resolved.lng} label={name || undefined} />
          {resolved.address && (
            <p className="mt-1 text-ink-soft" style={{ fontSize: "var(--text-sm)" }}>
              {resolved.address}
            </p>
          )}
          <label
            htmlFor={`${fieldId}-name`}
            className="mt-3 mb-1 block font-bold"
            style={{ fontSize: "var(--text-base)" }}
          >
            שם בית העסק
          </label>
          <input
            id={`${fieldId}-name`}
            className="field"
            type="text"
            maxLength={NAME_LIMIT}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="למשל: עמנואל שלם"
          />
          <p className="mt-1 text-ink-faint" style={{ fontSize: "var(--text-xs)" }}>
            בדקו שהסימון על המפה הוא באמת בית העסק, ושהשם כתוב כמו שאנשים מכירים אותו.
          </p>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Mount it in the form**

In `src/components/AddPlaceForm.tsx`, add state and the handler, next to the
existing `picked` state:

```ts
  const [emptyQuery, setEmptyQuery] = useState<string | null>(null);
```

`handlePick` currently does `setCategory(place.category)`, which would reset a
category the person chose by hand every time the link picker re-emits. Guard it:

```ts
  const handlePick = useCallback((place: PickedPlace) => {
    setPicked((previous) => {
      // The link picker re-emits on every keystroke in the name field. Only a
      // genuinely new place should reset the category the person just chose.
      if (!previous || previous.providerRef !== place.providerRef) {
        setCategory(place.category);
      }
      return place;
    });
    setError(null);
  }, []);
```

Add the empty handler:

```ts
  const handleEmpty = useCallback((query: string | null) => setEmptyQuery(query), []);
```

Pass it to the picker and mount the fallback under it:

```tsx
      <PlacePicker onPick={handlePick} onClear={handleClear} onEmpty={handleEmpty} />

      <GoogleLinkPicker
        open={emptyQuery !== null}
        suggestedName={emptyQuery ?? ""}
        onPick={handlePick}
        onClear={handleClear}
      />
```

with `import GoogleLinkPicker from "./GoogleLinkPicker";` at the top.

- [ ] **Step 4: Drive it in a real browser**

Append to `tools/add_flow.js`, before the browser closes, a second pass over
the link path. Match the file's existing plain-`console.log` style:

```js
  // The link fallback. This is the path the search cannot reach, and the pin
  // preview is a MapLibre instance, which is exactly the kind of thing that
  // renders blank with a clean console. Assert it actually drew.
  await page.goto(target, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.locator('input[role="combobox"]').fill("קקקקקקק לא קיים");
  await page.waitForTimeout(4000);

  const linkField = page.locator('input[type="url"]');
  console.log("link field opened on an empty search:", await linkField.count());

  await linkField.fill(
    "https://www.google.com/maps/place/x/@31.8005,35.3105,17z/data=" +
    "!4m6!3m5!1s0x1502b5c0e1f2a3b4:0x5d6e7f8091a2b3c4!8m2!3d31.8006!4d35.3107");
  await page.waitForTimeout(3000);

  const canvas = page.locator('[role="img"] canvas');
  console.log("mini map canvas:", await canvas.count());
  const size = await canvas.first().boundingBox();
  console.log("mini map size:", size && Math.round(size.width) + "x" + Math.round(size.height));
  console.log("console errors:", errs.length ? errs : "none");
```

Run: `npm run dev`, then `node tools/add_flow.js`
Expected: link field count 1, mini map canvas count 1, a size with **both
dimensions greater than zero**, and no console errors. A zero-width pane is the
specific bug that has bitten this project before, which is why the size is
printed rather than just the count.

- [ ] **Step 5: Check the whole suite**

Run: `npm run check`
Expected: PASS.

Run: `npm run smoke`
Expected: PASS, all 24 local checks.

- [ ] **Step 6: Commit**

```bash
git add src/components/GoogleLinkPicker.tsx src/components/PlacePicker.tsx src/components/AddPlaceForm.tsx tools/add_flow.js
git commit -m "Offer the link the moment the search comes up empty"
```

---

### Task 7: Documentation

**Files:**
- Modify: `README.md`
- Modify: `NEXT.md`

- [ ] **Step 1: Update README.md**

In the "How contribution works" material and the "Trust rules" table, record
the two things a reader would otherwise have to derive from the code:

- under contribution, that a place can arrive either from the OSM typeahead or
  from a pasted Google Maps link, and that the link path exists because OSM
  knows 209 of 610 imported places
- a new row in the Trust rules table: `A submission within 75 m of an existing place, with a similar name, becomes a confirmation of it | place_near_match() + the submissions route`

Also add `npm run gmaps` to the Tests section, next to `npm run check`.

- [ ] **Step 2: Update NEXT.md**

Replace the "How contribution works" bullets with the current picture: two
entry paths, the merge, and the fact that a link submission may carry a null
`provider_ref`. Add a line to "Also worth knowing" recording that the short-link
expander is the only outbound fetch a stranger can trigger and is guarded by a
host allowlist, so nobody later "simplifies" it into fetching arbitrary URLs.

- [ ] **Step 3: Commit**

```bash
git add README.md NEXT.md
git commit -m "Write down the second way a place gets here"
```

---

### Task 8: The six places people sent in

**Files:**
- Create: `scripts/07_add_reported.py`

This is a separate deliverable from the feature above and does not depend on
it. It follows `scripts/06_add_partner.py` exactly: idempotent on `source_key`,
Israel bbox guard, `--dry-run` first.

The six split into two provenances that must not be treated alike:

**Businesses advertising themselves** — no report attached, so `confirm_count`
stays 0, the row draws hollow, and one `not_working` pulls it. `note_he` says
where the details came from, exactly as `06_add_partner.py` does:

| name | city | detail | category | benefit |
|---|---|---|---|---|
| עמנואל שלם ייצור ומסחר | מישור אדומים | אופירה 6, 02-5906006, ‏15% הנחה על Carhartt | `other` | fighter card |
| צימר מנוחה בשמחה | שילה | 054-6344873, shilotzimmer@gmail.com | `zimmer` | vacation voucher only |

**Reservists reporting from experience** — these get a `new_submission` report
each, because a person really was there:

| name | city | detail | category | benefit |
|---|---|---|---|---|
| מסעדת גופנא | שילה | "אתמול הייתי שם" | `restaurant` | fighter card |
| גולף | מעלה אדומים | "עבד לי לפני 3 ימים" | `clothing` | fighter card |
| ZIP ‏(זיפ) | מעלה אדומים | same reporter | `clothing` | fighter card |
| אושיקה | מעלה אדומים | same reporter | `clothing` | fighter card |

The צימר is voucher-only and not fighter-card: the correspondent is right that
the card is for goods and the מלונות/מילואים voucher is what lodging takes.

- [ ] **Step 1: Get coordinates, and check each one**

Coordinates are the part that goes wrong silently. For each place, resolve it
and then verify:

```bash
curl -s "https://photon.komoot.io/api/?q=<name>&bbox=34.2,29.4,35.9,33.4&limit=5" \
  -H "User-Agent: fighter-map/1.0" | python -m json.tool
```

Each result must be checked against the town it is supposed to be in before it
goes in the table — a pin in the right country but the wrong town is the
failure mode here, and six rows is few enough that a wrong one sits unnoticed
for weeks. The three מעלה אדומים shops are branches of national chains, so the
search must be narrowed to the town (they are in the מרכז מסחרי / קניון area
around `31.777, 35.298`) rather than taking the first national hit.

If a place cannot be resolved confidently, leave it out of this pass and say
so rather than guessing a pin.

- [ ] **Step 2: Write the script**

Copy `scripts/06_add_partner.py` and adapt: two `BRANCHES`-style tables
(`SELF_REPORTED` and `WITNESSED`), the same `BOUNDS` guard, the same
`--dry-run` flag and the same `on_conflict=source_key` upsert. Keys are
`reported:emanuel-shalem`, `reported:shilo-zimmer`, `reported:gofna-shilo`,
`reported:golf-maale-adumim`, `reported:zip-maale-adumim`,
`reported:oshika-maale-adumim`.

For the witnessed four, after the upsert returns the rows, insert one report
each:

```python
    reports = [
        {"place_id": row["id"], "kind": "new_submission",
         "benefit_type": "fighter_card", "ip_hash": "reported-by-email"}
        for row in written if row["source_key"] in WITNESSED_KEYS
    ]
```

**This is not idempotent the way the upsert is** — rerunning would insert a
second report. Because `apply_report()` counts `distinct ip_hash`, a duplicate
row does not change `confirm_count`, so a rerun is harmless. Say that in the
docstring rather than leaving the next reader to work it out.

- [ ] **Step 3: Dry run**

Run: `./.venv/Scripts/python.exe scripts/07_add_reported.py --dry-run`
Expected: six rows printed, each with its town and coordinates, nothing sent.

- [ ] **Step 4: Load, then look**

```bash
export NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
./.venv/Scripts/python.exe scripts/07_add_reported.py
```

Then open the site **twice** — `06_add_partner.py`'s docstring explains why: this
writes straight to PostgREST, so `revalidatePath` never runs and the first
request after the cache window only kicks off the rebuild.

Check each of the six on the map, in the right town.

- [ ] **Step 5: Commit**

```bash
git add scripts/07_add_reported.py
git commit -m "Add the six places people wrote in about"
```

---

## Self-review

**Spec coverage.** Parser → Task 1. Expander, host allowlist, hop cap, Photon
reverse, the no-position message → Task 2. `place_near_match`, the
`name_similarity` shadowing note, the status filter → Task 3. Route merge,
nullable `providerRef`, the tightened pattern, the `test_api.py` fixture
collision → Task 4. `MiniMap` → Task 5. `GoogleLinkPicker`, the
open-on-empty-search behaviour → Task 6. Docs → Task 7. The spec's "out of
scope" (draggable pin) is implemented nowhere, which is correct.

**Gap found and closed.** The spec did not say what happens to
`AddPlaceForm`'s `setCategory(place.category)` when the link picker re-emits a
pick on every keystroke in the name field; it would reset a hand-chosen
category. Task 6 Step 3 guards it on `providerRef` change.

**Second gap found and closed.** With `providerRef` nullable,
`.eq("provider_ref", null)` in the submissions route does not match null rows —
PostgREST renders it as `provider_ref=eq.null`, which is not `is null`. Task 4
Step 4 guards the exact lookup behind `if (input.providerRef)` instead.

**Type consistency.** `PickedPlace` is consumed unchanged in Tasks 5 and 6 and
still requires a `category`, which `GoogleLinkPicker` supplies as `"other"`.
`GoogleMapsParse` discriminants are spelled `pin` / `needs_expanding` /
`no_position` / `outside_israel` / `not_a_map_link` in Tasks 1, 2 and the test
table alike. `place_near_match` returns `name_similarity` in both the migration
and the section-K test.
