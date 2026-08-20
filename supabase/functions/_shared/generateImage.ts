/**
 * Unified image generation entry — routes via resolveProvider.
 * Gemini BYOK never touches Lovable.
 */
import type { Part } from "npm:@google/generative-ai";
import type { AiUserSettings } from "./ai-provider.ts";
import { resolveProvider, ALLOWED_IMAGE_MODELS } from "./ai-provider.ts";
import { generateImageWithGemini, type GeminiImageResult, type GeminiUpstreamError } from "./gemini.ts";
import { generateImageWithLovable } from "./lovable.ts";

export type ImageGenResult = GeminiImageResult | GeminiUpstreamError;

export function pickImageModel(requested: string | null | undefined, settingsModel: string | null | undefined): string {
  const DEFAULT = "google/gemini-3-pro-image";
  let model = requested || settingsModel || DEFAULT;
  if (!ALLOWED_IMAGE_MODELS.includes(model)) model = DEFAULT;
  return model;
}

export async function generateImageRouted(opts: {
  settings: AiUserSettings;
  model: string;
  prompt: string;
  aspectRatio?: string;
  parts?: Part[];
  inputImageUrl?: string;
}): Promise<ImageGenResult> {
  const route = resolveProvider(opts.settings, opts.model, "image");

  if (route.execution === "gemini_direct") {
    return generateImageWithGemini({
      apiKey: route.apiKey,
      model: opts.model,
      prompt: opts.prompt,
      aspectRatio: opts.aspectRatio,
      parts: opts.parts,
    });
  }

  // Lovable gateway (BYOK off)
  return generateImageWithLovable({
    apiKey: route.apiKey,
    model: route.normalizedModel,
    prompt: opts.prompt,
    inputImageUrl: opts.inputImageUrl,
  });
}
