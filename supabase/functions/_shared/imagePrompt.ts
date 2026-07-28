// Phase 6 — two-layer image prompts.
// Layer 1 (dynamic): a structured `visual_brief` inferred from the LinkedIn post.
// Layer 2 (fixed, server-side): premium dark-dashboard production rules that
// the client can never strip or override.

export type VisualBrief = {
  visual_subject: string;
  setting: string;
  composition: string;
  mood: string;
  palette: string[];
  avoid: string[];
  /** Exact headline rendered on the dashboard (typographic precision required). */
  main_title: string;
  /** Short labels / callouts taken ONLY from the post — never invented stats. */
  key_labels: string[];
};

/**
 * Fixed production identity — always appended server-side.
 * Minimalist corporate data-visualization dashboard (Economist / Bloomberg
 * editorial quality), deliberately map-free and geopolitics-free.
 */
export const PRODUCTION_STYLE_RULES =
  "Create a high-end, minimalist corporate data visualization and infographic layout. " +
  "Style: Clean vector graphics, professional editorial quality (like The Economist or Bloomberg), " +
  "flat design with a dark premium color palette (navy blue, slate, gold/copper accents). " +
  "Structure: A balanced grid layout with clear hierarchical sections, clean bar charts, and trend lines. " +
  "STRICT CONTENT RULES: " +
  "The focus is strictly on global macroeconomics, commodities, and industrial supply chains. " +
  "ABSOLUTELY NO political maps, borders, or geopolitical territory representations. " +
  "Strictly exclude any visual reference, text, or map concerning the Moroccan Sahara or regional conflicts. " +
  "Do not overcomplicate; keep whitespace breathable. " +
  "All text and numbers must be rendered as clean, sharp, and minimalist typography placeholders without 'AI smudging'. " +
  "The final image must look like a precise, structured dashboard designed by a senior art director with 20 years of experience. " +
  "No sci-fi aesthetics.";

/** Extra brand-safety constraints layered on top of PRODUCTION_STYLE_RULES. */
export const IMAGE_NEGATIVE_GUIDELINES =
  "Additional hard constraints — the image must contain: " +
  "NO political maps, NO country borders, NO territorial or geopolitical representations; " +
  "NO reference to the Moroccan Sahara or any regional conflict; " +
  "NO national flags, NO military imagery; " +
  "NO brand logos, NO watermarks, NO AI-signature marks; " +
  "NO religious symbols; " +
  "NO controversial, partisan, or divisive political imagery; " +
  "NO overloaded clutter, NO illegible micro-text, NO smudged or malformed glyphs; " +
  "NO fabricated statistics that are not listed in the brief; " +
  "NO sci-fi, neon, futuristic or 3D-render aesthetics.";

/** @deprecated Prefer PRODUCTION_STYLE_RULES — kept for callers that still import it. */
export const IMAGE_QUALITY_GUIDELINES = PRODUCTION_STYLE_RULES;

function asStringList(raw: unknown, max = 8): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const v = item.trim();
    if (!v) continue;
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/** Normalize/coerce anything into a usable VisualBrief. */
export function normalizeVisualBrief(raw: unknown, fallbackSubject = ""): VisualBrief {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const subject =
    (typeof obj.visual_subject === "string" && obj.visual_subject.trim()) ||
    fallbackSubject.trim() ||
    "an abstract data-driven visualization of commodity and supply-chain dynamics";

  const mainTitle =
    (typeof obj.main_title === "string" && obj.main_title.trim()) ||
    subject.split(/[.!?\n]/)[0].slice(0, 90).toUpperCase();

  return {
    visual_subject: subject,
    setting:
      (typeof obj.setting === "string" && obj.setting.trim()) ||
      "a dark minimalist dashboard canvas with breathable whitespace",
    composition:
      (typeof obj.composition === "string" && obj.composition.trim()) ||
      "balanced grid layout with clear hierarchical sections, headline block, clean bar charts and trend lines, generous margins",
    mood:
      (typeof obj.mood === "string" && obj.mood.trim()) ||
      "authoritative, analytical, restrained",
    palette: asStringList(obj.palette).length
      ? asStringList(obj.palette)
      : ["navy blue", "slate", "gold accent", "copper accent"],
    avoid: asStringList(obj.avoid),
    main_title: mainTitle,
    key_labels: asStringList(obj.key_labels, 6),
  };
}

/** Build a VisualBrief from a free-form subject string (legacy callers). */
export function visualBriefFromSubject(subject: string): VisualBrief {
  return normalizeVisualBrief(null, subject);
}

/**
 * Compact human-readable summary of a brief (for UI / DB storage).
 * Does NOT include the fixed production rules — those are injected only
 * server-side by `buildGuardedImagePrompt`.
 */
export function summarizeVisualBrief(brief: VisualBrief): string {
  const palette = brief.palette.length ? brief.palette.join(", ") : "navy blue, slate, gold accent";
  const labels = brief.key_labels.length ? ` Labels: ${brief.key_labels.join(" | ")}.` : "";
  return [
    `Title: "${brief.main_title}".`,
    brief.visual_subject,
    `Setting: ${brief.setting}.`,
    `Composition: ${brief.composition}.`,
    `Mood: ${brief.mood}.`,
    `Palette: ${palette}.${labels}`,
  ].join(" ");
}

/**
 * Layer 1 + Layer 2: turns a structured visual_brief into a fluent English
 * prompt, then concatenates the immutable production rules.
 */
export function buildGuardedImagePrompt(briefOrSubject: VisualBrief | string): string {
  const brief =
    typeof briefOrSubject === "string"
      ? visualBriefFromSubject(briefOrSubject)
      : normalizeVisualBrief(briefOrSubject);

  const palette = brief.palette.length
    ? brief.palette.join(", ")
    : "navy blue, slate, gold/copper accents";

  const labelsBlock = brief.key_labels.length
    ? `Render ONLY these brief-approved labels/callouts with perfect spelling (no extra stats): ${brief.key_labels.map((l) => `"${l}"`).join("; ")}.`
    : "If charts are shown, use qualitative trend shapes without inventing numeric values.";

  const avoidExtra = [
    ...brief.avoid,
    "political maps",
    "country borders",
    "national flags",
    "Moroccan Sahara or any regional conflict",
    "watermarks",
    "brand logos",
    "cluttered layouts",
    "illegible micro-text",
    "sci-fi aesthetics",
  ];
  const avoid = [...new Set(avoidExtra.map((a) => a.trim()).filter(Boolean))].join("; ");

  return [
    "Create a LinkedIn-ready corporate data-visualization dashboard.",
    `The data story to visualize is: ${brief.visual_subject}.`,
    `Canvas: ${brief.setting}.`,
    `Compose the layout as follows: ${brief.composition}.`,
    `The mood should feel ${brief.mood}.`,
    `Dominant color palette on a dark background: ${palette}.`,
    `The main title, rendered as sharp minimalist typography with zero spelling errors, must be exactly: "${brief.main_title}".`,
    labelsBlock,
    `Explicitly avoid: ${avoid}.`,
    PRODUCTION_STYLE_RULES,
    IMAGE_NEGATIVE_GUIDELINES,
  ].join(" ");
}

/**
 * Conservative fallback when the first attempt is blocked/empty.
 * Keeps only the core subject + fixed production rules.
 */
export function buildFallbackImagePrompt(briefOrSubject: VisualBrief | string): string {
  const brief =
    typeof briefOrSubject === "string"
      ? visualBriefFromSubject(briefOrSubject)
      : normalizeVisualBrief(briefOrSubject);
  const shortSubject = brief.visual_subject.split(/[.!?\n]/)[0].slice(0, 140);
  return (
    `A clean minimalist dark-background corporate data dashboard about: ${shortSubject}. ` +
    `Main title exactly: "${brief.main_title}". One or two simple bar charts or trend lines, ` +
    `sharp minimalist typography, generous whitespace, no maps, no clutter. ` +
    PRODUCTION_STYLE_RULES
  );
}
