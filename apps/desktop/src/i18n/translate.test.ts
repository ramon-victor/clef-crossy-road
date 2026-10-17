import { describe, expect, it } from "vitest";
import { LOCALES, readPreference, resolveLocale, savePreference } from "./locale.ts";
import { catalogs, translator } from "./translate.ts";

const placeholders = (message: string) =>
  [...message.matchAll(/{{\s*([^},]+)/g)].map((match) => match[1]?.trim()).sort();

describe("translation catalogs", () => {
  it.each(LOCALES)("%s contains all messages, variables and plural categories", (locale) => {
    const catalog = catalogs[locale];
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(catalogs.en).sort());
    for (const key of Object.keys(catalog) as (keyof typeof catalog)[]) {
      expect(catalog[key].trim(), key).not.toBe("");
      expect(placeholders(catalog[key]), key).toEqual(placeholders(catalogs.en[key]));
      if (key.endsWith("_other")) {
        for (const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories) {
          expect(catalog, `${key}: ${category}`).toHaveProperty(`${key.slice(0, -6)}_${category}`);
        }
      }
    }
  });

  it("uses local number and plural rules, including invariant Japanese and Chinese counters", () => {
    expect(translator("pt-BR").number(1234.5)).toBe("1.234,5");
    expect(translator("de").number(0.5)).toBe("0,5");
    expect(translator("fr").percent(0.46)).toMatch(/^46\s%$/u);
    expect(translator("en").t("game.rows", { count: 1, best: 2 })).toBe("1 row crossed · best 2");
    expect(translator("pt-BR").t("game.rows", { count: 2, best: 2 })).toContain(
      "2 linhas atravessadas",
    );
    for (const count of [0, 1, 2, 1_000_000]) {
      expect(translator("ja").t("inspect.images", { count })).toContain("枚");
      expect(translator("zh-Hans").t("inspect.images", { count })).toContain("张图片");
    }
    expect(translator("en").ms(null)).toBe("–");
    expect(translator("ja").percent(undefined)).toBe("–");
  });

  it("keeps fixed translators independent", () => {
    const english = translator("en");
    const portuguese = translator("pt-BR");
    expect(portuguese.t("common.close")).toBe("Fechar");
    expect(english.t("common.close")).toBe("Close");
  });
});

describe("system language matching", () => {
  it.each([
    ["en-GB", "en"],
    ["pt-PT", "pt-BR"],
    ["pt-BR", "pt-BR"],
    ["es-MX", "es"],
    ["fr-CA", "fr"],
    ["de-AT", "de"],
    ["ja-JP", "ja"],
    ["zh-CN", "zh-Hans"],
    ["zh-SG", "zh-Hans"],
    ["zh-Hans-HK", "zh-Hans"],
    ["zh", "zh-Hans"],
    ["zh-Hant", "en"],
    ["zh-TW", "en"],
    ["zh-HK", "en"],
    ["ru-RU", "en"],
    ["ar", "en"],
    ["pt_BR", "en"],
    ["", "en"],
    [null, "en"],
  ])("resolves %s to %s", (tag, expected) => expect(resolveLocale(tag)).toBe(expected));

  it("ignores corrupt preferences and tolerates unavailable storage", () => {
    for (const value of [null, "xx", "{}", "system"])
      expect(readPreference({ getItem: () => value })).toBe("system");
    expect(readPreference({ getItem: () => "ja" })).toBe("ja");
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readPreference(blocked)).toBe("system");
    expect(() => savePreference(blocked, "de")).not.toThrow();
  });
});
