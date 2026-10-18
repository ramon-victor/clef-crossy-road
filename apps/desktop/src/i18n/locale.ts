import { browserStore, type KeyValueStore, readSetting, writeSetting } from "../storage.ts";
export const LOCALES = ["en", "pt-BR", "es", "fr", "de", "ja", "zh-Hans"] as const;
export type Locale = (typeof LOCALES)[number];
export type LanguagePreference = Locale | "system";

export const LANGUAGE_NAMES: Readonly<Record<Locale, string>> = {
  en: "English",
  "pt-BR": "Português (Brasil)",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  ja: "日本語",
  "zh-Hans": "简体中文",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && LOCALES.some((locale) => locale === value);
}

export function resolveLocale(tag: string | null | undefined): Locale {
  if (!tag) return "en";
  try {
    const locale = new Intl.Locale(tag);
    if (locale.language === "pt") return "pt-BR";
    if (locale.language === "zh") return locale.maximize().script === "Hans" ? "zh-Hans" : "en";
    return isLocale(locale.language) ? locale.language : "en";
  } catch {
    return "en";
  }
}

export const LANGUAGE_STORAGE_KEY = "ccr.locale";

export function readPreference(
  storage: Pick<KeyValueStore, "getItem"> | null = browserStore(),
): LanguagePreference {
  const value = readSetting(LANGUAGE_STORAGE_KEY, storage);
  return isLocale(value) ? value : "system";
}

export function savePreference(
  storage: Pick<KeyValueStore, "setItem"> | null,
  preference: LanguagePreference,
): void {
  writeSetting(LANGUAGE_STORAGE_KEY, preference, storage);
}

export async function systemLocale(): Promise<Locale> {
  if ("__TAURI_INTERNALS__" in window) {
    try {
      const { locale } = await import("@tauri-apps/plugin-os");
      return resolveLocale(await locale());
    } catch {
      return "en";
    }
  }
  return resolveLocale(navigator.languages[0] ?? navigator.language);
}
