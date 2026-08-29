import { jsonError } from "@/lib/server/security";
import {
  isGoogleUrl,
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
