// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Sounds } from "./audio.ts";
import { GameCanvas } from "./GameCanvas.tsx";
import { LanguageProvider } from "./i18n/provider.tsx";
import { Session } from "./session.ts";
import { answeredSession, routeAnswers } from "./theater/test-support.ts";

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
afterEach(() => {
  cleanup();
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

it("shows pause once in the caption, restores the plain notice when hidden, and opens Details", async () => {
  const session = await answeredSession(routeAnswers("stand", "still", "wait_here"), 1);
  session.setPaused(true);
  const open = vi.fn();
  const ui = (on: boolean) => (
    <LanguageProvider initial={{ preference: "en", detected: "en" }}>
      <GameCanvas
        session={session}
        state={session.state()}
        sounds={{} as Sounds}
        onRetry={vi.fn()}
        onNewMap={vi.fn()}
        compass={{ on, conversationOpen: false, onConversation: open }}
      />
    </LanguageProvider>
  );
  const screen = render(ui(true));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Paused · Space to resume"),
  );
  expect(screen.container.querySelector(".compass-caption")).not.toBeNull();
  expect(screen.container.querySelector(".paused-note")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  expect(open).toHaveBeenCalledOnce();
  screen.rerender(ui(false));
  expect(screen.container.querySelector(".compass-caption")).toBeNull();
  expect(screen.container.querySelector(".paused-note")?.textContent).toBe(
    "Paused · Space to resume",
  );
});
