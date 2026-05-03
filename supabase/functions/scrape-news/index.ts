import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!apiKey) return json(500, { success: false, error: "Firecrawl connector not configured" });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const auth = req.headers.get("Authorization");
    if (!auth) return json(401, { success: false, error: "Unauthorized" });
    const { data: u } = await supabase.auth.getUser(auth.replace("Bearer ", ""));
    const userId = u.user?.id;
    if (!userId) return json(401, { success: false, error: "Unauthorized" });

    const { data: sources } = await supabase.from("content_sources")
      .select("source_type, value").eq("user_id", userId).eq("enabled", true);

    const urls = (sources || []).filter((s) => s.source_type === "url").map((s) => s.value);
    const keywords = (sources || []).filter((s) => s.source_type === "keyword").map((s) => s.value);

    const chunks: string[] = [];

    // Scrape each enabled URL (max 5 to limit cost)
    for (const url of urls.slice(0, 5)) {
      try {
        const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, waitFor: 2000 }),
        });
        const d = await r.json();
        const md = d.data?.markdown || d.markdown;
        if (md) chunks.push(`# Source: ${url}\n\n${String(md).substring(0, 3000)}`);
      } catch (e) { console.warn("scrape failed", url, e); }
    }

    // Search keywords (recent week, top 3 each)
    for (const kw of keywords.slice(0, 5)) {
      try {
        const r = await fetch("https://api.firecrawl.dev/v2/search", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query: kw, limit: 3, tbs: "qdr:w" }),
        });
        const d = await r.json();
        const results = d.data || d.web?.results || [];
        const summary = results.map((x: { title?: string; description?: string; url?: string }) =>
          `- ${x.title || ""}: ${x.description || ""} (${x.url || ""})`).join("\n");
        if (summary) chunks.push(`# Search: ${kw}\n\n${summary}`);
      } catch (e) { console.warn("search failed", kw, e); }
    }

    if (!chunks.length) {
      return json(400, { success: false, error: "No enabled sources or all scrapes failed. Add sources in Settings." });
    }

    return json(200, { success: true, markdown: chunks.join("\n\n---\n\n") });
  } catch (e) {
    console.error("scrape-news error", e);
    return json(500, { success: false, error: e instanceof Error ? e.message : "Failed" });
  }
});
