import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** True when the environment is configured. Pages render an honest empty
 *  state rather than crashing when it is not, so `npm run dev` works on a
 *  fresh clone before any keys exist. */
export const supabaseConfigured = Boolean(url && anonKey);

export function browserClient(): SupabaseClient {
  return createBrowserClient(url, anonKey);
}

/** Read-only server client. There are no user sessions in this app, so it has
 *  no cookies to carry; it exists to keep reads on the server where they are
 *  cheaper and cacheable. */
export function serverClient(): SupabaseClient {
  return createServerClient(url, anonKey, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}

/** Bypasses RLS. Only ever constructed inside a route handler. */
export function serviceClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(url, key, { auth: { persistSession: false } });
}
