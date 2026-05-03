import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prompt, bottomMarginPercent, model } = await req.json();
    if (!prompt) {
      return new Response(
        JSON.stringify({ success: false, error: "prompt is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const margin = Math.min(Math.max(Number(bottomMarginPercent) || 14, 8), 25);
    const ALLOWED_MODELS = [
      "google/gemini-2.5-flash-image",
      "google/gemini-3.1-flash-image-preview",
      "google/gemini-3-pro-image-preview",
    ];
    const selectedModel = ALLOWED_MODELS.includes(model)
      ? model
      : "google/gemini-3.1-flash-image-preview";

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: "LOVABLE_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Generating image for post...");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          {
            role: "user",
            content: `A professional corporate infographic poster for a LinkedIn commodity market post. Subject: ${prompt}.

Adapt the visual scene, the map focus, the icons and the data blocks to the subject above. Infer automatically:
- the most relevant cinematic background scene tied to the subject (e.g. oil tanker at sea for energy/oil, wheat fields or grain silos for agri, copper mine or smelter for metals, container port for shipping, drought landscape for soft commodities, refinery for gas, etc.)
- the geographic focus of the world map (highlight the relevant region/country/strait/route with a clean red marker, X, circle or arrow)
- the 3 to 5 most relevant impacted commodities or sub-sectors to feature as data blocks
- a short, bold, editorial-style MAIN TITLE in English, all caps, that captures the structural angle of the subject (max 12 words, no quotes)
- a SUBTITLE with the relevant time window (month + year, current period if unknown)

Strict art direction:
- Format: STRICT SQUARE 1:1 aspect ratio. Reserve a clean empty band of approximately ${margin}% of the image height at the BOTTOM, free of any illustration, chart, icon or text — this band is exclusively for the wordmark.
- Wordmark: place ONLY the text "CommoHedge" perfectly horizontally centered inside that bottom band, equal left/right margins, clean modern sans-serif (Inter / Helvetica / Söhne), medium weight, small-to-medium size, fully legible, in gold/amber (#D4AF37) or vivid lime (#A8E81C) on dark. No tagline, no watermark, no hashtags, no other text in that band. Never cropped, tilted or overlapped.
- Layout: modern financial infographic (Bloomberg / Financial Times / McKinsey report style), clean grid, dark theme (deep navy #0A1628, matte black #000000, gold accents #D4AF37, optional vivid lime #A8E81C as secondary accent).
- Composition (top ~${100 - margin}% of the canvas): cinematic photographic background scene tied to the subject with realistic lighting and dramatic sky; a small world map block in one of the top corners highlighting the relevant region; a bold MAIN TITLE and a SUBTITLE clearly placed; 3 to 5 small data blocks with sharp monoline icons, short labels, percentages or arrows, and one or two minimal line/bar charts. Strong hierarchy, generous negative space, sharp grid alignment.
- Typography: ultra-clean modern sans-serif throughout, perfectly legible, no spelling mistakes, minimal text but data-rich.
- Style: high-end consulting / financial magazine. Realistic, premium, balanced. Human senior art director feel — NOT generic AI art.
- Avoid: cartoonish elements, emojis, melting shapes, lens flares, surreal AI artefacts, glossy 3D, stock photo look, neon cyberpunk, gradient soup, low-quality or garbled typography, duplicated logos, any text inside the bottom wordmark band other than "CommoHedge".`
          }
        ],
        modalities: ["image", "text"]
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ success: false, error: "Rate limit exceeded, try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: "Payment required. Please add funds." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("AI image error:", response.status, text);
      return new Response(
        JSON.stringify({ success: false, error: "Image generation failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!imageUrl) {
      console.error("No image in response");
      return new Response(
        JSON.stringify({ success: false, error: "No image generated" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Upload base64 image to storage
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, "");
    const imageBytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
    const fileName = `post-images/${crypto.randomUUID()}.png`;

    const { error: uploadError } = await supabase.storage
      .from("post-assets")
      .upload(fileName, imageBytes, { contentType: "image/png" });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      // Return base64 as fallback
      return new Response(
        JSON.stringify({ success: true, imageUrl }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: publicUrl } = supabase.storage.from("post-assets").getPublicUrl(fileName);

    console.log("Image generated and uploaded:", publicUrl.publicUrl);
    return new Response(
      JSON.stringify({ success: true, imageUrl: publicUrl.publicUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error generating image:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Failed to generate image" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
