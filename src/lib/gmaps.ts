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

// share.google is the one Chrome's share sheet produces now, and it is worth
// knowing what it expands to: a Google *Search* page carrying a
// knowledge-graph id and no coordinates at all, not a Maps URL. It still
// belongs here, because recognising it is what turns "this is not a map link"
// into "open it in Maps and copy the address bar", which a person can act on.
const SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl", "g.co", "share.google"]);

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

// Deliberately permissive about apostrophes and brackets: a dropped-pin URL
// carries its position as DMS, so it really does contain 31%C2%B048'01.8%22N,
// and excluding ' truncates the link at the minutes mark. Trailing punctuation
// is trimmed afterwards instead, which is what prose actually adds.
const URL_IN_TEXT = /https?:\/\/[^\s<>"]+/gi;
const TRAILING_PUNCT = /[.,;:!?')\]}]+$/;

// Google hands back listing names with bidi controls embedded — a real one
// ends "…שף הררית-‭". Invisible, so it survives every eyeball check, and
// it would be stored and then rendered into an already-RTL page.
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩​﻿]/g;

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
      url = new URL(candidate.replace(TRAILING_PUNCT, ""));
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

/** Any host this module recognises, short or full. The expander needs this
 *  separately from parseGoogleMapsUrl, which cannot tell "not Google at all"
 *  from "Google, but this particular URL says nothing yet". */
export function isGoogleUrl(input: string): boolean {
  return firstGoogleUrl(input) !== null;
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

  // A share.google link lands on a search page, whose only durable handle on
  // the business is the knowledge-graph id. Worth keeping even without a
  // position: it is what a later paste of the same business joins on.
  const kgmid = url.searchParams.get("kgmid");
  if (kgmid && /^\/g\/[\w]{4,32}$/.test(kgmid)) return `gmaps:mid${kgmid}`;

  return null;
}

function suggestedName(url: URL): string | null {
  const segment = url.pathname.match(PLACE_SEGMENT)?.[1];
  if (!segment) return null;

  let text: string;
  try {
    text = decodeURIComponent(segment.replace(/\+/g, " "))
      .replace(BIDI_CONTROLS, "")
      .trim();
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
