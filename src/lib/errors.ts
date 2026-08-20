// Central place to turn thrown errors (Supabase, fetch, Edge Functions, unknown)
// into short, user-safe messages. Never forward raw provider/stack text to the UI.

const FALLBACK_MESSAGE = "Une erreur est survenue. Réessaie dans un instant.";

const KNOWN_PATTERNS: Array<{ test: RegExp; message: string }> = [
  { test: /rate limit/i, message: "Trop de requêtes en peu de temps. Patiente quelques secondes et réessaie." },
  {
    test: /Lovable AI credits are exhausted|Add credits to your workspace|402/i,
    message: "Crédits Lovable épuisés. Active BYOK avec une clé Gemini, ou ajoute des crédits Lovable.",
  },
  {
    test: /quota|RESOURCE_EXHAUSTED/i,
    message: "Quota Google Gemini dépassé. Vérifie ta facturation sur aistudio.google.com.",
  },
  {
    test: /BYOK is enabled but the Google Gemini|Gemini API key is not configured|BYOK_MISSING_GEMINI/i,
    message: "BYOK activé mais clé Gemini manquante. Ajoute-la dans Paramètres → BYOK.",
  },
  {
    test: /BYOK is enabled but the OpenAI|BYOK_MISSING_OPENAI/i,
    message: "BYOK activé mais clé OpenAI manquante. Ajoute-la dans Paramètres → BYOK.",
  },
  {
    test: /Gemini API key is invalid|API_KEY_INVALID/i,
    message: "Clé Google Gemini invalide. Vérifie-la dans Paramètres → BYOK.",
  },
  {
    test: /Lovable AI Gateway is not configured|LOVABLE_NOT_CONFIGURED/i,
    message: "Passerelle Lovable non configurée. Active BYOK avec une clé Gemini, ou configure LOVABLE_API_KEY.",
  },
  { test: /unauthorized|401/i, message: "Session expirée. Reconnecte-toi et réessaie." },
  { test: /forbidden|403/i, message: "Action non autorisée." },
  { test: /not found|404/i, message: "Ressource introuvable." },
  { test: /network|fetch failed|failed to fetch/i, message: "Problème de connexion réseau. Vérifie ta connexion et réessaie." },
  { test: /linkedin/i, message: "Erreur de communication avec LinkedIn. Vérifie ta connexion dans Paramètres." },
];

type InvokeResult = { error?: unknown; data?: { error?: string; success?: boolean } | null };

/**
 * Supabase functions.invoke sets `error` on non-2xx even when the body
 * contains a friendly `error` string — prefer the body message when present.
 */
export function throwInvokeError({ error, data }: InvokeResult, fallback = FALLBACK_MESSAGE): never {
  const bodyMsg = data && typeof data === "object" && "error" in data ? data.error : undefined;
  if (bodyMsg) throw new Error(bodyMsg);
  if (error) throw error instanceof Error ? error : new Error(String(error));
  throw new Error(fallback);
}

export function getSafeErrorMessage(error: unknown, fallback: string = FALLBACK_MESSAGE): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : (error as { message?: string } | null)?.message || "";

  if (!raw) return fallback;
  const match = KNOWN_PATTERNS.find((p) => p.test.test(raw));
  if (match) return match.message;

  const looksSafe = raw.length < 200 && !/\bat\s+\S+:\d+:\d+/.test(raw) && !/^\{|\[/.test(raw.trim());
  return looksSafe ? raw : fallback;
}
