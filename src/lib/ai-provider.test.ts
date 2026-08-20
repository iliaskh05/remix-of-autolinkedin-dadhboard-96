import { describe, it, expect } from "vitest";
import {
  resolveProvider,
  resolveApiKey,
  resolveProviderWithKey,
  ProviderResolveError,
  describeRoutingStatus,
  normalizeGeminiImageModel,
  normalizeGeminiTextModel,
} from "@/lib/ai-provider";

describe("ai-provider resolver", () => {
  it("routes Gemini text to direct API when BYOK + key", () => {
    const route = resolveProvider(
      { use_byok: true, gemini_api_key: "AIza-test" },
      "google/gemini-2.5-flash",
      "text",
    );
    expect(route.execution).toBe("gemini_direct");
    expect(route.isByok).toBe(true);
    expect(route.normalizedModel).toBe("gemini-2.5-flash");
    expect(resolveApiKey(route, { use_byok: true, gemini_api_key: "AIza-test" })).toBe("AIza-test");
  });

  it("routes Gemini image to direct API when BYOK + key (never Lovable)", () => {
    const full = resolveProviderWithKey(
      { use_byok: true, gemini_api_key: "AIza-img" },
      "google/gemini-3-pro-image",
      "image",
      { lovableApiKey: "lovable-should-not-be-used" },
    );
    expect(full.execution).toBe("gemini_direct");
    expect(full.apiKey).toBe("AIza-img");
    expect(full.apiKey).not.toContain("lovable");
  });

  it("uses workspace GEMINI_API_KEY when BYOK on and user key empty", () => {
    const full = resolveProviderWithKey(
      { use_byok: true, gemini_api_key: null },
      "google/gemini-2.5-flash",
      "text",
      { geminiApiKey: "AIza-env", lovableApiKey: "lovable-x" },
    );
    expect(full.execution).toBe("gemini_direct");
    expect(full.apiKey).toBe("AIza-env");
  });

  it("errors when BYOK on and Gemini key missing (no silent Lovable fallback)", () => {
    expect(() =>
      resolveProviderWithKey(
        { use_byok: true, gemini_api_key: "" },
        "google/gemini-3-pro-image",
        "image",
        { lovableApiKey: "lovable-x" },
      ),
    ).toThrow(ProviderResolveError);

    try {
      resolveProviderWithKey(
        { use_byok: true },
        "google/gemini-3-pro-image",
        "image",
        { lovableApiKey: "lovable-x" },
      );
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderResolveError);
      expect((e as ProviderResolveError).code).toBe("BYOK_MISSING_GEMINI_KEY");
    }
  });

  it("routes OpenAI text to direct API when BYOK + key", () => {
    const full = resolveProviderWithKey(
      { use_byok: true, openai_api_key: "sk-test" },
      "openai/gpt-5-mini",
      "text",
    );
    expect(full.execution).toBe("openai_direct");
    expect(full.normalizedModel).toBe("gpt-5-mini");
    expect(full.apiKey).toBe("sk-test");
  });

  it("errors when BYOK on and OpenAI key missing", () => {
    expect(() =>
      resolveProviderWithKey({ use_byok: true }, "openai/gpt-5", "text", { lovableApiKey: "x" }),
    ).toThrow(/OpenAI API key is missing/);
  });

  it("routes to Lovable when BYOK is off", () => {
    const full = resolveProviderWithKey(
      { use_byok: false, gemini_api_key: "AIza-ignored" },
      "google/gemini-2.5-flash",
      "text",
      { lovableApiKey: "lovable-key" },
    );
    expect(full.execution).toBe("lovable_gateway");
    expect(full.isByok).toBe(false);
    expect(full.apiKey).toBe("lovable-key");
    expect(full.normalizedModel).toBe("google/gemini-2.5-flash");
  });

  it("routes image to Lovable when BYOK is off", () => {
    const full = resolveProviderWithKey(
      { use_byok: false },
      "google/gemini-3-pro-image",
      "image",
      { lovableApiKey: "lovable-img" },
    );
    expect(full.execution).toBe("lovable_gateway");
    expect(full.apiKey).toBe("lovable-img");
  });

  it("errors when BYOK off and Lovable key missing", () => {
    expect(() =>
      resolveProviderWithKey({ use_byok: false }, "google/gemini-2.5-flash", "text", {}),
    ).toThrow(/Lovable AI Gateway is not configured/);
  });

  it("rejects OpenAI models for image capability", () => {
    expect(() =>
      resolveProvider({ use_byok: true, openai_api_key: "sk" }, "openai/gpt-5", "image"),
    ).toThrow(/not supported/);
  });

  it("normalizes Gemini model aliases", () => {
    expect(normalizeGeminiTextModel("google/gemini-3-flash-preview")).toBe("gemini-2.5-flash");
    expect(normalizeGeminiImageModel("google/gemini-3-pro-image-preview")).toBe("gemini-3-pro-image");
  });

  it("describes routing status for UI", () => {
    expect(describeRoutingStatus({ use_byok: false }).mode).toBe("lovable");
    expect(describeRoutingStatus({ use_byok: true, gemini_api_key: "AIza" }).mode).toBe("byok");
    expect(describeRoutingStatus({ use_byok: true, gemini_api_key: "AIza" }).description).toMatch(/not consume Lovable/i);
  });
});
