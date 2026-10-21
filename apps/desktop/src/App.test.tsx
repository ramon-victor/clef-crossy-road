// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { setDecisionsVisible, showControls, toggleControls } from "./bridge/windows.ts";
import type { ControlsData } from "./controls.ts";
import type { GameCanvasProps } from "./GameCanvas.tsx";
import { LanguageProvider } from "./i18n/provider.tsx";
import type { TheaterProps } from "./theater/Theater.tsx";

const runtime = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  snapshot: null as (() => ControlsData) | null,
  controlsVisible: false,
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
  showControls: vi.fn(async () => {
    runtime.controlsVisible = true;
    runtime.listeners.get("controls:visible")?.({ payload: true });
  }),
  toggleControls: vi.fn(async () => {
    runtime.controlsVisible = !runtime.controlsVisible;
    runtime.listeners.get("controls:visible")?.({ payload: runtime.controlsVisible });
  }),
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
    controlsVisible: "controls:visible",
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  Window: {
    getByLabel: async () => ({
      isVisible: async () => runtime.controlsVisible,
      isMinimized: async () => false,
    }),
  },
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
  GameCanvas: ({
    state,
    onShowControls,
    onToggleControls,
    controlsVisible,
    controlsTarget,
    onToggleDecisions,
    decisionsVisible,
  }: GameCanvasProps) => (
    <>
      <button type="button" onClick={onShowControls} data-paused={state.paused}>
        game control
      </button>
      {onToggleControls && (
        <button
          type="button"
          onClick={onToggleControls}
          aria-pressed={controlsVisible}
          data-target={controlsTarget}
        >
          settings
        </button>
      )}
      {onToggleDecisions && (
        <button type="button" onClick={onToggleDecisions} aria-pressed={decisionsVisible}>
          decisions
        </button>
      )}
    </>
  ),
}));

afterEach(async () => {
  cleanup();
  await act(async () => {});
  vi.clearAllMocks();
  runtime.listeners.clear();
  runtime.snapshot = null;
  runtime.controlsVisible = false;
  localStorage.removeItem("ccr.theater");
  localStorage.removeItem("ccr.settings");
});

describe("game window shortcuts", () => {
  it("toggles settings, follows native close events and keeps F2 as an explicit open", async () => {
    const view = render(
      <LanguageProvider initial={{ preference: "en", detected: "en" }}>
        <App desktop />
      </LanguageProvider>,
    );
    await waitFor(() => expect(runtime.listeners.has("controls:visible")).toBe(true));
    const settings = view.getByRole("button", { name: "settings" });
    const game = view.getByRole("button", { name: "game control" });
    expect(settings.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(settings);
    await waitFor(() => expect(settings.getAttribute("aria-pressed")).toBe("true"));
    fireEvent.click(settings);
    await waitFor(() => expect(settings.getAttribute("aria-pressed")).toBe("false"));
    fireEvent.keyDown(game, { key: "F2" });
    await waitFor(() => expect(settings.getAttribute("aria-pressed")).toBe("true"));
    fireEvent.keyDown(game, { key: "F2" });
    await waitFor(() => expect(showControls).toHaveBeenCalledTimes(2));
    expect(settings.getAttribute("aria-pressed")).toBe("true");
    act(() => {
      runtime.controlsVisible = false;
      runtime.listeners.get("controls:visible")?.({ payload: false });
    });
    await waitFor(() => expect(settings.getAttribute("aria-pressed")).toBe("false"));
    fireEvent.click(settings);
    fireEvent.click(settings);
    await waitFor(() => expect(toggleControls).toHaveBeenCalledTimes(4));
    expect(settings.getAttribute("aria-pressed")).toBe("false");
    expect(game.getAttribute("data-paused")).toBe("false");
    expect(runtime.bridge.run).not.toHaveBeenCalled();
  });

  it("recovers settings visibility when the game webview reloads", async () => {
    runtime.controlsVisible = true;
    const view = render(
      <LanguageProvider initial={{ preference: "en", detected: "en" }}>
        <App desktop />
      </LanguageProvider>,
    );
    await waitFor(() =>
      expect(view.getByRole("button", { name: "settings" }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
    expect(showControls).not.toHaveBeenCalled();
  });

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

  it("leaves F2 available to the browser", async () => {
    const view = render(
      <LanguageProvider initial={{ preference: "en", detected: "en" }}>
        <App />
      </LanguageProvider>,
    );
    const event = new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true });
    await waitFor(() => expect(runtime.bridge.budget).toHaveBeenCalled());
    view.getByRole("button", { name: "game control" }).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(showControls).not.toHaveBeenCalled();
    expect(runtime.bridge.run).not.toHaveBeenCalled();
  });
});

describe("side panel toggles", () => {
  const mount = (desktop = false) =>
    render(
      <LanguageProvider initial={{ preference: "en", detected: "en" }}>
        <App desktop={desktop} />
      </LanguageProvider>,
    );
  const settingsPanel = (view: ReturnType<typeof mount>) =>
    view.container.querySelector("aside.panel");

  it("hides and shows the settings sidebar from the game, and remembers the choice", async () => {
    const view = mount();
    expect(settingsPanel(view)).not.toBeNull();
    const toggle = view.getByRole("button", { name: "settings" });
    expect(toggle.getAttribute("data-target")).toBe("sidebar");
    fireEvent.click(toggle);
    await waitFor(() => expect(settingsPanel(view)).toBeNull());
    expect(localStorage.getItem("ccr.settings")).toBe("off");
    view.unmount();

    const reopened = mount();
    expect(settingsPanel(reopened)).toBeNull();
    fireEvent.click(reopened.getByRole("button", { name: "settings" }));
    await waitFor(() => expect(settingsPanel(reopened)).not.toBeNull());
    expect(localStorage.getItem("ccr.settings")).toBe("on");
  });

  it("reopens the hidden sidebar from the game's Configure action, offered only then", async () => {
    const view = mount();
    const game = view.getByRole("button", { name: "game control" });
    fireEvent.click(game);
    expect(settingsPanel(view)).not.toBeNull();
    fireEvent.click(view.getByRole("button", { name: "settings" }));
    await waitFor(() => expect(settingsPanel(view)).toBeNull());
    fireEvent.click(game);
    await waitFor(() => expect(settingsPanel(view)).not.toBeNull());
  });

  it("brings the conversation back from the game after it was closed", async () => {
    const view = mount();
    const toggle = view.getByRole("button", { name: "decisions" });
    // The app opens on a model player until the launch options pick the human one, which starts closed.
    await waitFor(() => expect(toggle.getAttribute("aria-pressed")).toBe("false"));
    fireEvent.click(toggle);
    await waitFor(() => expect(view.getByTestId("conversation")).toBeTruthy());
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    await waitFor(() => expect(view.queryByTestId("conversation")).toBeNull());
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    await waitFor(() => expect(view.getByTestId("conversation")).toBeTruthy());
  });

  it("keeps the stored sidebar choice out of the native window toggle", async () => {
    const view = mount(true);
    const settings = view.getByRole("button", { name: "settings" });
    expect(settings.getAttribute("data-target")).toBe("window");
    fireEvent.click(settings);
    await waitFor(() => expect(settings.getAttribute("aria-pressed")).toBe("true"));
    expect(localStorage.getItem("ccr.settings")).toBeNull();
  });
});
