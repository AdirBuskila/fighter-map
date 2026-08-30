import { readFile } from "fs/promises";
import path from "path";
import { serverClient, supabaseConfigured } from "./supabase";
import type { Place } from "./types";

/**
 * Development fallback.
 *
 * Before Supabase exists, `npm run dev` still shows the real UI by reading the
 * pipeline's own output off disk. Production never takes this path: an
 * unconfigured deployment should show the "not connected" screen, not quietly
 * serve a file that nobody can write to.
 */
async function localSeed(): Promise<Place[]> {
  if (process.env.NODE_ENV === "production") return [];
  try {
    const raw = await readFile(
      path.join(process.cwd(), "data", "places.json"),
      "utf-8",
    );
    const rows = JSON.parse(raw) as Array<Record<string, unknown>>;
    console.warn(
      `[dev] Supabase is not configured, reading ${rows.length} places from data/places.json`,
    );
    return rows.map((row, index) => ({
      ...(row as object),
      id: (row.provider_ref as string) ?? `local-${index}`,
      status: "published",
      // The disk fallback is the importer's own output, which only ever
      // held doorway coordinates.
      location_precision: "exact" as const,
      // data/places.json is the importer's output, so every row here is one.
      source: "pdf_import",
      confirm_count: 0,
      report_count: 0,
      last_confirmed_at: null,
      distance_m: null,
      lat: (row.lat as number) ?? null,
      lng: (row.lng as number) ?? null,
    })) as Place[];
  } catch {
    return [];
  }
}

/** Every place with a pin, for the country-wide first paint. */
export async function fetchMappedPlaces(): Promise<Place[]> {
  if (!supabaseConfigured) {
    return (await localSeed()).filter((p) => p.lat != null && p.lng != null);
  }
  const { data, error } = await serverClient().rpc("places_all", {});
  if (error) {
    console.error("places_all failed", error.message);
    return [];
  }
  return (data ?? []) as Place[];
}

/**
 * Everything the map cannot draw.
 *
 * Three kinds of row end up here, and they are not the same thing. A chain has
 * no single point by nature; an online shop has no point at all; and a
 * physical place marked `pin_unavailable` has a real doorway that neither
 * geocoder could find. All three are still worth listing, because the reader's
 * question is "does the card work here", and the place page answers that
 * without a pin -- `googleMapsUrl()` falls back to a search by name and town.
 *
 * `places_all` filters `location is not null`, so none of these can leak onto
 * the map however they are flagged.
 */
export async function fetchUnmappedPlaces(): Promise<Place[]> {
  if (!supabaseConfigured) {
    return (await localSeed()).filter(
      (p) => p.is_chain || p.is_online || p.lat == null,
    );
  }
  const { data, error } = await serverClient()
    .from("places")
    .select(
      "id, provider_ref, name_he, name_en, category, is_chain, is_online," +
        " address_he, city, phone, url, benefit_fighter_card," +
        " benefit_vacation_voucher, note_he, source, status, confirm_count," +
        " report_count, first_reported_at, last_confirmed_at",
    )
    .in("status", ["published", "reported_not_working"])
    .or("is_chain.eq.true,is_online.eq.true,location.is.null")
    .order("name_he");

  if (error) {
    console.error("unmapped places failed", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    ...(row as object),
    lat: null,
    lng: null,
    distance_m: null,
  })) as Place[];
}

/**
 * How many places the site actually lists.
 *
 * fetchMappedPlaces() cannot answer this: it returns only rows with
 * coordinates, and since 0006 most published places have none. The landing
 * page shows both numbers side by side, so it needs this one counted rather
 * than inferred, and a head request is the cheapest way to get it.
 */
export async function countPublishedPlaces(): Promise<number> {
  if (!supabaseConfigured) {
    return (await localSeed()).length;
  }
  const { count, error } = await serverClient()
    .from("places")
    .select("id", { count: "exact", head: true })
    .eq("status", "published");

  if (error) {
    console.error("published count failed", error.message);
    return 0;
  }
  return count ?? 0;
}

export async function fetchPlace(id: string): Promise<Place | null> {
  if (!supabaseConfigured) {
    return (await localSeed()).find((p) => p.id === id) ?? null;
  }
  const { data, error } = await serverClient().rpc("place_by_id", { p_id: id });
  if (error) {
    console.error("place_by_id failed", error.message);
    return null;
  }
  const rows = (data ?? []) as Place[];
  return rows[0] ?? null;
}
