import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Only the explicitly enabled, cache-only native self-test may inspect this webview's DOM. */
export async function runDecisionsSelfTest(): Promise<() => void> {
  if (!(await invoke<boolean>("selftest_enabled"))) return () => {};
  return getCurrentWindow().listen<{ id: string; action: string }>(
    "selftest:decisions",
    ({ payload }) => {
      void (async () => {
        const current = getCurrentWindow();
        const text = (selector: string) => document.querySelector(selector)?.textContent ?? "";
        let report: Record<string, unknown>;
        if (payload.action === "inspector") {
          const opened = document.querySelector(".inspector") !== null;
          const state = text(".inspector-pre");
          const click = (tab: string) =>
            document.querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`)?.click();
          click("question");
          await sleep(100);
          const question = text(".inspector-pre");
          click("options");
          await sleep(100);
          const options = text(".inspector-body");
          document.querySelector<HTMLButtonElement>('[data-action="close-inspector"]')?.click();
          await sleep(100);
          document.querySelector<HTMLButtonElement>(".back-to-live")?.click();
          report = {
            opened,
            inDecisionsWindow: current.label === "decisions",
            inline: document.querySelector('[role="dialog"]') === null,
            stateHasRows: state.includes('"cross_ahead"') && state.includes('"detour_left"'),
            stateChars: state.length,
            questionHasRules: question.includes("chicken"),
            optionsListMoves: [
              "stand",
              "no_stand",
              "moving",
              "still",
              "detour_left",
              "detour_right",
              "wait_here",
            ].every((m) => options.includes(m)),
            closedAgain: document.querySelector(".inspector") === null,
            ...(state ? {} : { contentSkipped: "No model request in the local cache" }),
          };
        } else if (payload.action === "pause") {
          document.querySelector<HTMLButtonElement>(".theater-pause")?.click();
          await sleep(250);
          report = {
            paused:
              document.querySelector(".theater-pause")?.getAttribute("aria-pressed") === "true",
          };
        } else {
          if (payload.action === "now") {
            document.querySelector<HTMLButtonElement>(".back-to-live")?.click();
            document.querySelector<HTMLButtonElement>('[data-view="now"]')?.click();
            await sleep(100);
          }
          const footer = document.querySelector(".decision-footer")?.getBoundingClientRect();
          report = {
            viewport: [window.innerWidth, window.innerHeight],
            noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
            contentFits: [
              ...document.querySelectorAll(".theater button, .decision-intent, .inspector"),
            ].every((node) => {
              const bounds = node.getBoundingClientRect();
              return bounds.left >= 0 && bounds.right <= window.innerWidth + 1;
            }),
            canvasAbsent: document.querySelector("canvas.game") === null,
            panelAbsent: document.querySelector(".panel") === null,
            language: document.documentElement.lang,
            conversation: {
              startsAtTop: document.querySelector(".decision-content")?.scrollTop === 0,
              shown: (await current.isVisible()) && !(await current.isMinimized()),
              readable: [...document.querySelectorAll(".decision-now")].every(
                (node) => getComputedStyle(node).opacity === "1",
              ),
              diagram: document.querySelector(".decision-scene svg") !== null,
              action: text(".decision-action h3"),
              intent: text(".decision-intent strong"),
              primaryFits: [
                ...document.querySelectorAll(".decision-action, .decision-intent"),
              ].every((node) => node.getBoundingClientRect().bottom <= (footer?.top ?? 0)),
              tabs: document.querySelectorAll('[role="tab"]').length,
            },
          };
        }
        await emitTo("main", "selftest:decisions-result", { id: payload.id, report });
      })().catch(() => {});
    },
  );
}
