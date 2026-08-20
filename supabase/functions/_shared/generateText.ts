/**
 * Unified text generation entry — routes via resolveProvider.
 */
import type { AiUserSettings } from "./ai-provider.ts";
import { resolveProvider, mapProviderHttpError } from "./ai-provider.ts";
import { generateWritePostWithGemini } from "./gemini.ts";
import { generateWritePostWithLovable } from "./lovable.ts";
import { generateWritePostWithOpenAI } from "./openai.ts";
import type { WritePostResult } from "./textPrompt.ts";

export async function generateWritePost(opts: {
  settings: AiUserSettings;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<WritePostResult> {
  const route = resolveProvider(opts.settings, opts.model, "text");

  if (route.execution === "openai_direct") {
    return generateWritePostWithOpenAI({
      apiKey: route.apiKey,
      model: route.normalizedModel,
      systemPrompt: opts.systemPrompt,
      userPrompt: opts.userPrompt,
    });
  }

  if (route.execution === "gemini_direct") {
    return generateWritePostWithGemini({
      apiKey: route.apiKey,
      model: route.requestedModel,
      systemPrompt: opts.systemPrompt,
      userPrompt: opts.userPrompt,
    });
  }

  return generateWritePostWithLovable({
    apiKey: route.apiKey,
    model: route.normalizedModel,
    systemPrompt: opts.systemPrompt,
    userPrompt: opts.userPrompt,
  });
}

export { mapProviderHttpError };
