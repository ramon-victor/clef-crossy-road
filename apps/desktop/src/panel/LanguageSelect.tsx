import { isLocale, LANGUAGE_NAMES, LOCALES } from "../i18n/locale.ts";
import { useI18n } from "../i18n/provider.tsx";

export function LanguageSelect() {
  const { t, preference, detected, select } = useI18n();
  return (
    <>
      <label class="field-label" for="language">
        {t("language.label")}
      </label>
      <select
        id="language"
        class="select"
        value={preference}
        onChange={(event) => {
          const value = event.currentTarget.value;
          if (value === "system" || isLocale(value)) select(value);
        }}
      >
        <option value="system">
          {t("language.system", { language: LANGUAGE_NAMES[detected] })}
        </option>
        {LOCALES.map((locale) => (
          <option key={locale} value={locale} lang={locale}>
            {LANGUAGE_NAMES[locale]}
          </option>
        ))}
      </select>
    </>
  );
}
