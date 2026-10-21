// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Sounds } from "./audio.ts";
import { GameCanvas } from "./GameCanvas.tsx";
import { LanguageProvider } from "./i18n/provider.tsx";
import { Session } from "./session.ts";

vi.mock("@ccr/render", () => ({
  GameView: { create: async () => ({ resize: () => {}, dispose: () => {} }) },
}));

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(async () => {
  cleanup();
  // The stubbed frame never fires, so Preact flushes effects from its 35 ms fallback timer. Let it run
  // before the stubs and the jsdom window go away, or it throws in `cancelAnimationFrame` afterwards.
  await new Promise((resolve) => setTimeout(resolve, 80));
  vi.unstubAllGlobals();
});

it("keeps a model failure actionable in the game when both auxiliary windows are hidden", async () => {
  const session = new Session();
  const openSettings = vi.fn();
  const openDecisions = vi.fn();
  const view = render(
    <LanguageProvider initial={{ preference: "en", detected: "en" }}>
      <GameCanvas
        session={session}
        state={{ ...session.state(), error: "Offline during lookup" }}
        sounds={{} as Sounds}
        onRetry={vi.fn()}
        onNewMap={vi.fn()}
        onShowControls={openSettings}
        compass={{ on: false, conversationOpen: false, onConversation: openDecisions }}
      />
    </LanguageProvider>,
  );
  await waitFor(() =>
    expect(view.getByRole("alert").textContent).toContain("Something went wrong"),
  );
  expect(view.container.querySelector(".panel, .theater")).toBeNull();
  expect(view.queryByText("Offline during lookup")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Configure", exact: true }));
  fireEvent.click(view.getByRole("button", { name: "Details", exact: true }));
  expect(openSettings).toHaveBeenCalledOnce();
  expect(openDecisions).toHaveBeenCalledOnce();
});

function gameWith(extra: Partial<Parameters<typeof GameCanvas>[0]>) {
  const session = new Session();
  return (
    <LanguageProvider initial={{ preference: "en", detected: "en" }}>
      <GameCanvas
        session={session}
        state={session.state()}
        sounds={{} as Sounds}
        onRetry={vi.fn()}
        onNewMap={vi.fn()}
        compass={{ on: false, conversationOpen: false, onConversation: vi.fn() }}
        {...extra}
      />
    </LanguageProvider>
  );
}

it("hides and shows the browser settings from a button beside the game", () => {
  const toggleSettings = vi.fn();
  const toggleDecisions = vi.fn();
  const props = {
    onToggleControls: toggleSettings,
    onToggleDecisions: toggleDecisions,
    decisionsVisible: true,
  };
  const view = render(gameWith({ ...props, controlsVisible: true }));
  const hide = view.getByRole("button", { name: "Hide settings" });
  expect(hide.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(hide);
  expect(toggleSettings).toHaveBeenCalledOnce();
  fireEvent.click(view.getByRole("button", { name: "Hide decisions (T)" }));
  expect(toggleDecisions).toHaveBeenCalledOnce();

  view.rerender(gameWith({ ...props, controlsVisible: false }));
  expect(view.getByRole("button", { name: "Show settings" }).getAttribute("aria-pressed")).toBe(
    "false",
  );
});

it("keeps the desktop settings button a plain opener", () => {
  const openSettings = vi.fn();
  const view = render(gameWith({ onShowControls: openSettings }));
  const open = view.getByRole("button", { name: "Open controls window" });
  expect(open.hasAttribute("aria-pressed")).toBe(false);
  fireEvent.click(open);
  expect(openSettings).toHaveBeenCalledOnce();
  expect(view.queryByRole("button", { name: /decisions/i })).toBeNull();
});
