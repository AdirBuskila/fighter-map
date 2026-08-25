import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A stable pseudonym for a reporter.
 *
 * Salted so the table cannot be walked back to a list of addresses by anyone
 * who gets a copy of it, and truncated because 128 bits is plenty to count
 * distinct reporters with.
 */
export function hashIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const salt = process.env.IP_HASH_SALT ?? "fighter-map-dev-salt";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

export const RATE_LIMIT_PER_HOUR = 5;

/**
 * Five reports per reporter per hour, counted against the reports table rather
 * than process memory: serverless gives every request a different instance, so
 * an in-memory counter would reset constantly and enforce nothing.
 */
export async function rateLimited(
  supabase: SupabaseClient,
  ipHash: string,
): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);

  // A failure to count is not a licence to flood, but it should not take the
  // whole endpoint down either. Let it through and let the log show why.
  if (error) {
    console.error("rate limit check failed", error.message);
    return false;
  }
  return (count ?? 0) >= RATE_LIMIT_PER_HOUR;
}

/**
 * Cloudflare Turnstile. Absent secret means the check is not configured, which
 * is the normal state on a fresh clone, so it passes rather than blocking
 * local development. Configure it before the site is public.
 */
export async function verifyTurnstile(
  token: string | undefined,
  request: Request,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true };
  if (!token) return { ok: false, message: "אימות האבטחה לא הושלם, נסו לרענן את הדף" };

  const body = new URLSearchParams({ secret, response: token });
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) body.set("remoteip", forwarded);

  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body },
    );
    const data = (await res.json()) as { success?: boolean };
    if (data.success) return { ok: true };
    return { ok: false, message: "אימות האבטחה נכשל, נסו לרענן את הדף" };
  } catch {
    return { ok: false, message: "לא הצלחנו לאמת את הבקשה, נסו שוב בעוד רגע" };
  }
}

/** Constant-time comparison so the admin password cannot be probed by timing. */
export function adminPasswordOk(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}
