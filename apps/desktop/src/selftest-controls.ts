import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Inspect the other webview's DOM only in an explicitly enabled, cache-only native self-test. */
export async function runControlsSelfTest(): Promise<() => void> {
  if (!(await invoke<boolean>("selftest_enabled"))) return () => {};
  return getCurrentWindow().listen<{ id: string; action: string }>(
    "selftest:controls",
    ({ payload }) => {
      void (async () => {
        const text = (selector: string) => document.querySelector(selector)?.textContent ?? "";
        let report: Record<string, unknown> = {};
        if (payload.action === "inspector") {
          const opened = document.querySelector(".inspector") !== null;
          const state = text(".inspector-pre");
          const click = (label: string) =>
            [...document.querySelectorAll<HTMLButtonElement>(".inspector-tabs button")]
              .find((b) => b.textContent === label)
              ?.click();
          click("Question");
          await sleep(100);
          const question = text(".inspector-pre");
          click("Options");
          await sleep(100);
          const options = text(".inspector-body");
          const close = [
            ...document.querySelectorAll<HTMLButtonElement>(".inspector-actions button"),
          ].find((b) => b.textContent === "Close");
          close?.click();
          await sleep(100);
          report = {
            opened,
            inControlsWindow: getCurrentWindow().label === "controls",
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
            paused: text(".controls button").includes("Resume"),
          };
        }
        await emitTo("main", "selftest:controls-result", { id: payload.id, report });
      })().catch(() => {});
    },
  );
}
