import {
  LanguageTagSchema,
  formatLanguageLabel,
} from "@research-video/contracts";

const suggestedLanguages = [
  ["ar", "Arabic"],
  ["bn", "Bengali"],
  ["de", "German"],
  ["dz", "Dzongkha"],
  ["en", "English"],
  ["es", "Spanish"],
  ["fa", "Persian"],
  ["fr", "French"],
  ["gu", "Gujarati"],
  ["he", "Hebrew"],
  ["hi", "Hindi"],
  ["id", "Indonesian"],
  ["it", "Italian"],
  ["ja", "Japanese"],
  ["km", "Khmer"],
  ["ko", "Korean"],
  ["lo", "Lao"],
  ["ms", "Malay"],
  ["my", "Burmese"],
  ["ne", "Nepali"],
  ["nl", "Dutch"],
  ["no", "Norwegian"],
  ["pa", "Punjabi"],
  ["pl", "Polish"],
  ["pt", "Portuguese"],
  ["ro", "Romanian"],
  ["ru", "Russian"],
  ["si", "Sinhala"],
  ["sv", "Swedish"],
  ["ta", "Tamil"],
  ["te", "Telugu"],
  ["th", "Thai"],
  ["tr", "Turkish"],
  ["uk", "Ukrainian"],
  ["ur", "Urdu"],
  ["vi", "Vietnamese"],
  ["zh", "Chinese"],
] as const;

export const suggestedSpokenLanguages = suggestedLanguages.map(
  ([value, name]) => ({
    value,
    label: `${name} (${value})`,
  }),
);

export function spokenLanguageChoiceLabel(value: string) {
  const normalized = normalizeSpokenLanguageChoice(value);
  if (!normalized) return value;
  const suggestion = suggestedSpokenLanguages.find(
    (candidate) => candidate.value === normalized,
  );
  return suggestion?.label ?? formatLanguageLabel(normalized);
}

export function normalizeSpokenLanguageChoice(value: string) {
  const parsed = LanguageTagSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
