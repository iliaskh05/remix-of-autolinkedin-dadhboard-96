// Single source of truth for the global language selector. The same resolved
// profile drives the post copy (textPrompt) and the typography rendered inside
// the generated dashboard image (imagePrompt), so both always agree.

export type LanguageCode = "fr" | "en" | "es" | "ar";

export const DEFAULT_LANGUAGE_CODE: LanguageCode = "fr";

export type LanguageProfile = {
  /** English name used inside the AI prompts. */
  name: string;
  /** Endonym — helps the model lock onto the right variety. */
  nativeName: string;
  direction: "ltr" | "rtl";
  /** Orthography and typography rules that make the copy defect-free. */
  typography: string;
};

const PROFILES: Record<LanguageCode, LanguageProfile> = {
  fr: {
    name: "French",
    nativeName: "français",
    direction: "ltr",
    typography:
      "Use standard French typography: a narrow non-breaking space before « : », « ; », « ! » and « ? », " +
      "French quotation marks « … », the typographic apostrophe ’, accented capitals (À, É, Ê), " +
      "and lowercase after a colon. Respect gender/number agreement and verb conjugation strictly. " +
      "Avoid anglicisms when a common French business term exists (use « chaîne d’approvisionnement », not « supply chain », unless the English term is the industry standard).",
  },
  en: {
    name: "English",
    nativeName: "English",
    direction: "ltr",
    typography:
      "Use international business English as written by The Economist: curly apostrophes, " +
      "consistent comma usage, no double spaces, no title-case in sentences, and British/American spelling kept consistent within the post.",
  },
  es: {
    name: "Spanish",
    nativeName: "español",
    direction: "ltr",
    typography:
      "Use standard Spanish typography: opening ¿ and ¡ marks, correct accents (á, é, í, ó, ú) and ñ, " +
      "« » or “ ” quotation marks used consistently. Respect gender/number agreement and subjunctive usage. " +
      "Avoid literal calques from English.",
  },
  ar: {
    name: "Arabic",
    nativeName: "العربية",
    direction: "rtl",
    typography:
      "Use Modern Standard Arabic (الفصحى) written right-to-left: correct hamza forms (أ، إ، ء)، ta marbuta (ة)، " +
      "and alif maqsura (ى). Keep financial figures in Western Arabic numerals (0-9) with the unit spelled out in Arabic. " +
      "Do not transliterate terms that have an established Arabic equivalent, and never mix Latin script into a sentence " +
      "except for widely used tickers or company names.",
  },
};

// Older clients sent the English name ("French") instead of the code.
const ALIASES: Record<string, LanguageCode> = {
  fr: "fr", french: "fr", francais: "fr", français: "fr", "fr-fr": "fr",
  en: "en", english: "en", anglais: "en", "en-us": "en", "en-gb": "en",
  es: "es", spanish: "es", espanol: "es", español: "es", espagnol: "es",
  ar: "ar", arabic: "ar", arabe: "ar", "العربية": "ar",
};

/**
 * Accepts a code ("fr"), an English name ("French") or a legacy/unknown value.
 * Unknown non-empty values are kept verbatim as a free-form language name so an
 * older saved setting never silently switches the user to another language.
 */
export function resolveLanguage(raw: string | null | undefined): LanguageProfile {
  const value = (raw ?? "").trim();
  if (!value) return PROFILES[DEFAULT_LANGUAGE_CODE];

  const code = ALIASES[value.toLowerCase()];
  if (code) return PROFILES[code];

  return {
    name: value,
    nativeName: value,
    direction: "ltr",
    typography: `Follow the standard orthographic and typographic conventions of ${value}.`,
  };
}

/** Hard output-language rules injected into the post system prompt. */
export function buildTextLanguageRules(lang: LanguageProfile): string[] {
  return [
    `- Write the reader-facing output in ${lang.name} (${lang.nativeName}): the title, the post body, the hashtags, and the visual brief's main_title and key_labels. This is non-negotiable and overrides the language of the topic or of the reference material.`,
    "- The visual brief's technical description fields (setting, composition, mood, palette, avoid) stay in English — they are instructions for the image model, not reader-facing copy.",
    "- Never mix languages inside the post and never leave untranslated fragments. Proper nouns, tickers and established industry acronyms are the only exceptions.",
    `- ${lang.typography}`,
    `- If the reference material is written in another language, translate and adapt the insight into idiomatic ${lang.name} — never translate word for word.`,
  ];
}

/** Typography instruction for the text rendered inside the generated image. */
export function buildImageLanguageRule(lang: LanguageProfile): string {
  const script =
    lang.direction === "rtl"
      ? `Lay the typography out right-to-left with correctly connected and shaped ${lang.name} glyphs, ` +
        "and keep every label to two or three words so no character is malformed."
      : `Lay the typography out left-to-right with flawless ${lang.name} spelling, accents and diacritics.`;

  return (
    `Typography language: render the infographic header title and every card/chart label in ${lang.name} (${lang.nativeName}). ` +
    `${script} Keep all numeric values in Western Arabic numerals (0-9). ` +
    "Do not mix in another language, do not invent words, and do not add any text beyond the title and the approved labels."
  );
}
