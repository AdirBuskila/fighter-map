import { revalidatePath } from "next/cache";
import { submissionInput, firstError, type SubmissionInput } from "@/lib/schemas";
import { serviceClient, supabaseConfigured } from "@/lib/supabase";
import {
  hashIp,
  jsonError,
  rateLimited,
  verifyTurnstile,
} from "@/lib/server/security";

/**
 * A new place from /add.
 *
 * If the place is already known this is not a second row, it is another person
 * vouching for the same shop, so it becomes a confirmation. Two things decide
 * "already known", and they are not interchangeable:
 *
 *   - the provider ref matches. Exact, free, and the only test needed while
 *     OpenStreetMap was the sole issuer of identity
 *   - or place_near_match finds a row in the same doorway under a name that is
 *     the same name. This is what covers a Google link and an OSM pick for one
 *     shop, whose refs come from different issuers and can never be equal
 *
 * The form still refuses free text for the location: a submitter picks from
 * the search or pastes a link Google resolved, never types coordinates.
 */

type ExistingPlace = {
  id: string;
  benefit_fighter_card: boolean;
  benefit_vacation_voucher: boolean;
};

type NearMatch = { id: string; name_he: string };

/**
 * Another person vouching for a place we already have.
 *
 * Shared by the exact provider-ref hit and the near match, which have to
 * behave identically: the contributor cannot tell which of the two caught
 * their submission and must not get a different outcome depending on it.
 */
async function confirmExisting(
  supabase: ReturnType<typeof serviceClient>,
  place: ExistingPlace,
  input: SubmissionInput,
  ipHash: string,
): Promise<Response> {
  // Widen the benefits if this reporter knows about one we did not have.
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
  return Response.json({
    ok: true,
    placeId: place.id,
    outcome: "confirmed_existing",
  });
}

export async function POST(request: Request) {
  if (!supabaseConfigured) return jsonError("בסיס הנתונים לא מחובר", 503);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("הבקשה לא תקינה", 400);
  }

  const parsed = submissionInput.safeParse(payload);
  if (!parsed.success) return jsonError(firstError(parsed.error), 400);
  const input = parsed.data;

  const turnstile = await verifyTurnstile(input.turnstileToken, request);
  if (!turnstile.ok) return jsonError(turnstile.message, 403);

  const supabase = serviceClient();
  const ipHash = hashIp(request);

  if (await rateLimited(supabase, ipHash)) {
    return jsonError("שלחתם הרבה דיווחים בשעה האחרונה. נסו שוב עוד שעה", 429);
  }

  // Guarded rather than run unconditionally: a link with no Google id sends
  // null, and PostgREST renders .eq("provider_ref", null) as provider_ref=eq.null,
  // which is not "is null" and matches nothing on some rows while being a
  // confusing no-op on the rest.
  let existing: ExistingPlace | null = null;
  if (input.providerRef) {
    const { data, error: lookupError } = await supabase
      .from("places")
      .select("id, benefit_fighter_card, benefit_vacation_voucher")
      .eq("provider_ref", input.providerRef)
      .maybeSingle();

    if (lookupError) {
      console.error("submission lookup failed", lookupError.message);
      return jsonError("השליחה נכשלה. נסו שוב בעוד רגע", 500);
    }
    existing = data;
  }

  if (existing) return confirmExisting(supabase, existing, input, ipHash);

  // No ref match. The same shop may still be here under the other issuer's id,
  // or under none at all, so ask position and name before putting a second pin
  // in the same doorway.
  const { data: near, error: nearError } = await supabase.rpc("place_near_match", {
    p_lat: input.lat,
    p_lng: input.lng,
    p_name: input.nameHe,
  });
  if (nearError) {
    // A merge we failed to make is a duplicate row, which a moderator can fix.
    // Failing the submission outright loses the contribution, which nobody
    // can. Let it through and let the log show why.
    console.error("near match failed", nearError.message);
  }

  const match = (near as NearMatch[] | null)?.[0];
  if (match) {
    const { data: full } = await supabase
      .from("places")
      .select("id, benefit_fighter_card, benefit_vacation_voucher")
      .eq("id", match.id)
      .single();
    if (full) return confirmExisting(supabase, full, input, ipHash);
  }

  const { data: created, error: insertError } = await supabase
    .from("places")
    .insert({
      provider_ref: input.providerRef,
      name_he: input.nameHe,
      category: input.category,
      is_chain: false,
      is_online: false,
      // PostgREST cannot build a geography literal, so hand Postgres the WKT.
      location: `SRID=4326;POINT(${input.lng} ${input.lat})`,
      address_he: input.addressHe ?? null,
      city: input.city ?? null,
      benefit_fighter_card: input.benefitFighterCard,
      benefit_vacation_voucher: input.benefitVacationVoucher,
      note_he: input.note ?? null,
      source: "user_submission",
      // Published on arrival. The place is real (it came from the search
      // provider or from a link Google resolved, not a text box) and it is
      // pinned, so the only thing waiting would buy is corroboration, which on
      // a map this young never arrives: the contributor sees nothing appear
      // and stops contributing.
      //
      // What replaces the wait is 0004. The row is drawn hollow and badged
      // דיווח אחד until a second person vouches, and until then a single
      // not_working report is enough to pull it. Cheap to add, equally cheap
      // to remove.
      status: "published",
      first_reported_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError || !created) {
    console.error("place insert failed", insertError?.message);
    return jsonError("השליחה נכשלה. נסו שוב בעוד רגע", 500);
  }

  const { error: reportError } = await supabase.from("reports").insert({
    place_id: created.id,
    kind: "new_submission",
    benefit_type: input.benefitFighterCard ? "fighter_card" : "vacation_voucher",
    note: input.note ?? null,
    ip_hash: ipHash,
  });
  if (reportError) console.error("submission report failed", reportError.message);

  revalidatePath("/");
  revalidatePath(`/place/${created.id}`);
  return Response.json({ ok: true, placeId: created.id, outcome: "published" });
}
