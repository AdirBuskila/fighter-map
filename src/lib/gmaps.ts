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
  /** `url` is the link itself, because the page behind it usually does know
   *  where the place is even when the URL does not: see positionFromMapsPage. */
  | { kind: "no_position"; providerRef: string; name: string | null; url: string }
  /** A Google *Search* page: at best an id and a name, never a point.
   *  Separate from no_position because the two need different instructions,
   *  and giving the wrong one is what sends a contributor away. Both halves
   *  are nullable — a search page Google has no listing for still needs the
   *  same answer, which is "you are on Search, the link lives in Maps". */
  | { kind: "search_share"; providerRef: string | null; name: string | null }
  | { kind: "outside_israel"; lat: number; lng: number }
  | { kind: "not_a_map_link" };

// share.google is the one Chrome's share sheet produces now, and it is worth
// knowing what it expands to: a Google *Search* page carrying a
// knowledge-graph id and no coordinates at all, not a Maps URL. It still
// belongs here, because recognising it is what turns "this is not a map link"
// into a `search_share`, which names the business and can be answered with an
// instruction that matches the page the sharer is actually looking at.
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

  // The same id as a plain parameter, which is how a phone share link
  // expands now: /maps?q=<name>&ftid=0x…:0x…, with no position anywhere.
  const ftidParam = url.searchParams.get("ftid")?.match(/^(0x[0-9a-f]+):(0x[0-9a-f]+)$/i);
  if (ftidParam) {
    return `gmaps:ftid/${ftidParam[1].toLowerCase()}:${ftidParam[2].toLowerCase()}`;
  }

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

/** A name slot is not a name until it is checked. A dropped pin puts the
 *  position there, and offering "31°48'01.8"N" as the shop's name is worse
 *  than offering nothing. */
function cleanName(raw: string | null): string | null {
  if (raw === null) return null;
  const text = raw.replace(BIDI_CONTROLS, "").trim();
  if (!text || COORD_TEXT.test(text) || DMS_TEXT.test(text) || PLUS_CODE.test(text)) {
    return null;
  }
  return text.slice(0, 160);
}

function suggestedName(url: URL): string | null {
  const segment = url.pathname.match(PLACE_SEGMENT)?.[1];
  if (!segment) return null;
  try {
    return cleanName(decodeURIComponent(segment.replace(/\+/g, " ")));
  } catch {
    return null;
  }
}

/** A link with no position has nothing in q= but the listing's name, so it
 *  is a name here and not on a link that has a position. */
function nameWithoutPosition(url: URL): string | null {
  return suggestedName(url) ?? cleanName(url.searchParams.get("q"));
}

const STATIC_MAP = /https?:\/\/maps\.google(?:apis)?\.com\/maps\/api\/staticmap\?[^"'\s<>]+/;
const PAGE_TITLE = /<meta\s+content="([^"]*)"\s+(?:property="og:title"|itemprop="name")/;
// The camera the page opens on: [altitude in metres, lng, lat].
const INITIAL_CAMERA = new RegExp(
  `APP_INITIALIZATION_STATE=\\[\\[\\[(\\d+(?:\\.\\d+)?(?:e\\d+)?),(${NUM}),(${NUM})\\]`,
);
// Anything higher up than this is a view of a region, not of one shop.
const MAX_CAMERA_ALTITUDE = 5000;

function pair(raw: string | null): [number, number] | null {
  // markers= may carry a style before the point: "color:red|31.8,35.3".
  const match = raw?.split("|").pop()?.match(PAIR);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

/**
 * Where a Google Maps place page says the place is.
 *
 * A phone share link expands to a URL that names the listing and carries no
 * coordinates, and the comment on search_share is right that a page built
 * from a knowledge-graph id knows nothing either. A *Maps* page built from a
 * feature id is different: Google renders the preview image server-side, and
 * that image is a static map with a marker on the listing. So the point is in
 * the HTML even though it is not in the URL.
 *
 * In order of trust: the marker, then the preview's centre, then the camera
 * the page opens on, and the last two only when they are close enough to the
 * ground to be a shop rather than a country.
 */
export function positionFromMapsPage(
  html: string,
): { lat: number; lng: number; name: string | null } | null {
  const text = html.replace(/&amp;/g, "&");
  let point: [number, number] | null = null;

  const preview = text.match(STATIC_MAP)?.[0];
  if (preview) {
    try {
      const params = new URL(preview).searchParams;
      point = pair(params.get("markers"));
      if (!point && Number(params.get("zoom")) >= 14) point = pair(params.get("center"));
    } catch {
      point = null;
    }
  }

  if (!point) {
    const camera = text.match(INITIAL_CAMERA);
    if (camera && Number(camera[1]) <= MAX_CAMERA_ALTITUDE) {
      point = [Number(camera[3]), Number(camera[2])];
    }
  }

  if (!point || !point.every(Number.isFinite)) return null;

  let name: string | null = null;
  const title = text.match(PAGE_TITLE)?.[1];
  if (title) {
    // "Name · Address" — the part before the dot is the listing.
    name = cleanName(
      title
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .split(" · ")[0],
    );
  }
  return { lat: point[0], lng: point[1], name };
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
  if (!url) {
    // Bare coordinates, which is what Google Maps shows and copies when you
    // long-press a spot. The one path that needs nothing from Google's
    // servers, so it is the way out when every link form fails.
    const bare = input.match(PAIR);
    if (!bare) return { kind: "not_a_map_link" };
    const [lat, lng] = [Number(bare[1]), Number(bare[2])];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { kind: "not_a_map_link" };
    if (!inIsrael(lat, lng)) return { kind: "outside_israel", lat, lng };
    return { kind: "pin", pin: { lat, lng, providerRef: null, name: null } };
  }

  if (hostKind(url.host) === "short") {
    return { kind: "needs_expanding", url: url.href };
  }

  const providerRef = identity(url);

  // Answered before position, because on /search the q= parameter is what
  // somebody typed into Google, not a place: reading it the way a Maps link's
  // q= is read turns a search for "31.8,35.3" into a pin in a field. A search
  // page never carries a position anyway, so there is nothing to lose here.
  //
  // Not conditional on finding an id. Whether Google happened to attach a
  // kgmid to this particular share is not something the person pasting it can
  // see or influence, and it does not change what they have to do next.
  if (url.pathname === "/search") {
    return {
      kind: "search_share",
      providerRef,
      name: cleanName(url.searchParams.get("q")),
    };
  }

  const point = position(url);

  if (!point) {
    // Some share links expand to identity with no position. Nothing short of
    // the paid Google API turns that ref into a point, so say which of the two
    // is missing and let the caller give a usable instruction.
    return providerRef
      ? { kind: "no_position", providerRef, name: nameWithoutPosition(url), url: url.href }
      : { kind: "not_a_map_link" };
  }

  const [lat, lng] = point;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { kind: "not_a_map_link" };
  if (!inIsrael(lat, lng)) return { kind: "outside_israel", lat, lng };

  return { kind: "pin", pin: { lat, lng, providerRef, name: suggestedName(url) } };
}
