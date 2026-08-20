import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Part } from "npm:@google/generative-ai";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import {
  assembleImagePrompt,
  assembleFallbackImagePrompt,
  normalizeVisualBrief,
  type ImageOverlayOpts,
} from "../_shared/imagePrompt.ts";
import { generateImageRouted, pickImageModel } from "../_shared/generateImage.ts";
import { mapProviderHttpError, type AiUserSettings } from "../_shared/ai-provider.ts";

/** Ratios exposed by the app → passed through to Gemini imageConfig.aspectRatio. */
const SUPPORTED_ASPECT_RATIOS = ["1:1", "16:9", "4:5", "3:4", "9:16"] as const;

function normalizeAspectRatio(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Prefer an exact token match so "4:5 portrait" still yields "4:5", never "1:1".
  const match = value.match(/\b(1:1|16:9|4:5|3:4|9:16)\b/);
  return match?.[1];
}

function isTrustedStorageUrl(value: string, supabaseUrl: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === new URL(supabaseUrl).origin &&
      url.pathname.startsWith("/storage/v1/object/public/post-assets/");
  } catch {
    return false;
  }
}

async function buildImageParts(fullPrompt: string, inputImageUrl?: string): Promise<Part[]> {
  const parts: Part[] = [{ text: fullPrompt }];
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  if (inputImageUrl && isTrustedStorageUrl(inputImageUrl, supabaseUrl)) {
    try {
      const inputResponse = await fetch(inputImageUrl);
      const mimeType = inputResponse.headers.get("content-type")?.split(";")[0] || "image/png";
      if (inputResponse.ok && mimeType.startsWith("image/")) {
        const bytes = new Uint8Array(await inputResponse.arrayBuffer());
        if (bytes.byteLength <= 7 * 1024 * 1024) {
          let binary = "";
          for (const byte of bytes) binary += String.fromCharCode(byte);
          parts.push({ inlineData: { mimeType, data: btoa(binary) } });
        }
      }
    } catch (error) {
      console.warn("Could not load the source image for Gemini editing:", error);
    }
  }
  return parts;
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const {
      prompt,
      visualBrief,
      visual_brief,
      bottomMarginPercent,
      model: requestedModel,
      inputImageUrl,
      style,
      mood,
      colors,
      aspectRatio,
      textOverlay,
      wordmark,
      language,
    } = body;

    const brief = normalizeVisualBrief(
      visualBrief ?? visual_brief,
      typeof prompt === "string" ? prompt : "",
    );
    if (!brief.visual_subject) {
      return json(400, { success: false, error: "visual_brief (or prompt) required" });
    }

    const margin = Math.min(Math.max(Number(bottomMarginPercent) || 0, 0), 25);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const auth = req.headers.get("Authorization");
    if (!auth) return json(401, { success: false, error: "Unauthorized" });
    const { data: u } = await supabase.auth.getUser(auth.replace("Bearer ", ""));
    const userId = u.user?.id;
    if (!userId) return json(401, { success: false, error: "Unauthorized" });

    const rate = await checkRateLimit(supabase, userId, "generate-image", 10);
    if (!rate.allowed) return json(429, { success: false, error: "Trop de générations d'image en peu de temps. Patiente une minute." });

    const { data: s } = await supabase.from("user_settings")
      .select("image_model, use_byok, gemini_api_key, openai_api_key")
      .eq("user_id", userId).maybeSingle();

    const settings: AiUserSettings = {
      use_byok: Boolean(s?.use_byok),
      gemini_api_key: s?.gemini_api_key ?? null,
      openai_api_key: s?.openai_api_key ?? null,
    };

    const model = pickImageModel(requestedModel, s?.image_model);
    const ratio = normalizeAspectRatio(aspectRatio);
    // Document: Gemini imageConfig supports 1:1, 4:5, 16:9, 3:4, 9:16 (among others).
    // We only pass ratios the UI exposes; unsupported tokens are dropped (not remapped).
    void SUPPORTED_ASPECT_RATIOS;

    const overlays: ImageOverlayOpts = {
      aspectRatio: ratio,
      language,
      style,
      mood,
      colors,
      textOverlay,
      wordmark,
      margin,
    };

    const fullPrompt = assembleImagePrompt(brief, overlays);

    const callModel = async (promptText: string) => {
      // inputImageUrl is always re-attached so fallback keeps image editing context.
      const parts = await buildImageParts(promptText, inputImageUrl);
      return generateImageRouted({
        settings,
        model,
        prompt: promptText,
        aspectRatio: ratio,
        parts,
        inputImageUrl,
      });
    };

    let result;
    try {
      result = await callModel(fullPrompt);
    } catch (e) {
      const mapped = mapProviderHttpError(e);
      return json(mapped.status, { success: false, error: mapped.error });
    }

    if ("status" in result && (result.status === 429 || result.status === 402 || result.status === 401)) {
      const mapped = mapProviderHttpError(new Error(result.message));
      return json(mapped.status, { success: false, error: mapped.error });
    }

    if ("status" in result) {
      console.warn("generate-image: first attempt failed, retrying with overlay-preserving fallback prompt");
      try {
        // Fallback MUST keep textOverlay, wordmark, style, mood, colors, aspect, margin, language.
        result = await callModel(assembleFallbackImagePrompt(brief, overlays));
      } catch (e) {
        const mapped = mapProviderHttpError(e);
        return json(mapped.status, { success: false, error: mapped.error });
      }
    }

    if ("status" in result) {
      const mapped = mapProviderHttpError(new Error(result.message));
      if (mapped.status === 402 || mapped.status === 401 || mapped.status === 429) {
        return json(mapped.status, { success: false, error: mapped.error });
      }
      return json(502, {
        success: false,
        error: "Gemini image generation failed. Try a different description, or continue without an image.",
      });
    }

    const base64 = result.base64;
    const mimeType = result.mimeType || "image/png";
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
    const fileName = `${userId}/${crypto.randomUUID()}.${extension}`;
    const { error: upErr } = await supabase.storage.from("post-assets").upload(fileName, bytes, { contentType: mimeType });
    if (upErr) {
      console.error("upload err", upErr.message);
      return json(200, { success: true, imageUrl: `data:${mimeType};base64,${base64}` });
    }
    const { data: pub } = supabase.storage.from("post-assets").getPublicUrl(fileName);
    return json(200, { success: true, imageUrl: pub.publicUrl });
  } catch (e) {
    console.error("generate-image error", e instanceof Error ? e.message : e);
    return json(500, { success: false, error: "Échec de la génération d'image." });
  }
});
