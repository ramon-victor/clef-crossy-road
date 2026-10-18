import { emit, listen } from "@tauri-apps/api/event";
import { isTauri } from "../bridge/tauri.ts";
import { browserStore } from "../storage.ts";
import {
  isLocale,
  LANGUAGE_STORAGE_KEY,
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
  subscribe?(onChange: (preference: LanguagePreference) => void): () => void;
}

const LANGUAGE_EVENT = "language:changed";

/** Storage events cover browser tabs; Tauri events also work across separate native webviews. */
function subscribeLanguage(onChange: (preference: LanguagePreference) => void): () => void {
  const receive = (value: unknown) => {
    if (value === "system" || isLocale(value)) onChange(value);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === LANGUAGE_STORAGE_KEY || event.key === null) receive(readPreference());
  };
  window.addEventListener("storage", onStorage);
  let disposed = false;
  let stop = () => {};
  if (isTauri()) {
    void listen<unknown>(LANGUAGE_EVENT, ({ payload }) => receive(payload))
      .then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      })
      .catch(() => {});
  }
  return () => {
    disposed = true;
    stop();
    window.removeEventListener("storage", onStorage);
  };
}

export const languageEnvironment: LanguageEnvironment = {
  detect: systemLocale,
  read: () => readPreference(),
  save: (value) => {
    savePreference(browserStore(), value);
    if (isTauri()) void emit(LANGUAGE_EVENT, value).catch(() => {});
  },
  subscribe: subscribeLanguage,
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
