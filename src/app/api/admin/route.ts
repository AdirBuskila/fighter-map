import { revalidatePath } from "next/cache";
import { adminActionInput, firstError } from "@/lib/schemas";
import { serviceClient, supabaseConfigured } from "@/lib/supabase";
import { adminPasswordOk, jsonError } from "@/lib/server/security";

const QUEUE_COLUMNS =
  "id, provider_ref, name_he, name_en, category, is_chain, is_online," +
  " address_he, city, phone, url, benefit_fighter_card," +
  " benefit_vacation_voucher, note_he, status, source, review_reason," +
  " confirm_count, report_count, first_reported_at, last_confirmed_at, created_at";

export async function POST(request: Request) {
  if (!supabaseConfigured) return jsonError("בסיס הנתונים לא מחובר", 503);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("הבקשה לא תקינה", 400);
  }

  const parsed = adminActionInput.safeParse(payload);
  if (!parsed.success) return jsonError(firstError(parsed.error), 400);
  const input = parsed.data;

  if (!adminPasswordOk(input.password)) {
    return jsonError("סיסמה שגויה", 401);
  }

  const supabase = serviceClient();

  if (input.action === "list") {
    const [pending, flagged, revived] = await Promise.all([
      supabase
        .from("places")
        .select(QUEUE_COLUMNS)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(500),
      supabase
        .from("places")
        .select(QUEUE_COLUMNS)
        .eq("status", "reported_not_working")
        .order("report_count", { ascending: false })
        .limit(200),
      // A place flipped to "not working" that keeps collecting confirmations is
      // the signal that the business changed its mind. The trigger never
      // un-flips a place on its own, so surface these for a human to decide.
      supabase
        .from("places")
        .select(QUEUE_COLUMNS)
        .eq("status", "reported_not_working")
        .gt("confirm_count", 0)
        .order("confirm_count", { ascending: false })
        .limit(100),
    ]);

    const failed = pending.error || flagged.error || revived.error;
    if (failed) {
      console.error("admin list failed", failed.message);
      return jsonError("טעינת התור נכשלה", 500);
    }

    return Response.json({
      pending: pending.data ?? [],
      flagged: flagged.data ?? [],
      revived: revived.data ?? [],
    });
  }

  const placeId = input.placeId as string;
  let update: Record<string, unknown> = {};

  if (input.action === "approve") {
    update = { status: "published", review_reason: null };
  } else if (input.action === "reject") {
    update = { status: "rejected" };
  } else if (input.action === "locate") {
    // Give the place a pin and publish it in one step. This is how the few
    // hundred rows no geocoder could find actually reach the map: the
    // moderator searches, the provider supplies the identity.
    const spot = input.location!;
    update = {
      provider_ref: spot.providerRef,
      location: `SRID=4326;POINT(${spot.lng} ${spot.lat})`,
      address_he: spot.addressHe ?? null,
      city: spot.city ?? null,
      status: "published",
      review_reason: null,
    };
  } else if (input.action === "restore") {
    // Retire the failure reports that caused the flip. Without this the next
    // single report recounts them and puts the place straight back.
    const { error: supersedeError } = await supabase
      .from("reports")
      .update({ superseded_at: new Date().toISOString() })
      .eq("place_id", placeId)
      .eq("kind", "not_working")
      .is("superseded_at", null);
    if (supersedeError) {
      console.error("supersede failed", supersedeError.message);
      return jsonError("לא הצלחנו לאפס את הדיווחים. נסו שוב", 500);
    }
    update = { status: "published", report_count: 0, review_reason: null };
  } else {
    const patch = input.patch ?? {};
    if (patch.nameHe !== undefined) update.name_he = patch.nameHe;
    if (patch.city !== undefined) update.city = patch.city;
    if (patch.category !== undefined) update.category = patch.category;
    if (patch.noteHe !== undefined) update.note_he = patch.noteHe;
    if (patch.benefitFighterCard !== undefined) {
      update.benefit_fighter_card = patch.benefitFighterCard;
    }
    if (patch.benefitVacationVoucher !== undefined) {
      update.benefit_vacation_voucher = patch.benefitVacationVoucher;
    }
    if (Object.keys(update).length === 0) {
      return jsonError("לא נשלח שום שינוי", 400);
    }
  }

  const { error } = await supabase.from("places").update(update).eq("id", placeId);
  if (error) {
    console.error("admin update failed", error.message);
    // A published place with no pin trips a check constraint. Say so plainly
    // instead of returning a generic failure.
    if (error.message.includes("places_provider_ref_key")) {
      return jsonError("המקום הזה כבר קיים במפה תחת שם אחר", 409);
    }
    if (error.message.includes("places_published_needs_pin")) {
      return jsonError(
        "אי אפשר לפרסם מקום בלי נקודת ציון. מצאו אותו מחדש דרך הוספת מקום",
        409,
      );
    }
    return jsonError("העדכון נכשל. נסו שוב בעוד רגע", 500);
  }

  revalidatePath("/");
  revalidatePath(`/place/${placeId}`);
  return Response.json({ ok: true });
}
