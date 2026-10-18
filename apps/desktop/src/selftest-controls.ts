import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LANGUAGE_STORAGE_KEY } from "./i18n/locale.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Inspect the other webview's DOM only in an explicitly enabled, cache-only native self-test. */
export async function runControlsSelfTest(): Promise<() => void> {
  if (!(await invoke<boolean>("selftest_enabled"))) return () => {};
  let savedLanguage: { preference: string; stored: string | null } | null = null;
  return getCurrentWindow().listen<{ id: string; action: string }>(
    "selftest:controls",
    ({ payload }) => {
      void (async () => {
        let report: Record<string, unknown> = {};
        if (payload.action === "language" || payload.action === "restore-language") {
          const select = document.querySelector<HTMLSelectElement>("#language");
          if (!select) throw new Error("Language selector is unavailable");
          if (payload.action === "language") {
            savedLanguage = {
              preference: select.value,
              stored: localStorage.getItem(LANGUAGE_STORAGE_KEY),
            };
            select.value = document.documentElement.lang === "ja" ? "pt-BR" : "ja";
          } else if (savedLanguage) {
            select.value = savedLanguage.preference;
          }
          select.dispatchEvent(new Event("change", { bubbles: true }));
          await sleep(150);
          if (payload.action === "restore-language" && savedLanguage) {
            if (savedLanguage.stored === null) localStorage.removeItem(LANGUAGE_STORAGE_KEY);
            else localStorage.setItem(LANGUAGE_STORAGE_KEY, savedLanguage.stored);
            savedLanguage = null;
          }
          report = { language: document.documentElement.lang };
        } else if (payload.action === "settings") {
          const setup = document.querySelector<HTMLDetailsElement>("details.setup");
          if (setup) setup.open = true;
          document.querySelector<HTMLButtonElement>(".connection-setting button")?.click();
          for (let i = 0; i < 30 && !document.querySelector(".connection-dialog"); i++)
            await sleep(100);
          const account = document.querySelector<HTMLInputElement>("#cloudflare-account");
          const token = document.querySelector<HTMLInputElement>("#cloudflare-token");
          for (const input of [account, token]) {
            if (!input) continue;
            input.value = "selftest-unsaved";
            input.dispatchEvent(new Event("input", { bubbles: true }));
          }
          report = { opened: !!account && !!token };
        } else {
          report = {
            panelPresent: document.querySelector(".panel") !== null,
            canvasAbsent: document.querySelector("canvas.game") === null,
            settingsClosed: document.querySelector(".connection-dialog") === null,
            inspectorClosed: document.querySelector(".inspector") === null,
            player: document.querySelector<HTMLSelectElement>("#player")?.value,
            paused:
              document.querySelector(".controls button")?.getAttribute("aria-pressed") === "true",
            conversationAbsent: document.querySelector(".theater") === null,
            language: document.documentElement.lang,
          };
        }
        await emitTo("main", "selftest:controls-result", { id: payload.id, report });
      })().catch(() => {});
    },
  );
}
