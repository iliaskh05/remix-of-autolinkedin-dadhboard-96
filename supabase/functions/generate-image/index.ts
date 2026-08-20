import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Part } from "npm:@google/generative-ai";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import {
  buildGuardedImagePrompt,
  buildFallbackImagePrompt,
  normalizeVisualBrief,
  type VisualBrief,
} from "../_shared/imagePrompt.ts";
import { generateImageRouted, pickImageModel } from "../_shared/generateImage.ts";
import { mapProviderHttpError, type AiUserSettings } from "../_shared/ai-provider.ts";

const POSITION_LABELS: Record<string, string> = {
  "top-left": "top-left corner",
  "top-center": "top center",
  "top-right": "top-right corner",
  "center-left": "middle-left",
  "center": "exact center",
  "center-right": "middle-right",
  "bottom-left": "bottom-left corner",
  "bottom-center": "bottom center",
  "bottom-right": "bottom-right corner",
};

type OverlayOpts = {
  aspectRatio?: string;
  language?: string | null;
  style?: string;
  mood?: string;
  colors?: string[];
  textOverlay?: { text: string; position: string; weight?: string; color?: string };
  wordmark?: { text: string; position: string };
  margin?: number;
};

function assembleImagePrompt(brief: VisualBrief, overlays: OverlayOpts): string {
  const parts: string[] = [buildGuardedImagePrompt(brief, { language: overlays.language })];

  if (overlays.aspectRatio) parts.push(`Aspect ratio: ${overlays.aspectRatio}.`);
  if (overlays.style) parts.push(`Additional visual style preference: ${overlays.style}.`);
  if (overlays.mood) parts.push(`Additional mood preference: ${overlays.mood}.`);
  if (overlays.colors?.length) {
    parts.push(`Prefer these dominant brand colors when compatible with the brief palette: ${overlays.colors.join(", ")}.`);
  }

  const wantsText = Boolean(overlays.textOverlay?.text || overlays.wordmark?.text);
  if (overlays.textOverlay?.text) {
    const pos = POSITION_LABELS[overlays.textOverlay.position] || "center";
    const weight = overlays.textOverlay.weight || "bold";
    const color = overlays.textOverlay.color ? ` in ${overlays.textOverlay.color}` : "";
    parts.push(
      `EXCEPTION — render this exact user-authored text only (no extra words, no typos): "${overlays.textOverlay.text}". ` +
      `Place it at the ${pos}. Use a ${weight} sans-serif typography${color}, high contrast.`,
    );
  }
  if (overlays.wordmark?.text) {
    const pos = POSITION_LABELS[overlays.wordmark.position] || "bottom-center";
    parts.push(`EXCEPTION — add a small wordmark "${overlays.wordmark.text}" at the ${pos}, discreet but readable.`);
  }
  if (overlays.margin && overlays.margin > 0) {
    parts.push(`Keep a clean empty band of approximately ${overlays.margin}% of the image height free of any subject element at the bottom.`);
  }

  if (wantsText) {
    parts.push(
      "Note: beyond the infographic title and brief-approved labels, render ONLY the exact user-authored text/wordmark above; do not invent any other writing.",
    );
  }

  return parts.join(" ");
}

function normalizeAspectRatio(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.match(/\b(?:1:1|16:9|4:5|3:4|9:16)\b/)?.[0];
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
    const fullPrompt = assembleImagePrompt(brief, {
      aspectRatio: ratio,
      language,
      style,
      mood,
      colors,
      textOverlay,
      wordmark,
      margin,
    });

    const callModel = async (promptText: string) => {
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
      console.warn("generate-image: first attempt failed, retrying with conservative fallback prompt");
      try {
        result = await callModel(buildFallbackImagePrompt(brief, { language }));
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
