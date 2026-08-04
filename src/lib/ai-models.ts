// Available AI models for users to pick from in Settings.
// Used for the "post" (text) generation and "image" generation features.

export type AiModel = {
  value: string;
  label: string;
  provider: "lovable" | "openai" | "gemini";
  description?: string;
};

export const POST_MODELS: AiModel[] = [
  { value: "google/gemini-3-flash-preview", label: "Gemini 3 Flash (default, fast)", provider: "lovable" },
  { value: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (best reasoning)", provider: "lovable" },
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "lovable" },
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash (balanced)", provider: "lovable" },
  { value: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite (cheapest)", provider: "lovable" },
  { value: "openai/gpt-5", label: "GPT-5 (powerful)", provider: "lovable" },
  { value: "openai/gpt-5-mini", label: "GPT-5 Mini", provider: "lovable" },
  { value: "openai/gpt-5-nano", label: "GPT-5 Nano (fastest)", provider: "lovable" },
  { value: "openai/gpt-5.2", label: "GPT-5.2 (latest)", provider: "lovable" },
];

export const IMAGE_MODELS: AiModel[] = [
  { value: "google/gemini-3-pro-image", label: "Nano Banana Pro — Gemini 3 Pro Image (défaut, qualité max)", provider: "gemini" },
  { value: "google/gemini-3.1-flash-image", label: "Nano Banana 2 (rapide)", provider: "gemini" },
  { value: "google/gemini-2.5-flash-image", label: "Nano Banana (rapide & économique)", provider: "gemini" },
];

export const DEFAULT_IMAGE_MODEL = "google/gemini-3-pro-image";

// Configurable "voice" options for text generation (System Prompt building).
// The `value` is a stable key sent to the edge function, which maps it to
// detailed instructions. The `label` is what the user sees.

export type PostOption = { value: string; label: string };

// "auto" means: don't send an override, let the AI infer the best choice for
// the topic on its own (Phase 5 — the user only has to give a topic).
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

// Global language selector: drives both the post copy and the typography
// rendered inside the generated image. The code is sent as-is to the Edge
// Functions, which own the mapping to full prompt directives.
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
