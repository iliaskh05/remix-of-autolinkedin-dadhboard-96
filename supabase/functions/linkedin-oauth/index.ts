import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function getUserId(req: Request, supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const token = auth.replace("Bearer ", "");
  const { data } = await supabase.auth.getUser(token);
  return data.user?.id ?? null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { action, code, redirectUri } = await req.json();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    if (action === "get_auth_url") {
      const userId = await getUserId(req, supabase);
      if (!userId) {
        return json(401, {
          success: false,
          error: "NOT_AUTHENTICATED",
          message: "Tu dois être connecté à ton compte CommoHedge avant de lier LinkedIn. Redirection vers la page de connexion...",
          redirectTo: "/auth",
        });
      }

      const { data: settings } = await supabase
        .from("user_settings").select("linkedin_client_id").eq("user_id", userId).maybeSingle();
      const clientId = settings?.linkedin_client_id || Deno.env.get("LINKEDIN_CLIENT_ID");
      if (!clientId) return json(400, { success: false, error: "Set your LinkedIn Client ID in Settings first." });

      // Personal-only scopes (organization scopes require LinkedIn MDP approval)
      const scopes = "openid profile w_member_social email";

      // state encodes the user id so the callback can find which user is connecting
      const state = `${userId}.${crypto.randomUUID()}`;
      const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}`;
      return json(200, { success: true, authUrl, state });
    }

    if (action === "exchange_code") {
      const userId = await getUserId(req, supabase);
      if (!userId) {
        return json(401, {
          success: false,
          error: "NOT_AUTHENTICATED",
          message: "Tu dois être connecté à ton compte CommoHedge avant de lier LinkedIn. Redirection vers la page de connexion...",
          redirectTo: "/auth",
        });
      }

      const { data: settings } = await supabase
        .from("user_settings").select("linkedin_client_id, linkedin_client_secret").eq("user_id", userId).maybeSingle();
      const clientId = settings?.linkedin_client_id || Deno.env.get("LINKEDIN_CLIENT_ID");
      const clientSecret = settings?.linkedin_client_secret || Deno.env.get("LINKEDIN_CLIENT_SECRET");
      if (!clientId || !clientSecret) return json(400, { success: false, error: "LinkedIn app credentials not set." });



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
