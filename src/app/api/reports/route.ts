import { revalidatePath } from "next/cache";
import { reportInput, firstError } from "@/lib/schemas";
import { serviceClient, supabaseConfigured } from "@/lib/supabase";
import {
  hashIp,
  jsonError,
  rateLimited,
  verifyTurnstile,
} from "@/lib/server/security";

/**
 * "עבד לי" / "לא עבד לי".
 *
 * The row goes in; a trigger on the reports table recounts and moves the
 * place's status. Keeping the arithmetic in the database means the rule holds
 * even if a second client ever writes here.
 */
export async function POST(request: Request) {
  if (!supabaseConfigured) return jsonError("בסיס הנתונים לא מחובר", 503);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("הבקשה לא תקינה", 400);
  }

  const parsed = reportInput.safeParse(payload);
  if (!parsed.success) return jsonError(firstError(parsed.error), 400);
  const input = parsed.data;

  const turnstile = await verifyTurnstile(input.turnstileToken, request);
  if (!turnstile.ok) return jsonError(turnstile.message, 403);

  const supabase = serviceClient();
  const ipHash = hashIp(request);

  if (await rateLimited(supabase, ipHash)) {
    return jsonError("שלחתם הרבה דיווחים בשעה האחרונה. נסו שוב עוד שעה", 429);
  }

  const { data: place, error: lookupError } = await supabase
    .from("places")
    .select("id")
    .eq("id", input.placeId)
    .maybeSingle();

  if (lookupError) {
    console.error("report lookup failed", lookupError.message);
    return jsonError("השליחה נכשלה. נסו שוב בעוד רגע", 500);
  }
  if (!place) return jsonError("המקום הזה לא קיים יותר", 404);

  const { error } = await supabase.from("reports").insert({
    place_id: input.placeId,
    kind: input.kind,
    benefit_type: input.benefitType ?? null,
    note: input.note ?? null,
    ip_hash: ipHash,
  });

  if (error) {
    console.error("report insert failed", error.message);
    return jsonError("השליחה נכשלה. נסו שוב בעוד רגע", 500);
  }

  revalidatePath("/");
  revalidatePath(`/place/${input.placeId}`);
  return Response.json({ ok: true });
}
