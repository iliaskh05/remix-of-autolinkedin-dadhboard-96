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
        model: "google/gemini-3.1-flash-image-preview",
        messages: [
          {
            role: "user",
            content: `Create a sophisticated, editorial-style SQUARE 1:1 image for a LinkedIn commodity market post. Subject: ${prompt}.

Strict art direction:
- Format: STRICT square 1:1 aspect ratio. Reserve a clean empty band of approximately ${margin}% of the image height at the BOTTOM, free of any illustration, graphic or noise — this band is exclusively for the wordmark.
- Wordmark: place ONLY the text "CommoHedge" perfectly horizontally centered inside that bottom band, with equal left/right margins. Use a clean modern sans-serif (Inter / Helvetica / Söhne style), medium weight, small-to-medium size, fully legible, in #A8E81C on black (or white if background in that band is black). No tagline, no other text, no watermark, no hashtags. The wordmark must NEVER be cropped, tilted, distorted or overlapped by any visual element.
- Strict two-color palette: deep matte black (#000000) dominant, vivid lime green (#A8E81C) as the single accent. White only if strictly necessary.
- Style: refined editorial / financial magazine aesthetic (Bloomberg Businessweek, Monocle, The Economist). Human senior art director feel — NOT generic AI art, no glossy 3D, no stock photo, no neon cyberpunk, no gradient soup.
- Composition: bold negative space, strong geometric structure, single clear focal point in the upper ~${100 - margin}% of the canvas.
- Avoid: cartoonish elements, emojis, melting shapes, lens flares, surreal AI artefacts, low-quality typography.`
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
