import type { AppSupabaseClient } from "./types.ts";

const WINDOW_SECONDS = 60;

export type RateLimitResult = { allowed: boolean; retryAfterSeconds?: number };

/**
 * Best-effort per-user rate limit backed by the `rate_limit_events` table.
 * Fails open (allows the request) if the check itself errors, so a DB hiccup
 * never blocks legitimate usage — this is an abuse guard, not the app's
 * primary security boundary (auth + RLS + ownership checks are).
 */
export async function checkRateLimit(
  supabase: AppSupabaseClient,
  userId: string,
  action: string,
  maxPerWindow: number,
): Promise<RateLimitResult> {
  const windowStart = new Date(Date.now() - WINDOW_SECONDS * 1000).toISOString();
  const { count, error } = await supabase
    .from("rate_limit_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("action", action)
    .gte("created_at", windowStart);

  if (error) {
    console.error(`[rateLimit] check failed for ${action}, failing open`, error);
    return { allowed: true };
  }
  if ((count ?? 0) >= maxPerWindow) {
    return { allowed: false, retryAfterSeconds: WINDOW_SECONDS };
  }
  // Best-effort log; a failed insert must not block the request.
  await supabase.from("rate_limit_events").insert({ user_id: userId, action }).then(
    () => {},
    (e: unknown) => console.error(`[rateLimit] log insert failed for ${action}`, e),
  );
  return { allowed: true };
}
