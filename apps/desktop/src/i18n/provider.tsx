import { type ComponentChildren, createContext } from "preact";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import {
  type LanguageEnvironment,
  languageEnvironment,
  setDocumentLanguage,
} from "./environment.ts";
import type { LanguagePreference, Locale } from "./locale.ts";
import { type Translator, translator } from "./translate.ts";

interface LanguageContext extends Translator {
  preference: LanguagePreference;
  detected: Locale;
  select(preference: LanguagePreference): void;
}

const Context = createContext<LanguageContext | null>(null);

export function LanguageProvider({
  children,
  initial,
  source = languageEnvironment,
}: {
  children: ComponentChildren;
  initial: { preference: LanguagePreference; detected: Locale };
  source?: LanguageEnvironment;
}) {
  const [preference, setPreference] = useState(initial.preference);
  const [detected, setDetected] = useState(initial.detected);
  const preferenceRef = useRef(preference);
  const revision = useRef(0);
  const locale = preference === "system" ? detected : preference;
  const translation = useMemo(() => translator(locale), [locale]);

  const refresh = useCallback(async () => {
    if (preferenceRef.current !== "system") return;
    const request = ++revision.current;
    const next = await source.detect().catch(() => "en" as const);
    if (request === revision.current && preferenceRef.current === "system") setDetected(next);
  }, [source]);

  const select = useCallback(
    (value: LanguagePreference) => {
      ++revision.current;
      preferenceRef.current = value;
      setPreference(value);
      source.save(value);
      if (value === "system") void refresh();
    },
    [source, refresh],
  );

  useLayoutEffect(() => {
    setDocumentLanguage(locale);
  }, [locale]);

  useEffect(() => {
    const update = () => void refresh();
    window.addEventListener("focus", update);
    window.addEventListener("languagechange", update);
    return () => {
      ++revision.current;
      window.removeEventListener("focus", update);
      window.removeEventListener("languagechange", update);
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ ...translation, preference, detected, select }),
    [translation, preference, detected, select],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useI18n(): LanguageContext {
  const value = useContext(Context);
  if (!value) throw new Error("useI18n requires LanguageProvider");
  return value;
}
