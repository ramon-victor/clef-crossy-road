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
  fireEvent.click(view.getByRole("button", { name: "Technical details", exact: true }));
  expect(openSettings).toHaveBeenCalledOnce();
  expect(openDecisions).toHaveBeenCalledOnce();
});
