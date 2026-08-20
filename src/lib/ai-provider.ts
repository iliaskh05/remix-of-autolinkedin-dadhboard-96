/**
 * Pure AI provider resolution (no Deno / no secrets I/O).
 * Shared conceptually with supabase/functions/_shared/ai-provider.ts —
 * keep both in sync. Used by Settings UI + Vitest.
 */

export type ModelOwner = "google" | "openai";
export type Capability = "text" | "image";
export type ExecutionProvider = "gemini_direct" | "openai_direct" | "lovable_gateway";

export type AiUserSettings = {
  use_byok: boolean;
  gemini_api_key?: string | null;
  openai_api_key?: string | null;
};

export type EnvAiKeys = {
  /** Workspace Lovable gateway key (server secret only). */
  lovableApiKey?: string | null;
  /**
   * Optional workspace Gemini key (server secret).
   * Used only when BYOK is ON and the user has not stored a personal key.
   * Never used when BYOK is OFF (that path is Lovable).
   */
  geminiApiKey?: string | null;
};

export type ResolvedProvider = {
  owner: ModelOwner;
  execution: ExecutionProvider;
  isByok: boolean;
  /** Model id as expected by the chosen execution path. */
  normalizedModel: string;
  /** Original settings / request model id. */
  requestedModel: string;
  capability: Capability;
  /** Human-readable routing label for UI / logs (never includes the key). */
  label: string;
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

export const GEMINI_TEXT_MODELS = [
  "google/gemini-3-flash-preview",
  "google/gemini-3.1-pro-preview",
  "google/gemini-2.5-pro",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
] as const;

export const GEMINI_IMAGE_MODELS = [
  "google/gemini-3-pro-image",
  "google/gemini-3.1-flash-image",
  "google/gemini-2.5-flash-image",
  "google/gemini-3.1-flash-image-preview",
  "google/gemini-3-pro-image-preview",
] as const;

export const OPENAI_TEXT_MODELS = [
  "openai/gpt-5",
  "openai/gpt-5-mini",
  "openai/gpt-5-nano",
  "openai/gpt-5.2",
] as const;

/** Maps UI / Lovable model ids → bare Google Generative Language API model ids. */
export const GEMINI_TEXT_ALIASES: Record<string, string> = {
  "google/gemini-3-flash-preview": "gemini-2.5-flash",
  "google/gemini-3.1-pro-preview": "gemini-2.5-pro",
  "google/gemini-2.5-pro": "gemini-2.5-pro",
  "google/gemini-2.5-flash": "gemini-2.5-flash",
  "google/gemini-2.5-flash-lite": "gemini-2.5-flash-lite",
};

export const GEMINI_IMAGE_ALIASES: Record<string, string> = {
  "google/gemini-2.5-flash-image": "gemini-2.5-flash-image",
  "google/gemini-3.1-flash-image-preview": "gemini-3.1-flash-image",
  "google/gemini-3-pro-image-preview": "gemini-3-pro-image",
  "google/gemini-3.1-flash-image": "gemini-3.1-flash-image",
  "google/gemini-3-pro-image": "gemini-3-pro-image",
};

export function detectModelOwner(modelId: string): ModelOwner {
  if (modelId.startsWith("openai/")) return "openai";
  return "google";
}

export function normalizeGeminiTextModel(modelId: string): string {
  if (GEMINI_TEXT_ALIASES[modelId]) return GEMINI_TEXT_ALIASES[modelId];
  if (modelId.startsWith("google/")) return modelId.replace(/^google\//, "");
  if (modelId.startsWith("openai/")) return "gemini-2.5-flash";
  return modelId || "gemini-2.5-flash";
}

export function normalizeGeminiImageModel(modelId: string): string {
  return GEMINI_IMAGE_ALIASES[modelId] ?? (modelId.replace(/^google\//, "") || "gemini-3-pro-image");
}

export function normalizeOpenAiModel(modelId: string): string {
  return modelId.replace(/^openai\//, "");
}

export function isSupportedModel(modelId: string, capability: Capability): boolean {
  if (capability === "image") {
    return (
      (GEMINI_IMAGE_MODELS as readonly string[]).includes(modelId) ||
      Boolean(GEMINI_IMAGE_ALIASES[modelId]) ||
      (modelId.startsWith("google/") && modelId.includes("image"))
    );
  }
  return (
    (GEMINI_TEXT_MODELS as readonly string[]).includes(modelId) ||
    (OPENAI_TEXT_MODELS as readonly string[]).includes(modelId) ||
    modelId.startsWith("google/") ||
    modelId.startsWith("openai/")
  );
}

/**
 * Decide which execution backend to use.
 * Does NOT return API keys — callers attach keys after resolution.
 */
export function resolveProvider(
  settings: AiUserSettings,
  modelId: string,
  capability: Capability,
  env: EnvAiKeys = {},
): ResolvedProvider {
  const requestedModel = modelId || (capability === "image" ? "google/gemini-3-pro-image" : "google/gemini-2.5-flash");
  const owner = detectModelOwner(requestedModel);

  if (capability === "image" && owner === "openai") {
    throw new ProviderResolveError(
      "UNSUPPORTED_MODEL",
      "OpenAI image models are not supported. Choose a Gemini image model.",
      400,
    );
  }

  if (!isSupportedModel(requestedModel, capability)) {
    throw new ProviderResolveError(
      "UNSUPPORTED_MODEL",
      `Selected ${capability} model is not supported: ${requestedModel}`,
      400,
    );
  }

  // ---- BYOK ON → direct provider APIs only (never Lovable) ----
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

  // ---- BYOK OFF → Lovable Gateway (consumes Lovable credits) ----
  return {
    owner,
    execution: "lovable_gateway",
    isByok: false,
    // Lovable expects the full google/… or openai/… model id
    normalizedModel: requestedModel,
    requestedModel,
    capability,
    label: "Lovable Gateway",
  };
}

/**
 * Resolve the API key for a previously resolved provider route.
 * Throws ProviderResolveError when the required key is missing.
 */
export function resolveApiKey(
  resolved: ResolvedProvider,
  settings: AiUserSettings,
  env: EnvAiKeys = {},
): string {
  if (resolved.execution === "openai_direct") {
    const key = settings.openai_api_key?.trim();
    if (!key) {
      throw new ProviderResolveError(
        "BYOK_MISSING_OPENAI_KEY",
        "BYOK is enabled but the OpenAI API key is missing. Add it in Settings.",
        400,
      );
    }
    return key;
  }

  if (resolved.execution === "gemini_direct") {
    const key = settings.gemini_api_key?.trim() || env.geminiApiKey?.trim() || "";
    if (!key) {
      throw new ProviderResolveError(
        "BYOK_MISSING_GEMINI_KEY",
        "BYOK is enabled but the Google Gemini API key is missing. Add it in Settings → BYOK.",
        400,
      );
    }
    return key;
  }

  // lovable_gateway
  const key = env.lovableApiKey?.trim();
  if (!key) {
    throw new ProviderResolveError(
      "LOVABLE_NOT_CONFIGURED",
      "Lovable AI Gateway is not configured (LOVABLE_API_KEY). Enable BYOK with a Gemini key, or set the Lovable secret.",
      500,
    );
  }
  return key;
}

/** Full resolve: route + key. */
export function resolveProviderWithKey(
  settings: AiUserSettings,
  modelId: string,
  capability: Capability,
  env: EnvAiKeys = {},
): ResolvedProvider & { apiKey: string } {
  const resolved = resolveProvider(settings, modelId, capability, env);
  const apiKey = resolveApiKey(resolved, settings, env);
  return { ...resolved, apiKey };
}

/** UI helper: describe current routing without exposing keys. */
export function describeRoutingStatus(settings: AiUserSettings): {
  mode: "byok" | "lovable";
  title: string;
  description: string;
} {
  if (settings.use_byok) {
    const hasGemini = Boolean(settings.gemini_api_key?.trim());
    const hasOpenAi = Boolean(settings.openai_api_key?.trim());
    return {
      mode: "byok",
      title: "Google Gemini / OpenAI — BYOK active",
      description: hasGemini || hasOpenAi
        ? "Your provider API keys will be used directly. Gemini requests will not consume Lovable credits."
        : "BYOK is on but no provider key is saved yet. Add a Gemini (or OpenAI) key below.",
    };
  }
  return {
    mode: "lovable",
    title: "Lovable Gateway",
    description: "AI usage may consume Lovable workspace credits. Enable BYOK to use your own Google Gemini key.",
  };
}

export function mapProviderErrorMessage(err: unknown): { status: number; error: string } {
  if (err instanceof ProviderResolveError) {
    return { status: err.status, error: err.message };
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/429|quota|rate|RESOURCE_EXHAUSTED/i.test(msg)) {
    return { status: 429, error: "Provider rate limit / quota exceeded. Check your Google Gemini billing or Lovable credits." };
  }
  if (/402|credits|payment/i.test(msg)) {
    return { status: 402, error: "Lovable AI credits are exhausted. Enable BYOK with a Gemini key, or add Lovable credits." };
  }
  if (/API_KEY_INVALID|API key not valid|invalid.*api.*key/i.test(msg)) {
    return { status: 401, error: "Google Gemini API key is invalid." };
  }
  if (/BYOK_MISSING_GEMINI|Gemini API key is missing|GEMINI_API_KEY not configured/i.test(msg)) {
    return { status: 400, error: "Google Gemini API key is not configured. Add it in Settings → BYOK." };
  }
  return { status: 502, error: "AI generation failed. Try again in a moment." };
}
