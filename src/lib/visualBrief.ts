/** Mirrors the Edge Function `VisualBrief` used for two-layer image prompts. */
export type VisualBrief = {
  visual_subject: string;
  setting: string;
  composition: string;
  mood: string;
  palette: string[];
  avoid: string[];
  main_title: string;
  key_labels: string[];
};

export function isVisualBrief(value: unknown): value is VisualBrief {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.visual_subject === "string" && v.visual_subject.trim().length > 0;
}

/** Compact preview shown in the Composer textarea (no server guardrails). */
export function summarizeVisualBrief(brief: VisualBrief): string {
  const palette = brief.palette?.length ? brief.palette.join(", ") : "dark charcoal, white, amber";
  const labels = brief.key_labels?.length ? ` Labels: ${brief.key_labels.join(" | ")}.` : "";
  const title = brief.main_title?.trim() ? `Title: "${brief.main_title}". ` : "";
  return [
    `${title}${brief.visual_subject}`,
    `Setting: ${brief.setting}.`,
    `Composition: ${brief.composition}.`,
    `Mood: ${brief.mood}.`,
    `Palette: ${palette}.${labels}`,
  ].join(" ");
}
