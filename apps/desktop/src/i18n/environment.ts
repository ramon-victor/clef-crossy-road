import { browserStore } from "../storage.ts";
import {
  type LanguagePreference,
  type Locale,
  readPreference,
  savePreference,
  systemLocale,
} from "./locale.ts";

export interface LanguageEnvironment {
  detect(): Promise<Locale>;
  read(): LanguagePreference;
  save(preference: LanguagePreference): void;
}

export const languageEnvironment: LanguageEnvironment = {
  detect: systemLocale,
  read: () => readPreference(),
  save: (value) => savePreference(browserStore(), value),
};

export function setDocumentLanguage(locale: Locale): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = "ltr";
}

export async function initialLanguage(source = languageEnvironment) {
  const preference = source.read();
  const detected = await source.detect().catch(() => "en" as const);
  setDocumentLanguage(preference === "system" ? detected : preference);
  return { preference, detected };
}
