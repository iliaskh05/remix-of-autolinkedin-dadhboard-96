// On-demand LinkedIn text generator with free-form prompt + optional image context
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { prompt, currentText, imageUrl, mode } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const auth = req.headers.get("Authorization");
    if (!auth) return json(401, { success: false, error: "Unauthorized" });
    const { data: u } = await supabase.auth.getUser(auth.replace("Bearer ", ""));
    const userId = u.user?.id;
    if (!userId) return json(401, { success: false, error: "Unauthorized" });

    const { data: s } = await supabase.from("user_settings")
      .select("post_model, use_byok, openai_api_key, tone_instructions")
      .eq("user_id", userId).maybeSingle();

    let model = s?.post_model || "google/gemini-3-flash-preview";
    let url = "https://ai.gateway.lovable.dev/v1/chat/completions";
    let key = Deno.env.get("LOVABLE_API_KEY");
    if (s?.use_byok && model.startsWith("openai/") && s.openai_api_key) {
      url = "https://api.openai.com/v1/chat/completions";
      key = s.openai_api_key;
      model = model.replace("openai/", "");
    }
    if (!key) return json(500, { success: false, error: "No API key" });

    const sys = `You write engaging LinkedIn posts in the user's voice.
Rules: 150-300 words, 5-7 hashtags, sparing emojis, end with a CTA/question.
${s?.tone_instructions ? `User tone:\n${s.tone_instructions}` : ""}
Return JSON via the write_post tool.`;

    let userMsg: any;
    if (mode === "improve" && currentText) {
      userMsg = `Rewrite and polish this draft into a great LinkedIn post:\n\n${currentText}\n\n${prompt ? `Extra instructions: ${prompt}` : ""}`;
    } else if (imageUrl) {
      userMsg = [
        { type: "text", text: `Write a LinkedIn post about this image. ${prompt || ""}` },
        { type: "image_url", image_url: { url: imageUrl } },
      ];
    } else {
      userMsg = prompt || "Write a thought-provoking LinkedIn post on a topic relevant to my industry.";
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }],
        tools: [{
          type: "function",
          function: {
            name: "write_post",
            description: "Write a LinkedIn post",
            parameters: {
              type: "object",
              properties: {
                title: { type: "string", description: "Short internal title (≤80 chars)" },
                content: { type: "string", description: "Full post body with hashtags" },
              },
              required: ["title", "content"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "write_post" } },
      }),
    });
    if (!res.ok) {
      if (res.status === 429) return json(429, { success: false, error: "Rate limit exceeded." });
      if (res.status === 402) return json(402, { success: false, error: "Add credits to your workspace." });
      const t = await res.text();
      return json(500, { success: false, error: `AI error [${res.status}]: ${t}` });
    }
    const data = await res.json();
    const tc = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!tc) return json(500, { success: false, error: "AI returned no structured data" });
    const out = JSON.parse(tc.function.arguments);
    return json(200, { success: true, ...out });
  } catch (e) {
    console.error("compose-text error", e);
    return json(500, { success: false, error: e instanceof Error ? e.message : "Failed" });
  }
});
