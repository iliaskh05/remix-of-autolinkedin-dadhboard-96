// Shared CORS helper for all Edge Functions.
// Configure the ALLOWED_ORIGINS secret (comma-separated list, e.g.
// "https://app.example.com,https://staging.example.com") to lock this down.
// Until it's set, we fall back to "*" (previous behavior) so nothing breaks,
// but a warning is logged on every request to make the gap visible in the logs.
const BASE_HEADERS =
  "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-cron-secret";

function getAllowedOrigins(): string[] {
  const raw = Deno.env.get("ALLOWED_ORIGINS");
  if (!raw) return [];
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
}

export function buildCorsHeaders(req: Request): Record<string, string> {
  const allowed = getAllowedOrigins();
  const origin = req.headers.get("Origin") || "";

  let allowOrigin = "*";
  if (allowed.length > 0) {
    allowOrigin = allowed.includes(origin) ? origin : allowed[0];
  } else {
    console.warn(
      "[cors] ALLOWED_ORIGINS is not configured — allowing all origins ('*'). " +
        "Set the ALLOWED_ORIGINS secret to restrict this Edge Function to your app's domain(s).",
    );
  }

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": BASE_HEADERS,
    "Vary": "Origin",
  };
}
