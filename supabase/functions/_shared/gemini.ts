// Official Gemini SDK wrapper for Supabase Edge Functions (Deno).
// Callers must pass an apiKey resolved via ai-provider (BYOK / never Lovable here).
import {
  GoogleGenerativeAI,
  FunctionCallingMode,
  type FunctionDeclaration,
  type Part,
} from "npm:@google/generative-ai";
import { WRITE_POST_TOOL, parseWritePostToolCall, type WritePostResult } from "./textPrompt.ts";
import { normalizeGeminiTextModel, normalizeGeminiImageModel } from "./ai-provider.ts";

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

export function getGeminiClient(apiKey: string): GoogleGenerativeAI {
  if (!apiKey?.trim()) throw new Error("Google Gemini API key is not configured.");
  return new GoogleGenerativeAI(apiKey.trim());
}

export type GeminiUpstreamError = {
  status: number;
  message: string;
};

export async function generateWritePostWithGemini(opts: {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  apiKey: string;
}): Promise<WritePostResult> {
  const genAI = getGeminiClient(opts.apiKey);
  const model = genAI.getGenerativeModel({
    model: normalizeGeminiTextModel(opts.model),
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
  apiKey: string;
}): Promise<GeminiImageResult | GeminiUpstreamError> {
  const genAI = getGeminiClient(opts.apiKey);
  const bareModel = normalizeGeminiImageModel(opts.model);

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
    if (/API_KEY|invalid.*key/i.test(message)) return { status: 401, message };
    console.error("Gemini image SDK error:", message.replace(/AIza[0-9A-Za-z_-]{10,}/g, "AIza***"));
    return { status: 502, message };
  }
}
