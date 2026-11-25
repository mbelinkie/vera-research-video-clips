import { describe, expect, it } from "vitest";

import {
  normalizeSpokenLanguageChoice,
  spokenLanguageChoiceLabel,
  suggestedSpokenLanguages,
} from "./spoken-language-choice.ts";

describe("spoken language choice", () => {
  it("normalizes explicit BCP-47 input without inventing an empty default", () => {
    expect(normalizeSpokenLanguageChoice(" zh_hant_tw ")).toBe("zh-Hant-TW");
    expect(normalizeSpokenLanguageChoice("dz")).toBe("dz");
    expect(normalizeSpokenLanguageChoice("")).toBeUndefined();
    expect(normalizeSpokenLanguageChoice("?")).toBeUndefined();
  });

  it("offers readable suggestions while keeping arbitrary tags valid", () => {
    expect(suggestedSpokenLanguages).toContainEqual({
      value: "dz",
      label: "Dzongkha (dz)",
    });
    expect(suggestedSpokenLanguages).toContainEqual({
      value: "en",
      label: "English (en)",
    });
    expect(spokenLanguageChoiceLabel("dz")).toBe("Dzongkha (dz)");
    expect(normalizeSpokenLanguageChoice("haw")).toBe("haw");
  });
});
