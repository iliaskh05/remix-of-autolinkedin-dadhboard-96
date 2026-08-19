// Official Gemini SDK wrapper for Supabase Edge Functions (Deno).
// Replaces the Lovable AI gateway when GEMINI_API_KEY is configured.
import {
  GoogleGenerativeAI,
  FunctionCallingMode,
  type FunctionDeclaration,
  type Part,
} from "npm:@google/generative-ai";
import { WRITE_POST_TOOL, parseWritePostToolCall, type WritePostResult } from "./textPrompt.ts";

/** Strip JSON-schema fields Gemini function calling rejects. */
function sanitizeSchema(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (key === "additionalProperties" || key === "strict") continue;
    out[key] = sanitizeSchema(val);
  }
  return out;
}

const WRITE_POST_DECLARATION: FunctionDeclaration = {
  name: WRITE_POST_TOOL.function.name,
  description: WRITE_POST_TOOL.function.description,
  parameters: sanitizeSchema(WRITE_POST_TOOL.function.parameters) as FunctionDeclaration["parameters"],
};

const TEXT_MODEL_ALIASES: Record<string, string> = {
  "google/gemini-3-flash-preview": "gemini-2.5-flash",
  "google/gemini-3.1-pro-preview": "gemini-2.5-pro",
  "google/gemini-2.5-pro": "gemini-2.5-pro",
  "google/gemini-2.5-flash": "gemini-2.5-flash",
  "google/gemini-2.5-flash-lite": "gemini-2.5-flash-lite",
};

export const IMAGE_MODEL_ALIASES: Record<string, string> = {
  "google/gemini-2.5-flash-image": "gemini-2.5-flash-image",
  "google/gemini-3.1-flash-image-preview": "gemini-3.1-flash-image",
  "google/gemini-3-pro-image-preview": "gemini-3-pro-image",
  "google/gemini-3.1-flash-image": "gemini-3.1-flash-image",
  "google/gemini-3-pro-image": "gemini-3-pro-image",
};

export function getGeminiApiKey(): string {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY not configured");
  return key;
}

export function getGeminiClient(): GoogleGenerativeAI {
  return new GoogleGenerativeAI(getGeminiApiKey());
}

/** Maps a settings model id (google/…) to a bare Gemini API model name. */
export function resolveGeminiTextModel(modelId: string): string {
  if (modelId.startsWith("openai/")) {
    // No Lovable credits / no OpenAI BYOK — fall back to a fast Gemini model.
    return "gemini-2.5-flash";
  }
  if (TEXT_MODEL_ALIASES[modelId]) return TEXT_MODEL_ALIASES[modelId];
  if (modelId.startsWith("google/")) return modelId.replace(/^google\//, "");
  return modelId || "gemini-2.5-flash";
}

export function resolveGeminiImageModel(modelId: string): string {
  return IMAGE_MODEL_ALIASES[modelId] ?? (modelId.replace(/^google\//, "") || "gemini-3-pro-image");
}

export type GeminiUpstreamError = {
  status: number;
  message: string;
};

export async function generateWritePostWithGemini(opts: {
  systemPrompt: string;
  userPrompt: string;
  model: string;
}): Promise<WritePostResult> {
  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({
    model: resolveGeminiTextModel(opts.model),
    systemInstruction: opts.systemPrompt,
    tools: [{ functionDeclarations: [WRITE_POST_DECLARATION] }],
    toolConfig: {
      functionCallingConfig: {
        mode: FunctionCallingMode.ANY,
        allowedFunctionNames: ["write_post"],
      },
    },
  });

  const response = await model.generateContent(opts.userPrompt);
  const call = response.response.functionCalls()?.[0];
  if (!call?.name || call.name !== "write_post") {
    throw new Error("AI returned no structured data");
  }
  return parseWritePostToolCall(JSON.stringify(call.args ?? {}));
}

export type GeminiImageResult = {
  base64: string;
  mimeType: string;
};

export async function generateImageWithGemini(opts: {
  prompt: string;
  model: string;
  aspectRatio?: string;
  parts?: Part[];
}): Promise<GeminiImageResult | GeminiUpstreamError> {
  const genAI = getGeminiClient();
  const bareModel = resolveGeminiImageModel(opts.model);

  const imageConfig: Record<string, string> = {};
  if (opts.aspectRatio) imageConfig.aspectRatio = opts.aspectRatio;
  if (bareModel === "gemini-3-pro-image") imageConfig.imageSize = "2K";

  const model = genAI.getGenerativeModel({
    model: bareModel,
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
    },
  });

  const parts: Part[] = opts.parts?.length
    ? opts.parts
    : [{ text: opts.prompt }];

  try {
    const response = await model.generateContent({ contents: [{ role: "user", parts }] });
    const candidates = response.response.candidates ?? [];
    const contentParts = candidates[0]?.content?.parts ?? [];
    const imagePart = contentParts.find(
      (part) => "inlineData" in part && part.inlineData?.data,
    );
    const base64 = imagePart?.inlineData?.data;
    if (!base64) {
      return { status: 502, message: "Gemini returned no image data" };
    }
    return {
      base64,
      mimeType: imagePart?.inlineData?.mimeType || "image/png",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/429|quota|rate/i.test(message)) return { status: 429, message };
    console.error("Gemini image SDK error:", message);
    return { status: 502, message };
  }
}
