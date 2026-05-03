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
    const { prompt, bottomMarginPercent } = await req.json();
    if (!prompt) {
      return new Response(
        JSON.stringify({ success: false, error: "prompt is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const margin = Math.min(Math.max(Number(bottomMarginPercent) || 14, 8), 25);

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
            content: `Create a sophisticated, editorial-style image for a LinkedIn commodity market post. Subject: ${prompt}.

Strict art direction:
- Strict two-color palette: deep matte black (#000000) as dominant background, and vivid lime green (#A8E81C) as the single accent color. White (#FFFFFF) only for minimal typography if needed.
- Style: refined editorial / financial magazine aesthetic (think Bloomberg Businessweek, Monocle, The Economist covers). Clean, minimalist, human-designed by a senior art director — NOT generic AI art, no glossy 3D renders, no stock-photo look, no gradients soup, no cyberpunk neon.
- Composition: bold negative space, strong geometric structure, single clear focal point, intentional asymmetry. Flat vector illustration, subtle grain/print texture, or high-contrast minimalist photography are all acceptable.
- Typography in image: ONLY the wordmark "CommoHedge" placed at the bottom of the image, in a clean modern sans-serif (similar to Inter / Helvetica / Söhne), small, in #A8E81C or white, well-aligned with generous margin. No other text, no captions, no watermarks, no hashtags.
- Avoid: cartoonish elements, emojis, melting/warped shapes, low-quality typography, lens flares, AI-typical surreal details.
- Format: square 1:1, sharp, print-quality, professional.`
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
