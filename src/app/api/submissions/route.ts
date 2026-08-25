import { revalidatePath } from "next/cache";
import { submissionInput, firstError } from "@/lib/schemas";
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
 * If the provider ref is already known this is not a second row, it is
 * another person vouching for the same shop, so it becomes a confirmation.
 * That is the whole reason the submission form refuses free text: identity has
 * to come from the search provider, or the dataset silently forks.
 */
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

  const { data: existing, error: lookupError } = await supabase
    .from("places")
    .select("id, status, benefit_fighter_card, benefit_vacation_voucher")
    .eq("provider_ref", input.providerRef)
    .maybeSingle();

  if (lookupError) {
    console.error("submission lookup failed", lookupError.message);
    return jsonError("השליחה נכשלה. נסו שוב בעוד רגע", 500);
  }

  if (existing) {
    // Widen the benefits if this reporter knows about one we did not have.
    const widen: Record<string, boolean> = {};
    if (input.benefitFighterCard && !existing.benefit_fighter_card) {
      widen.benefit_fighter_card = true;
    }
    if (input.benefitVacationVoucher && !existing.benefit_vacation_voucher) {
      widen.benefit_vacation_voucher = true;
    }
    if (Object.keys(widen).length > 0) {
      await supabase.from("places").update(widen).eq("id", existing.id);
    }

    const { error } = await supabase.from("reports").insert({
      place_id: existing.id,
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
    revalidatePath(`/place/${existing.id}`);
    return Response.json({
      ok: true,
      placeId: existing.id,
      outcome: "confirmed_existing",
    });
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
      status: "pending",
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
  return Response.json({ ok: true, placeId: created.id, outcome: "pending" });
}
