// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { setDecisionsVisible, showControls } from "./bridge/windows.ts";
import type { ControlsData } from "./controls.ts";
import type { GameCanvasProps } from "./GameCanvas.tsx";
import { LanguageProvider } from "./i18n/provider.tsx";
import type { TheaterProps } from "./theater/Theater.tsx";

const runtime = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  snapshot: null as (() => ControlsData) | null,
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
  setDecisionsVisible: vi.fn(async (visible: boolean) => {
    runtime.listeners.get("decisions:visible")?.({ payload: visible });
  }),
  hostControls: vi.fn(async (_execute, snapshot) => {
    runtime.snapshot = snapshot;
    return { publish: async () => {}, dispose: () => {} };
  }),
  WINDOW_EVENTS: {
    minimized: "game:minimized",
    decisionsClosed: "decisions:closed",
    decisionsVisible: "decisions:visible",
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    listen: async (event: string, listener: (event: { payload: unknown }) => void) => {
      runtime.listeners.set(event, listener);
      return () => runtime.listeners.delete(event);
    },
    isMinimized: async () => false,
  }),
}));
vi.mock("./launch.ts", () => ({ readLaunchOptions: async () => ({ player: "human", seed: 1 }) }));
vi.mock("./theater/Theater.tsx", () => ({
  Theater: ({ inspectVersion }: TheaterProps) => (
    <div data-testid="conversation" data-inspect-version={inspectVersion} />
  ),
}));
vi.mock("./GameCanvas.tsx", () => ({
  GameCanvas: ({ state, onShowControls, onToggleDecisions, decisionsVisible }: GameCanvasProps) => (
    <>
      <button type="button" onClick={onShowControls} data-paused={state.paused}>
        game control
      </button>
      {onToggleDecisions && (
        <button type="button" onClick={onToggleDecisions} aria-pressed={decisionsVisible}>
          decisions
        </button>
      )}
    </>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  runtime.listeners.clear();
  runtime.snapshot = null;
  localStorage.removeItem("ccr.theater");
});

describe("game window shortcuts", () => {
  it.each([
    ["F2", showControls],
    ["i", setDecisionsVisible],
  ] as const)("clears a window error after a successful %s retry", async (key, open) => {
    const view = render(
      <LanguageProvider initial={{ preference: "en", detected: "en" }}>
        <App desktop />
      </LanguageProvider>,
    );
    await waitFor(() => expect(setDecisionsVisible).toHaveBeenCalledWith(false));
    vi.mocked(open).mockRejectedValueOnce(new Error("Window unavailable"));
    const game = view.getByRole("button", { name: "game control" });
    fireEvent.keyDown(game, { key });
    await waitFor(() => expect(view.getByRole("alert")).toBeTruthy());
    fireEvent.keyDown(game, { key });
    await waitFor(() => expect(view.queryByRole("alert")).toBeNull());
  });

  it("does not replay a browser inspection request after hiding and reopening the conversation", async () => {
    const view = render(
      <LanguageProvider initial={{ preference: "en", detected: "en" }}>
        <App />
      </LanguageProvider>,
    );
    const game = view.getByRole("button", { name: "game control" });
    fireEvent.keyDown(game, { key: "i" });
    await waitFor(() =>
      expect(view.getByTestId("conversation").getAttribute("data-inspect-version")).toBe("1"),
    );
    fireEvent.keyDown(game, { key: "t" });
    await waitFor(() => expect(view.queryByTestId("conversation")).toBeNull());
    fireEvent.keyDown(game, { key: "t" });
    await waitFor(() =>
      expect(view.getByTestId("conversation").getAttribute("data-inspect-version")).toBe("0"),
    );
  });

  it("starts native decisions hidden despite an old preference, routes I and restores a minimized window", async () => {
    localStorage.setItem("ccr.theater", "on");
    const view = render(
      <LanguageProvider initial={{ preference: "en", detected: "en" }}>
        <App desktop />
      </LanguageProvider>,
    );
    await waitFor(() => expect(setDecisionsVisible).toHaveBeenCalledWith(false));
    vi.mocked(setDecisionsVisible).mockClear();
    const game = view.getByRole("button", { name: "game control" });
    fireEvent.keyDown(game, { key: "i" });
    await waitFor(() => expect(setDecisionsVisible).toHaveBeenCalledWith(true, true));
    const toggle = view.getByRole("button", { name: "decisions" });
    await waitFor(() => expect(toggle.getAttribute("aria-pressed")).toBe("true"));
    expect(runtime.snapshot?.().inspectVersion).toBe(1);
    expect(localStorage.getItem("ccr.theater")).toBe("on");
    act(() => runtime.listeners.get("decisions:visible")?.({ payload: false }));
    await waitFor(() => expect(toggle.getAttribute("aria-pressed")).toBe("false"));
    expect(localStorage.getItem("ccr.theater")).toBe("on");
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute("aria-pressed")).toBe("true"));
    act(() => runtime.listeners.get("decisions:closed")?.({ payload: null }));
    await waitFor(() => expect(toggle.getAttribute("aria-pressed")).toBe("false"));
    expect(localStorage.getItem("ccr.theater")).toBe("on");
    expect(game.getAttribute("data-paused")).toBe("false");
    expect(showControls).not.toHaveBeenCalled();
    expect(runtime.bridge.run).not.toHaveBeenCalled();
  });

  it("opens controls with F2 from a focused game button while preserving form shortcuts", async () => {
    const view = render(
      <LanguageProvider initial={{ preference: "en", detected: "en" }}>
        <App desktop />
      </LanguageProvider>,
    );
    const button = view.getByRole("button", { name: "game control" });
    button.focus();
    fireEvent.keyDown(button, { key: "F2" });
    await waitFor(() => expect(showControls).toHaveBeenCalledExactlyOnceWith());
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
