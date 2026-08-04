import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import {
  buildGuardedImagePrompt,
  buildFallbackImagePrompt,
  normalizeVisualBrief,
  type VisualBrief,
} from "../_shared/imagePrompt.ts";

// Nano Banana Pro (Gemini 3 Pro Image) is the default: best text rendering and
// composition fidelity for the LinkedIn visuals we generate.
const DEFAULT_IMAGE_MODEL = "google/gemini-3-pro-image";

const ALLOWED_MODELS = [
  "google/gemini-2.5-flash-image",
  "google/gemini-3.1-flash-image-preview",
  "google/gemini-3-pro-image-preview",
  "google/gemini-3.1-flash-image",
  "google/gemini-3-pro-image",
];

// Lovable's gateway prefixes model names with "google/"; Google's native API
// accepts the bare, current GA model ID. Keep the legacy preview aliases so
// existing user settings continue to work after the provider migration.
const DIRECT_GEMINI_MODELS: Record<string, string> = {
  "google/gemini-2.5-flash-image": "gemini-2.5-flash-image",
  "google/gemini-3.1-flash-image-preview": "gemini-3.1-flash-image",
  "google/gemini-3-pro-image-preview": "gemini-3-pro-image",
  "google/gemini-3.1-flash-image": "gemini-3.1-flash-image",
  "google/gemini-3-pro-image": "gemini-3-pro-image",
};

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
  /** Global language selector — drives the typography rendered on the canvas. */
  language?: string | null;
  /** Optional Image Studio overrides layered AFTER the guarded brief. */
  style?: string;
  mood?: string;
  colors?: string[];
  textOverlay?: { text: string; position: string; weight?: string; color?: string };
  wordmark?: { text: string; position: string };
  margin?: number;
};

/**
 * Two-layer assembly:
 * 1. visual_brief → fluent English subject (buildGuardedImagePrompt)
 * 2. immutable production rules already injected inside buildGuardedImagePrompt
 * Then optional Image Studio overlays (aspect, palette tweak, explicit text).
 */
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
      "Note: beyond the dashboard title and brief-approved labels, render ONLY the exact user-authored text/wordmark above; do not invent any other writing.",
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
      .select("image_model").eq("user_id", userId).maybeSingle();

    let model = requestedModel || s?.image_model || DEFAULT_IMAGE_MODEL;
    if (!ALLOWED_MODELS.includes(model)) model = DEFAULT_IMAGE_MODEL;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    const directGeminiModel = DIRECT_GEMINI_MODELS[model];
    if (!geminiApiKey && !LOVABLE_API_KEY) {
      return json(500, { success: false, error: "Aucune clé API de génération d'image n'est configurée." });
    }

    type ModelResult = {
      imageBase64?: string;
      imageMimeType?: string;
      imageUrl?: string;
      upstreamStatus?: number;
    };
    const callGeminiDirect = async (fullPrompt: string): Promise<ModelResult> => {
      const parts: Array<Record<string, unknown>> = [{ text: fullPrompt }];

      // Only fetch an image from this project's public Storage bucket. This
      // avoids turning the Edge Function into an SSRF proxy for arbitrary URLs.
      if (inputImageUrl && isTrustedStorageUrl(inputImageUrl, Deno.env.get("SUPABASE_URL")!)) {
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

      // imageSize is only accepted by the Pro image model; Flash models reject it.
      const imageConfig: Record<string, string> = {};
      const ratio = normalizeAspectRatio(aspectRatio);
      if (ratio) imageConfig.aspectRatio = ratio;
      if (directGeminiModel === "gemini-3-pro-image") imageConfig.imageSize = "2K";

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${directGeminiModel}:generateContent`,
        {
          method: "POST",
          headers: { "x-goog-api-key": geminiApiKey!, "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
              ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
            },
          }),
        },
      );

      if (!response.ok) {
        console.error("Gemini image error:", response.status, await response.text());
        return { upstreamStatus: response.status };
      }

      const data = await response.json();
      const imagePart = data.candidates?.[0]?.content?.parts?.find(
        (part: { inlineData?: { data?: string; mimeType?: string } }) => part.inlineData?.data,
      );
      return {
        imageBase64: imagePart?.inlineData?.data,
        imageMimeType: imagePart?.inlineData?.mimeType,
      };
    };

    const callLovableGateway = async (fullPrompt: string): Promise<ModelResult> => {
      const userContent: unknown = inputImageUrl
        ? [
            { type: "text", text: `Edit this image following these instructions: ${fullPrompt}` },
            { type: "image_url", image_url: { url: inputImageUrl } },
          ]
        : fullPrompt;

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: userContent }],
          modalities: ["image", "text"],
        }),
      });

      if (!response.ok) {
        console.error("AI image error:", response.status, await response.text());
        return { upstreamStatus: response.status };
      }
      const data = await response.json();
      const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      return { imageUrl };
    };

    // Use the project's Gemini API key whenever configured. The Lovable
    // gateway remains a compatibility fallback for environments without it.
    const callModel = geminiApiKey && directGeminiModel ? callGeminiDirect : callLovableGateway;
    const fullPrompt = assembleImagePrompt(brief, {
      aspectRatio,
      language,
      style,
      mood,
      colors,
      textOverlay,
      wordmark,
      margin,
    });
    let result = await callModel(fullPrompt);

    if (result.upstreamStatus === 429) return json(429, { success: false, error: "Rate limit exceeded." });
    if (result.upstreamStatus === 402) return json(402, { success: false, error: "Add credits to your workspace." });

    // Phase 6 fallback: if the model refused/produced nothing (likely a safety
    // filter on the styled prompt), retry once with a short, conservative,
    // guideline-only prompt before giving up.
    if (!result.imageUrl && !result.imageBase64) {
      console.warn("generate-image: first attempt blocked/empty, retrying with conservative fallback prompt");
      result = await callModel(buildFallbackImagePrompt(brief, { language }));
    }

    if (!result.imageUrl && !result.imageBase64) {
      return json(502, {
        success: false,
        error: "La génération d'image a échoué pour ce sujet. Essaie une description différente, ou continue sans image.",
      });
    }

    const dataUrlMatch = result.imageUrl?.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
    const base64 = result.imageBase64 || dataUrlMatch?.[2];
    const mimeType = result.imageMimeType || dataUrlMatch?.[1] || "image/png";
    if (!base64) {
      return json(502, { success: false, error: "Le fournisseur IA n'a pas renvoyé de fichier image valide." });
    }
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
    const fileName = `${userId}/${crypto.randomUUID()}.${extension}`;
    const { error: upErr } = await supabase.storage.from("post-assets").upload(fileName, bytes, { contentType: mimeType });
    if (upErr) {
      console.error("upload err", upErr);
      return json(200, { success: true, imageUrl: result.imageUrl || `data:${mimeType};base64,${base64}` });
    }
    const { data: pub } = supabase.storage.from("post-assets").getPublicUrl(fileName);
    return json(200, { success: true, imageUrl: pub.publicUrl });
  } catch (e) {
    console.error("generate-image error", e);
    return json(500, { success: false, error: "Échec de la génération d'image." });
  }
});
