// Central place to turn thrown errors (Supabase, fetch, Edge Functions, unknown)
// into short, user-safe messages. Never forward raw provider/stack text to the UI:
// it can leak internal details (API routes, SQL, provider error bodies, etc.).

const FALLBACK_MESSAGE = "Une erreur est survenue. Réessaie dans un instant.";

// Known technical fragments we recognize and translate into a friendly message.
// Anything not matched here falls back to the generic message, never the raw text.
const KNOWN_PATTERNS: Array<{ test: RegExp; message: string }> = [
  { test: /rate limit/i, message: "Trop de requêtes en peu de temps. Patiente quelques secondes et réessaie." },
  { test: /credits|quota|402/i, message: "Crédits insuffisants sur ton espace IA. Vérifie ton abonnement." },
  { test: /unauthorized|401/i, message: "Session expirée. Reconnecte-toi et réessaie." },
  { test: /forbidden|403/i, message: "Action non autorisée." },
  { test: /not found|404/i, message: "Ressource introuvable." },
  { test: /network|fetch failed|failed to fetch/i, message: "Problème de connexion réseau. Vérifie ta connexion et réessaie." },
  { test: /linkedin/i, message: "Erreur de communication avec LinkedIn. Vérifie ta connexion dans Paramètres." },
];

/**
 * Convert any thrown value into a short, user-facing message.
 * Use this everywhere an error reaches a toast/UI surface.
 */
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

  // Short, already-friendly messages authored by our own edge functions
  // (no stack traces, no "at ...", no JSON blobs) can be shown as-is.
  const looksSafe = raw.length < 160 && !/\bat\s+\S+:\d+:\d+/.test(raw) && !/^\{|\[/.test(raw.trim());
  return looksSafe ? raw : fallback;
}
