import { createInstance } from "i18next";
import type { Locale } from "./locale.ts";
import { de } from "./locales/de.ts";
import { en } from "./locales/en.ts";
import { es } from "./locales/es.ts";
import { fr } from "./locales/fr.ts";
import { ja } from "./locales/ja.ts";
import { ptBR } from "./locales/pt-BR.ts";
import { zhHans } from "./locales/zh-Hans.ts";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "ui";
    keySeparator: false;
    enableSelector: false;
    strictKeyChecks: true;
    resources: { ui: typeof en };
  }
}

export const catalogs = { en, "pt-BR": ptBR, es, fr, de, ja, "zh-Hans": zhHans };

const engine = createInstance();
void engine.init({
  resources: Object.fromEntries(Object.entries(catalogs).map(([locale, ui]) => [locale, { ui }])),
  lng: "en",
  fallbackLng: "en",
  supportedLngs: Object.keys(catalogs),
  defaultNS: "ui",
  ns: ["ui"],
  keySeparator: false,
  initAsync: false,
  returnEmptyString: false,
  interpolation: { escapeValue: false },
});

function createTranslator(locale: Locale) {
  const numbers = new Map<string, Intl.NumberFormat>();
  const number = (value: number, options: Intl.NumberFormatOptions = {}): string => {
    const key = JSON.stringify(options);
    let formatter = numbers.get(key);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, options);
      numbers.set(key, formatter);
    }
    return formatter.format(value);
  };
  return {
    locale,
    t: engine.getFixedT(locale, "ui"),
    number,
    percent: (value: number | undefined) =>
      value === undefined ? "–" : number(value, { style: "percent", maximumFractionDigits: 0 }),
    ms: (value: number | null | undefined) =>
      value == null
        ? "–"
        : number(Math.round(value), { style: "unit", unit: "millisecond", unitDisplay: "short" }),
  };
}

export type Translator = ReturnType<typeof createTranslator>;
const translators = new Map<Locale, Translator>();

export function translator(locale: Locale): Translator {
  let value = translators.get(locale);
  if (!value) {
    value = createTranslator(locale);
    translators.set(locale, value);
  }
  return value;
}
