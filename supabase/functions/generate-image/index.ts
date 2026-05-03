import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ALLOWED_MODELS = [
  "google/gemini-2.5-flash-image",
  "google/gemini-3.1-flash-image-preview",
  "google/gemini-3-pro-image-preview",
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { prompt, bottomMarginPercent, model: requestedModel } = await req.json();
    if (!prompt) return json(400, { success: false, error: "prompt required" });
    const margin = Math.min(Math.max(Number(bottomMarginPercent) || 14, 0), 25);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const auth = req.headers.get("Authorization");
    if (!auth) return json(401, { success: false, error: "Unauthorized" });
    const { data: u } = await supabase.auth.getUser(auth.replace("Bearer ", ""));
    const userId = u.user?.id;
    if (!userId) return json(401, { success: false, error: "Unauthorized" });

    const { data: s } = await supabase.from("user_settings")
      .select("image_model").eq("user_id", userId).maybeSingle();

    let model = requestedModel || s?.image_model || "google/gemini-3.1-flash-image-preview";
    if (!ALLOWED_MODELS.includes(model)) model = "google/gemini-3.1-flash-image-preview";

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json(500, { success: false, error: "LOVABLE_API_KEY not configured" });

    const marginInstruction = margin > 0
      ? `Reserve a clean empty bottom band of ~${margin}% of the image height free of any text, illustration or chart.`
      : "Use the full canvas.";

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{
          role: "user",
          content: `Create a professional LinkedIn post image. Subject: ${prompt}.

Style: modern editorial, clean composition, premium feel, strong typography hierarchy if any text is included.
${marginInstruction}
Avoid: cartoonish elements, melting shapes, lens flares, surreal AI artefacts, garbled text.`
        }],
        modalities: ["image", "text"],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) return json(429, { success: false, error: "Rate limit exceeded." });
      if (response.status === 402) return json(402, { success: false, error: "Add credits to your workspace." });
      const t = await response.text();
      console.error("AI image error:", response.status, t);
      return json(500, { success: false, error: "Image generation failed" });
    }

    const data = await response.json();
    const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!imageUrl) return json(500, { success: false, error: "No image generated" });

    const base64 = imageUrl.replace(/^data:image\/\w+;base64,/, "");
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const fileName = `${userId}/${crypto.randomUUID()}.png`;
    const { error: upErr } = await supabase.storage.from("post-assets").upload(fileName, bytes, { contentType: "image/png" });
    if (upErr) {
      console.error("upload err", upErr);
      return json(200, { success: true, imageUrl });
    }
    const { data: pub } = supabase.storage.from("post-assets").getPublicUrl(fileName);
    return json(200, { success: true, imageUrl: pub.publicUrl });
  } catch (e) {
    console.error("generate-image error", e);
    return json(500, { success: false, error: e instanceof Error ? e.message : "Failed" });
  }
});
