import { jsonError } from "@/lib/server/security";
import {
  isGoogleUrl,
  parseGoogleMapsUrl,
  positionFromMapsPage,
  inIsrael,
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
 * shape is deliberately narrow. Only the four short-link hosts are ever
 * requested, every redirect hop is re-checked before it is followed, and the
 * whole thing is capped at four hops and six seconds each. Point it at anything
 * else and it parses the string without opening a socket, which is what keeps
 * it from being a request-forgery hole.
 *
 * No rate limit of its own. It writes nothing, it cannot be aimed anywhere but
 * Google, and repeats are absorbed by the edge cache. Charging a resolve
 * against the five-per-hour submission budget would spend a contributor's
 * quota on getting the form to work.
 */

const MAX_HOPS = 4;
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
    // A hop that stops redirecting is the end of the chain, whatever it is.
    if (!location) return current === shortUrl ? null : current;

    const next = new URL(location, current).href;
    // Re-check every hop. A redirect chain that starts at Google is not a
    // promise that it stays there.
    if (!isGoogleUrl(next)) return null;
    current = next;

    // Stop as soon as the URL says something, rather than at the first hop
    // that is no longer a short link. A share.google link goes short link ->
    // an interstitial on www.google.com -> a search page carrying the
    // knowledge-graph id, and that middle URL parses as nothing at all, so
    // "not a map link yet" is not a reason to give up on the chain.
    const parsed = parseGoogleMapsUrl(current);
    if (parsed.kind !== "not_a_map_link" && parsed.kind !== "needs_expanding") {
      return current;
    }
  }
  return current === shortUrl ? null : current;
}

/**
 * The point a Maps place page renders, for a link whose URL has none.
 *
 * This is what a phone share link expands to now: /maps?q=<name>&ftid=…, an
 * id and a name and nothing else, which is why pasting the link the Maps app
 * hands you used to end in "the link identifies the business but has no
 * location". The page behind it does know; see positionFromMapsPage.
 *
 * Same narrowness as expand(): the URL has already parsed as a Google Maps
 * host, redirects are not followed (a consent wall is a failure, not a hop),
 * and the body is capped. The browser User-Agent is because Google serves a
 * bare page with no preview to anything it does not recognise, and the preview
 * is the whole point of the fetch.
 */
const PAGE_UA =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const MAX_PAGE_BYTES = 2_000_000;

async function readMapsPage(
  pageUrl: string,
): Promise<{ lat: number; lng: number; name: string | null } | null> {
  if (!isGoogleUrl(pageUrl)) return null;
  try {
    const response = await fetch(pageUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent": PAGE_UA,
        "Accept-Language": "he,en;q=0.8",
        // Skip the EU consent interstitial, which would otherwise be the page.
        Cookie: "CONSENT=YES+",
      },
      signal: AbortSignal.timeout(6000),
      next: { revalidate: 86400 },
    });
    if (!response.ok) return null;
    const html = (await response.text()).slice(0, MAX_PAGE_BYTES);
    return positionFromMapsPage(html);
  } catch {
    return null;
  }
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

/**
 * The way out of a Chrome share link.
 *
 * A Google Search share names the business and cannot say where it is, and no
 * amount of fetching fixes that: every Maps URL built from a knowledge-graph
 * id renders client-side, so the page a server gets back is centred on the
 * country, not the shop. Only the paid Places API resolves one, and this
 * project does not have it.
 *
 * So the answer is not a coordinate, it is a shorter walk to a link that
 * works. `?api=1` is Google's documented, stable URL form, and on a phone it
 * opens the Maps app rather than the web page — which is the whole point,
 * because Share in the Maps app produces exactly the maps.app.goo.gl link
 * this route can already read. Without a name there is nothing to search for
 * and the link is not offered.
 */
function mapsSearchUrl(name: string | null): string | null {
  if (!name) return null;
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", name);
  return url.href;
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
  // Chrome's share sheet shares the *page*, and somebody who found the shop
  // by searching Google was never on Maps at all. Telling them to copy the
  // address bar of a Maps page they are not looking at is why this arrived as
  // "I pasted the link and nothing happened", so name what they have and hand
  // them the one tap that gets them a link this route can read.
  if (parsed.kind === "search_share") {
    return Response.json(
      {
        error:
          "זה קישור מחיפוש גוגל ולא מגוגל מפות: הוא מזהה את בית העסק אבל לא איפה הוא. " +
          "פתחו את בית העסק בגוגל מפות, לחצו שם על שיתוף, והדביקו את הקישור שמתקבל.",
        mapsUrl: mapsSearchUrl(parsed.name),
        name: parsed.name,
      },
      { status: 400 },
    );
  }
  if (parsed.kind === "no_position") {
    const found = await readMapsPage(parsed.url);
    if (found && inIsrael(found.lat, found.lng)) {
      const { city, address } = await reverse(found.lat, found.lng);
      return pinResponse(
        {
          lat: found.lat,
          lng: found.lng,
          providerRef: parsed.providerRef,
          name: parsed.name ?? found.name,
        },
        city,
        address,
      );
    }
    if (found) {
      return jsonError("הקישור מצביע על מקום מחוץ לישראל. המפה מכסה רק מקומות בארץ", 400);
    }
    return jsonError(
      "הקישור מזהה את העסק אבל בלי מיקום. פתחו אותו בדפדפן, חכו שהמפה תיטען, והעתיקו את הכתובת משורת הכתובת",
      400,
    );
  }

  const { city, address } = await reverse(parsed.pin.lat, parsed.pin.lng);
  return pinResponse(parsed.pin, city, address);
}
