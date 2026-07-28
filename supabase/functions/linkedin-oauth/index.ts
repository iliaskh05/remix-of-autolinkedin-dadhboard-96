import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";

// State TTL for the OAuth CSRF check (get_auth_url -> exchange_code round trip).
const STATE_TTL_MS = 10 * 60 * 1000;

async function getUserId(req: Request, supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const token = auth.replace("Bearer ", "");
  const { data } = await supabase.auth.getUser(token);
  return data.user?.id ?? null;
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { action, code, redirectUri, state: returnedState } = await req.json();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    if (action === "get_auth_url") {
      const userId = await getUserId(req, supabase);
      if (!userId) {
        return json(401, {
          success: false,
          error: "NOT_AUTHENTICATED",
          message: "Tu dois être connecté à ton compte avant de lier LinkedIn. Redirection vers la page de connexion...",
          redirectTo: "/auth",
        });
      }

      const { data: settings } = await supabase
        .from("user_settings").select("linkedin_client_id").eq("user_id", userId).maybeSingle();
      const clientId = settings?.linkedin_client_id || Deno.env.get("LINKEDIN_CLIENT_ID");
      if (!clientId) return json(400, { success: false, error: "Set your LinkedIn Client ID in Settings first." });

      // Personal-only scopes (organization scopes require LinkedIn MDP approval)
      const scopes = "openid profile w_member_social email";

      // state encodes the user id so the callback can find which user is connecting.
      // It is also persisted server-side (with a short TTL) so exchange_code can
      // verify it and reject CSRF / stale / mismatched callbacks.
      const state = `${userId}.${crypto.randomUUID()}`;
      const stateExpiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();
      const { error: stateWriteError } = await supabase.from("user_settings").upsert(
        { user_id: userId, linkedin_oauth_state: state, linkedin_oauth_state_expires_at: stateExpiresAt },
        { onConflict: "user_id" },
      );
      // If we can't persist the CSRF state (e.g. missing column/migration,
      // RLS issue, DB outage), exchange_code will *always* fail its check.
      // Fail loudly here instead of producing a confusing downstream error.
      if (stateWriteError) {
        console.error("Failed to persist OAuth state:", stateWriteError);
        return json(500, { success: false, error: "Impossible d'initialiser la connexion LinkedIn (erreur base de données). Contacte le support." });
      }
      const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}`;
      return json(200, { success: true, authUrl, state });
    }

    if (action === "exchange_code") {
      const userId = await getUserId(req, supabase);
      if (!userId) {
        return json(401, {
          success: false,
          error: "NOT_AUTHENTICATED",
          message: "Tu dois être connecté à ton compte avant de lier LinkedIn. Redirection vers la page de connexion...",
          redirectTo: "/auth",
        });
      }

      const { data: settings } = await supabase
        .from("user_settings")
        .select("linkedin_client_id, linkedin_client_secret, linkedin_oauth_state, linkedin_oauth_state_expires_at")
        .eq("user_id", userId).maybeSingle();
      const clientId = settings?.linkedin_client_id || Deno.env.get("LINKEDIN_CLIENT_ID");
      const clientSecret = settings?.linkedin_client_secret || Deno.env.get("LINKEDIN_CLIENT_SECRET");
      if (!clientId || !clientSecret) return json(400, { success: false, error: "LinkedIn app credentials not set." });

      // CSRF protection: the state returned by LinkedIn must match the one we
      // generated for this user in get_auth_url, and must not be expired/reused.
      const storedState = settings?.linkedin_oauth_state;
      const storedStateExpiresAt = settings?.linkedin_oauth_state_expires_at;
      const stateValid =
        storedState &&
        returnedState &&
        storedState === returnedState &&
        storedStateExpiresAt &&
        Date.parse(storedStateExpiresAt) > Date.now();
      // Always clear the stored state so it can't be replayed.
      await supabase.from("user_settings").update({
        linkedin_oauth_state: null,
        linkedin_oauth_state_expires_at: null,
      }).eq("user_id", userId);
      if (!stateValid) {
        return json(400, { success: false, error: "Invalid or expired OAuth state. Please retry connecting LinkedIn." });
      }

      const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code", code, redirect_uri: redirectUri,
          client_id: clientId, client_secret: clientSecret,
        }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) {
        console.error("Token exchange error:", tokenData);
        return json(400, { success: false, error: tokenData.error_description || "Token exchange failed" });
      }

      const accessToken = tokenData.access_token as string;
      const expiresAt = tokenData.expires_in
        ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
        : null;

      let personUrn = "";
      const userinfoRes = await fetch("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (userinfoRes.ok) {
        const u = await userinfoRes.json();
        if (u.sub) personUrn = `urn:li:person:${u.sub}`;
      }

      await supabase.from("user_settings").update({
        linkedin_access_token: accessToken,
        linkedin_token_expires_at: expiresAt,
        linkedin_person_urn: personUrn || null,
      }).eq("user_id", userId);

      return json(200, { success: true, personUrn, expiresIn: tokenData.expires_in });
    }

    return json(400, { success: false, error: "Invalid action" });
  } catch (error) {
    console.error("LinkedIn OAuth error:", error);
    return json(500, { success: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});
