import { describe, it, expect } from "vitest";
import {
  resolveProvider,
  resolveProviderWithKey,
  ProviderResolveError,
  normalizeGoogleModel,
  normalizeGeminiImageModel,
  isSupportedImageModel,
  DEFAULT_IMAGE_MODEL_ID,
} from "@/lib/ai-provider";
import {
  appendImageOverlays,
  buildPrimaryAndFallbackPrompts,
  normalizeAspectRatio,
} from "@/lib/imageAssemble";
import { DEFAULT_IMAGE_MODEL, IMAGE_MODELS } from "@/lib/ai-models";

describe("provider routing regression", () => {
  it("Test A: BYOK + Gemini + key → gemini_direct (never Lovable)", () => {
    const full = resolveProviderWithKey(
      { use_byok: true, gemini_api_key: "AIza-test" },
      "google/gemini-2.5-flash-image",
      "image",
      { lovableApiKey: "lovable-must-not-be-used" },
    );
    expect(full.execution).toBe("gemini_direct");
    expect(full.isByok).toBe(true);
    expect(full.apiKey).toBe("AIza-test");
    expect(full.apiKey).not.toMatch(/lovable/i);
  });

  it("Test B: BYOK + Gemini + missing key → BYOK_MISSING_GEMINI_KEY", () => {
    try {
      resolveProviderWithKey(
        { use_byok: true, gemini_api_key: null },
        "google/gemini-2.5-flash-image",
        "image",
        { lovableApiKey: "lovable-x" },
      );
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderResolveError);
      expect((e as ProviderResolveError).code).toBe("BYOK_MISSING_GEMINI_KEY");
    }
  });

  it("Test C: BYOK OFF + Gemini → lovable_gateway", () => {
    const full = resolveProviderWithKey(
      { use_byok: false, gemini_api_key: "AIza-ignored" },
      "google/gemini-2.5-flash-image",
      "image",
      { lovableApiKey: "lovable-key" },
    );
    expect(full.execution).toBe("lovable_gateway");
    expect(full.isByok).toBe(false);
    expect(full.apiKey).toBe("lovable-key");
  });

  it("Test D: BYOK + OpenAI + key → openai_direct", () => {
    const full = resolveProviderWithKey(
      { use_byok: true, openai_api_key: "sk-test" },
      "openai/gpt-5-mini",
      "text",
    );
    expect(full.execution).toBe("openai_direct");
    expect(full.normalizedModel).toBe("gpt-5-mini");
  });
});

describe("model normalization", () => {
  it("normalizeGoogleModel strips only google/ prefix", () => {
    expect(normalizeGoogleModel("google/gemini-2.5-flash-image")).toBe("gemini-2.5-flash-image");
    expect(normalizeGoogleModel("gemini-2.5-flash-image")).toBe("gemini-2.5-flash-image");
    expect(normalizeGoogleModel("openai/gpt-5")).toBe("openai/gpt-5");
  });

  it("normalizeGeminiImageModel maps known aliases without inventing families", () => {
    expect(normalizeGeminiImageModel("google/gemini-2.5-flash-image")).toBe("gemini-2.5-flash-image");
    expect(normalizeGeminiImageModel("google/gemini-3-pro-image")).toBe("gemini-3-pro-image");
    expect(normalizeGeminiImageModel("google/gemini-3.1-flash-image")).toBe("gemini-3.1-flash-image");
    expect(normalizeGeminiImageModel("google/gemini-3-pro-image-preview")).toBe("gemini-3-pro-image");
  });

  it("UI default is the stable GA Flash Image model", () => {
    expect(DEFAULT_IMAGE_MODEL).toBe("google/gemini-2.5-flash-image");
    expect(DEFAULT_IMAGE_MODEL_ID).toBe(DEFAULT_IMAGE_MODEL);
    expect(IMAGE_MODELS.every((m) => isSupportedImageModel(m.value))).toBe(true);
  });

  it("rejects unknown image models", () => {
    expect(isSupportedImageModel("google/gemini-made-up-image")).toBe(false);
    expect(() =>
      resolveProvider({ use_byok: true, gemini_api_key: "AIza" }, "google/gemini-made-up-image", "image"),
    ).toThrow(/not supported/);
  });
});

describe("image generation request construction", () => {
  const payload = {
    prompt: "Oil prices rise after unexpected supply disruption",
    aspectRatio: "4:5",
    style: "Editorial",
    mood: "Urgent",
    colors: ["black", "white", "red"],
    textOverlay: { text: "OIL PRICES SURGE", position: "center", weight: "bold" },
    wordmark: { text: "MARKET PULSE", position: "bottom-center" },
    bottomMarginPercent: 12,
    language: "en",
  };

  it("preserves aspectRatio 4:5 (never remaps to 1:1)", () => {
    expect(normalizeAspectRatio(payload.aspectRatio)).toBe("4:5");
    expect(normalizeAspectRatio("4:5 portrait, mobile-optimized")).toBe("4:5");
    expect(normalizeAspectRatio("1:1 square")).toBe("1:1");
  });

  it("primary and fallback prompts both keep textOverlay, wordmark, style, mood, colors, aspect", () => {
    const overlays = {
      aspectRatio: normalizeAspectRatio(payload.aspectRatio),
      language: payload.language,
      style: payload.style,
      mood: payload.mood,
      colors: payload.colors,
      textOverlay: payload.textOverlay,
      wordmark: payload.wordmark,
      margin: payload.bottomMarginPercent,
    };

    const { primary, fallback } = buildPrimaryAndFallbackPrompts(
      `PRIMARY_BASE about: ${payload.prompt}`,
      `FALLBACK_BASE about: ${payload.prompt}`,
      overlays,
    );

    for (const prompt of [primary, fallback]) {
      expect(prompt).toContain("Aspect ratio: 4:5.");
      expect(prompt).toContain("Editorial");
      expect(prompt).toContain("Urgent");
      expect(prompt).toContain("black, white, red");
      expect(prompt).toContain('"OIL PRICES SURGE"');
      expect(prompt).toContain('"MARKET PULSE"');
      expect(prompt).toContain("12%");
      // Exact user text must not be rewritten/summarized
      expect(prompt).not.toContain("oil prices surge"); // case-sensitive exact quote above
    }

    expect(primary).toContain("PRIMARY_BASE");
    expect(fallback).toContain("FALLBACK_BASE");
    expect(appendImageOverlays("base", overlays)).toContain('"OIL PRICES SURGE"');
  });
});
