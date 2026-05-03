// Image preferences shared between Image Studio (editor) and Composer (consumer).
// Stored in localStorage so generation in Composer always uses the user's saved style.

export type TextOverlay = {
  text: string;
  position: string;
  weight: string;
  color: string;
};

export type Wordmark = {
  text: string;
  position: string;
};

export type ImagePrefs = {
  aspectRatio: string;
  style: string;
  mood: string;
  colors: string[];
  bottomMarginPercent: number;
  textOverlay?: TextOverlay;
  wordmark?: Wordmark;
};

export const DEFAULT_PREFS: ImagePrefs = {
  aspectRatio: "1:1 square, perfect for LinkedIn feed",
  style: "modern editorial, clean composition, premium feel",
  mood: "professional and confident",
  colors: ["#0A66C2", "#FFFFFF"],
  bottomMarginPercent: 0,
};

export const PREFS_KEY = "image-studio-prefs";
export const PRESETS_KEY = "image-studio-presets";
export const FAV_KEY = "image-studio-favorites";

export function loadPrefs(): ImagePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch { /* noop */ }
  return DEFAULT_PREFS;
}

export function savePrefs(p: ImagePrefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(p));
}

export type Preset = { name: string; prefs: ImagePrefs };

export function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* noop */ }
  return [];
}

export function savePresets(p: Preset[]) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(p));
}
