import { serverClient, supabaseConfigured } from "@/lib/supabase";
import { jsonError } from "@/lib/server/security";

/** Wraps the places_near RPC so radius filtering stays in Postgres, where the
 *  GIST index is, rather than shipping the whole country to the phone. */
export async function GET(request: Request) {
  if (!supabaseConfigured) return jsonError("בסיס הנתונים לא מחובר", 503);

  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const radius = Number(params.get("radius") ?? 25000);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return jsonError("חסרות קואורדינטות תקינות", 400);
  }

  const { data, error } = await serverClient().rpc("places_near", {
    p_lat: lat,
    p_lng: lng,
    p_radius_m: Math.min(Math.max(Math.round(radius), 100), 200000),
    p_benefit: params.get("benefit"),
    p_categories: params.get("categories")?.split(",").filter(Boolean) ?? null,
  });

  if (error) {
    console.error("places_near failed", error.message);
    return jsonError("החיפוש נכשל. נסו שוב בעוד רגע", 500);
  }
  return Response.json({ places: data ?? [] });
}
