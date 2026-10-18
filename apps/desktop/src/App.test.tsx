// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { showControls } from "./bridge/windows.ts";
import { LanguageProvider } from "./i18n/provider.tsx";
import type { SessionState } from "./session.ts";

const runtime = vi.hoisted(() => ({
  bridge: {
    kind: "tauri" as const,
    run: vi.fn(async () => {
      throw new Error("No API request allowed");
    }),
    cacheGet: vi.fn(async () => null),
    cachePut: vi.fn(async () => {}),
    budget: vi.fn(async () => ({ spent: 0, limit: 10000, day: "2026-10-18" })),
    credentialStatus: vi.fn(async () => ({ configured: false })),
    saveCredentials: vi.fn(async () => ({ configured: true })),
  },
}));

vi.mock("./bridge/clef.ts", async (original) => ({
  ...(await original<typeof import("./bridge/clef.ts")>()),
  createBridge: () => runtime.bridge,
}));
vi.mock("./bridge/windows.ts", () => ({
  showControls: vi.fn(async () => {}),
  hostControls: vi.fn(async () => ({ publish: async () => {}, dispose: () => {} })),
  WINDOW_EVENTS: { minimized: "game:minimized" },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ listen: async () => () => {}, isMinimized: async () => false }),
}));
vi.mock("./launch.ts", () => ({ readLaunchOptions: async () => ({ player: "human", seed: 1 }) }));
vi.mock("./GameCanvas.tsx", () => ({
  GameCanvas: ({ state, onShowControls }: { state: SessionState; onShowControls?: () => void }) => (
    <button type="button" onClick={onShowControls} data-paused={state.paused}>
      game control
    </button>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("game window shortcuts", () => {
  it("opens controls with F2 from a focused game button while preserving form shortcuts", async () => {
    const view = render(
      <LanguageProvider initial={{ preference: "en", detected: "en" }}>
        <App desktop />
      </LanguageProvider>,
    );
    const button = view.getByRole("button", { name: "game control" });
    button.focus();
    fireEvent.keyDown(button, { key: "F2" });
    await waitFor(() => expect(showControls).toHaveBeenCalledExactlyOnceWith(false));
    fireEvent.keyDown(button, { key: "F2", ctrlKey: true });
    fireEvent.keyDown(button, { key: " " });
    expect(showControls).toHaveBeenCalledOnce();
    expect(button.getAttribute("data-paused")).toBe("false");
    expect(runtime.bridge.run).not.toHaveBeenCalled();
  });

  it("leaves F2 available to the browser", () => {
    const view = render(
      <LanguageProvider initial={{ preference: "en", detected: "en" }}>
        <App />
      </LanguageProvider>,
    );
    const event = new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true });
    view.getByRole("button", { name: "game control" }).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(showControls).not.toHaveBeenCalled();
    expect(runtime.bridge.run).not.toHaveBeenCalled();
  });
});
