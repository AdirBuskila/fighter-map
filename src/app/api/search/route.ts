import { jsonError } from "@/lib/server/security";
import { guessCategoryFromOsm } from "@/lib/categorise";

/**
 * Place search, proxied.
 *
 * Photon is OpenStreetMap's typeahead geocoder: free, no key, no account. It
 * is proxied rather than called from the browser for four reasons, all of
 * which matter more than the extra hop:
 *
 *   - the reader's browser never talks to a third party, so no address of
 *     theirs leaves this origin
 *   - we send a real User-Agent, which is what their fair-use policy asks for
 *   - results come back in the shape the form wants, so the client holds no
 *     knowledge of Photon at all and a future swap touches one file
 *   - responses cache at the edge, so the same query typed by ten people costs
 *     one upstream request
 *
 * The OSM ref it returns is the identity the whole submission flow rests on:
 * two people reporting the same shop must land on the same row.
 */

const PHOTON = "https://photon.komoot.io/api/";
const ISRAEL_BBOX = "34.2,29.4,35.9,33.4";
const UA = "fighter-map/1.0 (community benefit map for Israeli reservists)";

const OSM_TYPE: Record<string, string> = { N: "node", W: "way", R: "relation" };

export type SearchResult = {
  providerRef: string;
  name: string;
  address: string | null;
  city: string | null;
  category: string;
  lat: number;
  lng: number;
};

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, unknown>;
};

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = (params.get("q") ?? "").trim();
  if (q.length < 2) return Response.json({ results: [] });

  const limit = Math.min(Math.max(Number(params.get("limit") ?? 8), 1), 20);
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));

  const upstream = new URL(PHOTON);
  upstream.searchParams.set("q", q);
  upstream.searchParams.set("limit", String(limit));
  upstream.searchParams.set("lang", "default");
  upstream.searchParams.set("bbox", ISRAEL_BBOX);
  // Bias to wherever the reader is standing, which is almost always the shop
  // they are about to report.
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    upstream.searchParams.set("lat", String(lat));
    upstream.searchParams.set("lon", String(lng));
  }

  let payload: { features?: PhotonFeature[] };
  try {
    const response = await fetch(upstream, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 3600 },
    });
    if (!response.ok) {
      console.error("photon returned", response.status);
      return jsonError("החיפוש לא זמין כרגע. נסו שוב בעוד רגע", 502);
    }
    payload = (await response.json()) as { features?: PhotonFeature[] };
  } catch {
    return jsonError("החיפוש לא זמין כרגע. נסו שוב בעוד רגע", 502);
  }

  const results: SearchResult[] = [];
  for (const feature of payload.features ?? []) {
    const props = feature.properties ?? {};
    const coords = feature.geometry?.coordinates;
    const osmType = OSM_TYPE[String(props.osm_type ?? "")];
    const name = typeof props.name === "string" ? props.name : null;

    // No name means a bare address, and no ref means nothing to key on. Both
    // are useless here: this endpoint exists to identify a business.
    if (!coords || !osmType || !props.osm_id || !name) continue;

    const street = typeof props.street === "string" ? props.street : null;
    const houseNumber = typeof props.housenumber === "string" ? props.housenumber : null;
    const city = typeof props.city === "string" ? props.city
      : typeof props.district === "string" ? props.district
      : null;

    results.push({
      providerRef: `osm:${osmType}/${props.osm_id}`,
      name,
      address: [[street, houseNumber].filter(Boolean).join(" ") || null, city]
        .filter(Boolean)
        .join(", ") || null,
      city,
      category: guessCategoryFromOsm(
        typeof props.osm_key === "string" ? props.osm_key : null,
        typeof props.osm_value === "string" ? props.osm_value : null,
      ),
      lat: coords[1],
      lng: coords[0],
    });
  }

  return Response.json({ results });
}
