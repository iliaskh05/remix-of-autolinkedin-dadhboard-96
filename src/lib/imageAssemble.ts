/**
 * Pure image-prompt assembly helpers for Vitest.
 * Mirrors supabase/functions/_shared/imagePrompt.ts overlay append logic —
 * keep both in sync. Edge Functions own the Deno implementation.
 */

export type ImageOverlayOpts = {
  aspectRatio?: string;
  language?: string | null;
  style?: string;
  mood?: string;
  colors?: string[];
  textOverlay?: { text: string; position: string; weight?: string; color?: string };
  wordmark?: { text: string; position: string };
  margin?: number;
};

const POSITION_LABELS: Record<string, string> = {
  "top-left": "top-left corner",
  "top-center": "top center",
  "top-right": "top-right corner",
  "center-left": "middle-left",
  "center": "exact center",
  "center-right": "middle-right",
  "bottom-left": "bottom-left corner",
  "bottom-center": "bottom center",
  "bottom-right": "bottom-right corner",
};

/** Append user overlays; preserves exact textOverlay / wordmark spelling. */
export function appendImageOverlays(basePrompt: string, overlays: ImageOverlayOpts): string {
  const parts: string[] = [basePrompt];

  if (overlays.aspectRatio) parts.push(`Aspect ratio: ${overlays.aspectRatio}.`);
  if (overlays.style) parts.push(`Additional visual style preference: ${overlays.style}.`);
  if (overlays.mood) parts.push(`Additional mood preference: ${overlays.mood}.`);
  if (overlays.colors?.length) {
    parts.push(`Prefer these dominant brand colors when compatible with the brief palette: ${overlays.colors.join(", ")}.`);
  }

  const wantsText = Boolean(overlays.textOverlay?.text || overlays.wordmark?.text);
  if (overlays.textOverlay?.text) {
    const pos = POSITION_LABELS[overlays.textOverlay.position] || "center";
    const weight = overlays.textOverlay.weight || "bold";
    const color = overlays.textOverlay.color ? ` in ${overlays.textOverlay.color}` : "";
    parts.push(
      `EXCEPTION — render this exact user-authored text only (no extra words, no typos, preserve capitalization/numbers/punctuation): "${overlays.textOverlay.text}". ` +
      `Place it at the ${pos}. Use a ${weight} sans-serif typography${color}, high contrast.`,
    );
  }
  if (overlays.wordmark?.text) {
    const pos = POSITION_LABELS[overlays.wordmark.position] || "bottom-center";
    parts.push(
      `EXCEPTION — add a small wordmark with this exact text (preserve capitalization): "${overlays.wordmark.text}" at the ${pos}, discreet but readable.`,
    );
  }
  if (overlays.margin && overlays.margin > 0) {
    parts.push(`Keep a clean empty band of approximately ${overlays.margin}% of the image height free of any subject element at the bottom.`);
  }

  if (wantsText) {
    parts.push(
      "Note: beyond the infographic title and brief-approved labels, render ONLY the exact user-authored text/wordmark above; do not invent any other writing.",
    );
  }

  return parts.join(" ");
}

/** Simulate primary + fallback assembly used by generate-image. */
export function buildPrimaryAndFallbackPrompts(
  basePrimary: string,
  baseFallback: string,
  overlays: ImageOverlayOpts,
): { primary: string; fallback: string } {
  return {
    primary: appendImageOverlays(basePrimary, overlays),
    fallback: appendImageOverlays(baseFallback, overlays),
  };
}

export function normalizeAspectRatio(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.match(/\b(1:1|16:9|4:5|3:4|9:16)\b/)?.[1];
}
