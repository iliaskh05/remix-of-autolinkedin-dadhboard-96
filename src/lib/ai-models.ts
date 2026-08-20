// Available AI models for users to pick from in Settings.
// `owner` = who built the model (Google / OpenAI).
// Runtime execution (direct API vs Lovable Gateway) is decided server-side
// by supabase/functions/_shared/ai-provider.ts based on use_byok + keys.

export type ModelOwner = "google" | "openai";

export type AiModel = {
  value: string;
  label: string;
  /** Model owner / family — NOT the execution gateway. */
  owner: ModelOwner;
  capability: "text" | "image";
  supportsDirectApi: boolean;
  supportsLovableGateway: boolean;
  supportsInputImage?: boolean;
  description?: string;
};

export const POST_MODELS: AiModel[] = [
  {
    value: "google/gemini-3-flash-preview",
    label: "Gemini 3 Flash (default, fast)",
    owner: "google",
    capability: "text",
    supportsDirectApi: true,
    supportsLovableGateway: true,
  },
  {
    value: "google/gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro (best reasoning)",
    owner: "google",
    capability: "text",
    supportsDirectApi: true,
    supportsLovableGateway: true,
  },
  {
    value: "google/gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    owner: "google",
    capability: "text",
    supportsDirectApi: true,
    supportsLovableGateway: true,
  },
  {
    value: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash (balanced)",
    owner: "google",
    capability: "text",
    supportsDirectApi: true,
    supportsLovableGateway: true,
  },
  {
    value: "google/gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash Lite (cheapest)",
    owner: "google",
    capability: "text",
    supportsDirectApi: true,
    supportsLovableGateway: true,
  },
  {
    value: "openai/gpt-5",
    label: "GPT-5 (powerful) — BYOK only",
    owner: "openai",
    capability: "text",
    supportsDirectApi: true,
    supportsLovableGateway: true,
  },
  {
    value: "openai/gpt-5-mini",
    label: "GPT-5 Mini — BYOK only",
    owner: "openai",
    capability: "text",
    supportsDirectApi: true,
    supportsLovableGateway: true,
  },
  {
    value: "openai/gpt-5-nano",
    label: "GPT-5 Nano (fastest) — BYOK only",
    owner: "openai",
    capability: "text",
    supportsDirectApi: true,
    supportsLovableGateway: true,
  },
  {
    value: "openai/gpt-5.2",
    label: "GPT-5.2 (latest) — BYOK only",
    owner: "openai",
    capability: "text",
    supportsDirectApi: true,
    supportsLovableGateway: true,
  },
];

export const IMAGE_MODELS: AiModel[] = [
  {
    value: "google/gemini-3-pro-image",
    label: "Nano Banana Pro — Gemini 3 Pro Image (défaut, qualité max)",
    owner: "google",
    capability: "image",
    supportsDirectApi: true,
    supportsLovableGateway: true,
    supportsInputImage: true,
  },
  {
    value: "google/gemini-3.1-flash-image",
    label: "Nano Banana 2 (rapide)",
    owner: "google",
    capability: "image",
    supportsDirectApi: true,
    supportsLovableGateway: true,
    supportsInputImage: true,
  },
  {
    value: "google/gemini-2.5-flash-image",
    label: "Nano Banana (rapide & économique)",
    owner: "google",
    capability: "image",
    supportsDirectApi: true,
    supportsLovableGateway: true,
    supportsInputImage: true,
  },
];

export const DEFAULT_IMAGE_MODEL = "google/gemini-3-pro-image";
export const DEFAULT_POST_MODEL = "google/gemini-2.5-flash";

// Configurable "voice" options for text generation (System Prompt building).
export type PostOption = { value: string; label: string };

export const POST_TONES: PostOption[] = [
  { value: "auto", label: "Automatique (l'IA choisit)" },
  { value: "professional", label: "Professionnel" },
  { value: "casual", label: "Décontracté" },
  { value: "expert", label: "Expert / Technique" },
  { value: "inspirational", label: "Inspirant" },
  { value: "storytelling", label: "Storytelling" },
  { value: "provocative", label: "Opinion / Provocateur" },
];

export const POST_LENGTHS: PostOption[] = [
  { value: "auto", label: "Automatique (l'IA choisit)" },
  { value: "short", label: "Court (~80-120 mots)" },
  { value: "medium", label: "Moyen (~150-250 mots)" },
  { value: "long", label: "Long (~300-400 mots)" },
];

export const DEFAULT_POST_TONE = "auto";
export const DEFAULT_POST_LENGTH = "auto";

export type PostLanguage = "fr" | "en" | "es" | "ar";

export const POST_LANGUAGES: { value: PostLanguage; label: string }[] = [
  { value: "fr", label: "Français" },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "ar", label: "العربية" },
];

export const DEFAULT_POST_LANGUAGE: PostLanguage = "fr";

export function isPostLanguage(value: unknown): value is PostLanguage {
  return POST_LANGUAGES.some((l) => l.value === value);
}
