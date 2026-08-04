// Phase 6 — two-layer image prompts.
// Layer 1 (dynamic): a structured `visual_brief` inferred from the LinkedIn post.
// Layer 2 (fixed, server-side): premium corporate-infographic production rules
// that the client can never strip or override.
// Target look: light McKinsey/Bloomberg-style infographic with isometric process
// diagram, icon side-cards, optional stylized world map, and footer charts
// (navy / white / gold).

import { buildImageLanguageRule, resolveLanguage } from "./language.ts";

export type VisualBrief = {
  visual_subject: string;
  setting: string;
  composition: string;
  mood: string;
  palette: string[];
  avoid: string[];
  /** Exact headline rendered in the navy header bar. */
  main_title: string;
  /** Short labels / callouts taken ONLY from the post — never invented stats. */
  key_labels: string[];
};

/**
 * Fixed production identity — always appended server-side.
 * Corporate supply-chain infographic (McKinsey / Bloomberg editorial quality):
 * light canvas, navy header/footer, isometric industrial illustration, icon cards,
 * optional stylized geographic hotspots — never geopolitical.
 */
export const PRODUCTION_STYLE_RULES =
  "Create a high-end LinkedIn-ready corporate infographic, editorial quality like a McKinsey or Bloomberg report. " +
  "Style: clean vector graphics, isometric flat design for the central industrial/process diagram " +
  "(thin lines, soft shadows, subtle depth — not photorealistic 3D, not sci-fi). " +
  "Canvas: light off-white / soft-gray content area with a solid navy-blue header bar and a solid navy-blue footer bar. " +
  "Color palette: navy blue, clean white, light gray, muted gold/sand accents (optional soft teal highlights). " +
  "Layout (three horizontal bands): " +
  "(1) HEADER — navy bar with a bold white uppercase title and a short subtitle; " +
  "(2) BODY — central isometric process / supply-chain illustration (factories, silos, pipes, flows, product icons) " +
  "flanked by left and right vertical stacks of icon+title+short-text cards; " +
  "optionally a stylized world map with soft hotspot blobs for refining/production regions, plus a short numbered list; " +
  "(3) FOOTER — navy bar with one or two clean data charts (bar chart and/or area/line chart) with sharp labels. " +
  "Typography: modern sans-serif, sharp and perfectly legible, no AI-smudged glyphs. " +
  "Keep whitespace breathable and the hierarchy clear. " +
  "Focus on commodities, energy, metals, logistics, industrial supply chains and macro themes.";

/** Brand-safety constraints — stylized geographic maps OK; geopolitics never. */
export const IMAGE_NEGATIVE_GUIDELINES =
  "Additional hard constraints — the image must contain: " +
  "NO political maps with disputed borders or territorial claims; " +
  "NO reference to the Moroccan Sahara or any regional conflict; " +
  "NO national flags, NO military imagery; " +
  "NO brand logos, NO watermarks, NO AI-signature marks; " +
  "NO religious symbols; " +
  "NO controversial, partisan, or divisive political imagery; " +
  "NO overloaded clutter, NO illegible micro-text, NO smudged or malformed glyphs; " +
  "NO fabricated statistics that are not listed in the brief; " +
  "NO dark full-bleed dashboard aesthetic, NO neon, NO sci-fi, NO photorealistic 3D renders. " +
  "A stylized, simplified world map used only as a geographic hotspot backdrop is ALLOWED " +
  "when it illustrates industrial/refining capacity — keep continents soft and abstract, never mark contested borders.";

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
    "a corporate infographic of an industrial commodity supply chain and refining process";

  const mainTitle =
    (typeof obj.main_title === "string" && obj.main_title.trim()) ||
    subject.split(/[.!?\n]/)[0].slice(0, 90).toUpperCase();

  return {
    visual_subject: subject,
    setting:
      (typeof obj.setting === "string" && obj.setting.trim()) ||
      "light off-white infographic canvas with a navy header bar and a navy footer bar, generous whitespace",
    composition:
      (typeof obj.composition === "string" && obj.composition.trim()) ||
      "three-band layout: navy header with title; central isometric process diagram flanked by icon cards; " +
      "optional stylized world map with soft hotspots; navy footer with bar and line charts",
    mood:
      (typeof obj.mood === "string" && obj.mood.trim()) ||
      "authoritative, technical, organized, high-end consulting report",
    palette: asStringList(obj.palette).length
      ? asStringList(obj.palette)
      : ["navy blue", "off-white", "light gray", "muted gold"],
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
  const palette = brief.palette.length ? brief.palette.join(", ") : "navy blue, off-white, muted gold";
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

export type ImagePromptOptions = {
  /** Language code or name driving the typography rendered inside the image. */
  language?: string | null;
};

/**
 * Layer 1 + Layer 2: turns a structured visual_brief into a fluent English
 * prompt, then concatenates the immutable production rules. The instructions
 * stay in English (the image model's native language) — only the typography
 * rendered on the canvas follows the selected language.
 */
export function buildGuardedImagePrompt(
  briefOrSubject: VisualBrief | string,
  options: ImagePromptOptions = {},
): string {
  const brief =
    typeof briefOrSubject === "string"
      ? visualBriefFromSubject(briefOrSubject)
      : normalizeVisualBrief(briefOrSubject);
  const lang = resolveLanguage(options.language);

  const palette = brief.palette.length
    ? brief.palette.join(", ")
    : "navy blue, off-white, light gray, muted gold";

  const labelsBlock = brief.key_labels.length
    ? `Render ONLY these brief-approved labels/callouts with perfect spelling (no extra stats): ${brief.key_labels.map((l) => `"${l}"`).join("; ")}.`
    : "If charts are shown, use qualitative trend shapes without inventing numeric values. Keep card body text short (one line).";

  const avoidExtra = [
    ...brief.avoid,
    "disputed borders",
    "political territorial claims",
    "national flags",
    "Moroccan Sahara or any regional conflict",
    "watermarks",
    "brand logos",
    "dark full-bleed dashboards",
    "cluttered layouts",
    "illegible micro-text",
    "sci-fi aesthetics",
    "photorealistic 3D",
  ];
  const avoid = [...new Set(avoidExtra.map((a) => a.trim()).filter(Boolean))].join("; ");

  return [
    "Create a LinkedIn-ready corporate supply-chain infographic (not a dark dashboard).",
    `The story to visualize is: ${brief.visual_subject}.`,
    `Canvas: ${brief.setting}.`,
    `Compose the layout as follows: ${brief.composition}.`,
    `The mood should feel ${brief.mood}.`,
    `Dominant color palette on a LIGHT background with navy header/footer: ${palette}.`,
    "Centerpiece: a clean isometric industrial/process illustration with clear flow arrows.",
    "Side panels: stacked icon cards (circle icon + bold title + one short line of text).",
    "Optional: a soft stylized world map with capacity hotspots — never contested borders.",
    "Footer: one or two clean charts inside the navy bar.",
    `The main title, rendered as sharp white sans-serif typography on the navy header with zero spelling errors, must be exactly: "${brief.main_title}".`,
    labelsBlock,
    buildImageLanguageRule(lang),
    `Explicitly avoid: ${avoid}.`,
    PRODUCTION_STYLE_RULES,
    IMAGE_NEGATIVE_GUIDELINES,
  ].join(" ");
}

/**
 * Conservative fallback when the first attempt is blocked/empty.
 * Keeps only the core subject + fixed production rules.
 */
export function buildFallbackImagePrompt(
  briefOrSubject: VisualBrief | string,
  options: ImagePromptOptions = {},
): string {
  const brief =
    typeof briefOrSubject === "string"
      ? visualBriefFromSubject(briefOrSubject)
      : normalizeVisualBrief(briefOrSubject);
  const lang = resolveLanguage(options.language);
  const shortSubject = brief.visual_subject.split(/[.!?\n]/)[0].slice(0, 140);
  return (
    `A clean light-background corporate infographic about: ${shortSubject}. ` +
    `Navy header with main title exactly: "${brief.main_title}". ` +
    `Central isometric industrial process diagram, two icon side-cards, ` +
    `navy footer with a simple bar chart, muted gold accents, generous whitespace, no geopolitical maps. ` +
    `${buildImageLanguageRule(lang)} ` +
    PRODUCTION_STYLE_RULES
  );
}
