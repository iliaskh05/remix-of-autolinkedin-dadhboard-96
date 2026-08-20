/**
 * Server-side AI provider resolver for Supabase Edge Functions (Deno).
 * Mirrors src/lib/ai-provider.ts — keep routing rules identical.
 */
export type ModelOwner = "google" | "openai";
export type Capability = "text" | "image";
export type ExecutionProvider = "gemini_direct" | "openai_direct" | "lovable_gateway";

export type AiUserSettings = {
  use_byok: boolean;
  gemini_api_key?: string | null;
  openai_api_key?: string | null;
  post_model?: string | null;
  image_model?: string | null;
};

export type EnvAiKeys = {
  lovableApiKey?: string | null;
  geminiApiKey?: string | null;
};

export type ResolvedProvider = {
  owner: ModelOwner;
  execution: ExecutionProvider;
  isByok: boolean;
  normalizedModel: string;
  requestedModel: string;
  capability: Capability;
  label: string;
  apiKey: string;
};

export type ResolveErrorCode =
  | "BYOK_MISSING_GEMINI_KEY"
  | "BYOK_MISSING_OPENAI_KEY"
  | "LOVABLE_NOT_CONFIGURED"
  | "UNSUPPORTED_MODEL";

export class ProviderResolveError extends Error {
  code: ResolveErrorCode;
  status: number;
  constructor(code: ResolveErrorCode, message: string, status = 400) {
    super(message);
    this.name = "ProviderResolveError";
    this.code = code;
    this.status = status;
  }
}

export const GEMINI_TEXT_ALIASES: Record<string, string> = {
  "google/gemini-3-flash-preview": "gemini-2.5-flash",
  "google/gemini-3.1-pro-preview": "gemini-2.5-pro",
  "google/gemini-2.5-pro": "gemini-2.5-pro",
  "google/gemini-2.5-flash": "gemini-2.5-flash",
  "google/gemini-2.5-flash-lite": "gemini-2.5-flash-lite",
};

export const GEMINI_IMAGE_ALIASES: Record<string, string> = {
  "google/gemini-2.5-flash-image": "gemini-2.5-flash-image",
  "google/gemini-3-pro-image": "gemini-3-pro-image",
  "google/gemini-3.1-flash-image": "gemini-3.1-flash-image",
  // Legacy preview ids → same GA model (not a different family)
  "google/gemini-2.5-flash-image-preview": "gemini-2.5-flash-image",
  "google/gemini-3-pro-image-preview": "gemini-3-pro-image",
  "google/gemini-3.1-flash-image-preview": "gemini-3.1-flash-image",
};

export const ALLOWED_IMAGE_MODELS = [
  "google/gemini-2.5-flash-image",
  "google/gemini-3-pro-image",
  "google/gemini-3.1-flash-image",
  // Accept legacy stored values
  "google/gemini-2.5-flash-image-preview",
  "google/gemini-3-pro-image-preview",
  "google/gemini-3.1-flash-image-preview",
];

export const DEFAULT_IMAGE_MODEL_ID = "google/gemini-2.5-flash-image";

/** Strip only the known `google/` provider prefix. */
export function normalizeGoogleModel(modelId: string): string {
  if (modelId.startsWith("google/")) return modelId.slice("google/".length);
  return modelId;
}

export function detectModelOwner(modelId: string): ModelOwner {
  if (modelId.startsWith("openai/")) return "openai";
  return "google";
}

export function normalizeGeminiTextModel(modelId: string): string {
  if (GEMINI_TEXT_ALIASES[modelId]) return GEMINI_TEXT_ALIASES[modelId];
  if (modelId.startsWith("google/")) return normalizeGoogleModel(modelId);
  if (modelId.startsWith("openai/")) return "gemini-2.5-flash";
  return modelId || "gemini-2.5-flash";
}

export function normalizeGeminiImageModel(modelId: string): string {
  if (GEMINI_IMAGE_ALIASES[modelId]) return GEMINI_IMAGE_ALIASES[modelId];
  const bare = normalizeGoogleModel(modelId);
  const knownBare = new Set(Object.values(GEMINI_IMAGE_ALIASES));
  if (knownBare.has(bare)) return bare;
  return bare;
}

export function normalizeOpenAiModel(modelId: string): string {
  return modelId.replace(/^openai\//, "");
}

export function readEnvAiKeys(): EnvAiKeys {
  return {
    lovableApiKey: Deno.env.get("LOVABLE_API_KEY"),
    geminiApiKey: Deno.env.get("GEMINI_API_KEY"),
  };
}

function resolveRoute(
  settings: AiUserSettings,
  modelId: string,
  capability: Capability,
): Omit<ResolvedProvider, "apiKey"> {
  const requestedModel = modelId ||
    (capability === "image" ? DEFAULT_IMAGE_MODEL_ID : "google/gemini-2.5-flash");
  const owner = detectModelOwner(requestedModel);

  if (capability === "image" && owner === "openai") {
    throw new ProviderResolveError(
      "UNSUPPORTED_MODEL",
      "OpenAI image models are not supported. Choose a Gemini image model.",
      400,
    );
  }

  if (settings.use_byok) {
    if (owner === "openai") {
      return {
        owner,
        execution: "openai_direct",
        isByok: true,
        normalizedModel: normalizeOpenAiModel(requestedModel),
        requestedModel,
        capability,
        label: "OpenAI — BYOK direct",
      };
    }
    return {
      owner: "google",
      execution: "gemini_direct",
      isByok: true,
      normalizedModel: capability === "image"
        ? normalizeGeminiImageModel(requestedModel)
        : normalizeGeminiTextModel(requestedModel),
      requestedModel,
      capability,
      label: "Google Gemini — BYOK direct",
    };
  }

  return {
    owner,
    execution: "lovable_gateway",
    isByok: false,
    normalizedModel: requestedModel,
    requestedModel,
    capability,
    label: "Lovable Gateway",
  };
}

function attachKey(
  resolved: Omit<ResolvedProvider, "apiKey">,
  settings: AiUserSettings,
  env: EnvAiKeys,
): ResolvedProvider {
  if (resolved.execution === "openai_direct") {
    const key = settings.openai_api_key?.trim();
    if (!key) {
      throw new ProviderResolveError(
        "BYOK_MISSING_OPENAI_KEY",
        "BYOK is enabled but the OpenAI API key is missing. Add it in Settings.",
        400,
      );
    }
    return { ...resolved, apiKey: key };
  }

  if (resolved.execution === "gemini_direct") {
    // Prefer user BYOK key; workspace GEMINI_API_KEY is an optional direct-Google fallback.
    // Never fall through to Lovable while BYOK is on.
    const key = settings.gemini_api_key?.trim() || env.geminiApiKey?.trim() || "";
    if (!key) {
      throw new ProviderResolveError(
        "BYOK_MISSING_GEMINI_KEY",
        "BYOK is enabled but the Google Gemini API key is missing. Add it in Settings → BYOK.",
        400,
      );
    }
    return { ...resolved, apiKey: key };
  }

  const key = env.lovableApiKey?.trim();
  if (!key) {
    throw new ProviderResolveError(
      "LOVABLE_NOT_CONFIGURED",
      "Lovable AI Gateway is not configured (LOVABLE_API_KEY). Enable BYOK with a Gemini key, or set the Lovable secret.",
      500,
    );
  }
  return { ...resolved, apiKey: key };
}

/** Primary entry: resolve execution path + API key for a model/capability. */
export function resolveProvider(
  settings: AiUserSettings,
  modelId: string,
  capability: Capability,
  env: EnvAiKeys = readEnvAiKeys(),
): ResolvedProvider {
  return attachKey(resolveRoute(settings, modelId, capability), settings, env);
}

/** Map resolve / upstream errors to safe HTTP payloads (never include API keys). */
export function mapProviderHttpError(err: unknown): { status: number; error: string } {
  if (err instanceof ProviderResolveError) {
    return { status: err.status, error: err.message };
  }
  const msg = err instanceof Error ? err.message : String(err);
  // Scrub anything that looks like a key fragment before matching.
  if (/429|quota|rate|RESOURCE_EXHAUSTED/i.test(msg)) {
    return {
      status: 429,
      error: "Provider rate limit / quota exceeded. Check your Google Gemini billing or Lovable credits.",
    };
  }
  if (/402|credits|payment required/i.test(msg)) {
    return {
      status: 402,
      error: "Lovable AI credits are exhausted. Enable BYOK with a Gemini key, or add Lovable credits.",
    };
  }
  if (/API_KEY_INVALID|API key not valid|invalid.*api.*key/i.test(msg)) {
    return { status: 401, error: "Google Gemini API key is invalid." };
  }
  if (/401|unauthorized/i.test(msg)) {
    return { status: 401, error: "Provider credentials are invalid." };
  }
  if (/403|forbidden/i.test(msg)) {
    return { status: 403, error: "Provider access forbidden for this model or key." };
  }
  if (/404|not found|unsupported/i.test(msg)) {
    return { status: 404, error: "Selected model is not supported by the configured API." };
  }
  return { status: 502, error: "AI generation failed. Try again in a moment." };
}
