// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlsApp } from "./ControlsApp.tsx";
import { type ControlsData, playerOption, type SendControl } from "./controls.ts";
import { DecisionsApp } from "./DecisionsApp.tsx";
import { LanguageProvider } from "./i18n/provider.tsx";
import { buildPolicyChoices } from "./policies.ts";
import { Session } from "./session.ts";

const remote = vi.hoisted(() => ({
  receive: null as ((data: ControlsData) => void) | null,
  send: vi.fn<SendControl>(),
  sync: vi.fn<() => Promise<void>>(),
  dispose: vi.fn(),
}));

vi.mock("./bridge/windows.ts", () => ({
  connectControls: async (receive: (data: ControlsData) => void) => {
    remote.receive = receive;
    return { send: remote.send, sync: remote.sync, dispose: remote.dispose };
  },
  showControls: vi.fn(async () => {}),
  WINDOW_EVENTS: {
    shown: "controls:shown",
    hidden: "controls:hidden",
    decisionsShown: "decisions:shown",
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ listen: async () => () => {}, onFocusChanged: async () => () => {} }),
}));
vi.mock("./selftest-controls.ts", () => ({ runControlsSelfTest: async () => () => {} }));
vi.mock("./selftest-decisions.ts", () => ({ runDecisionsSelfTest: async () => () => {} }));

beforeEach(() => {
  remote.sync.mockResolvedValue();
  remote.send.mockResolvedValue();
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  remote.receive = null;
});

function data(): ControlsData {
  return {
    state: new Session().state(),
    choices: buildPolicyChoices(null).map(playerOption),
    selectedId: "human",
    budget: null,
    credentials: { configured: false },
    fps: 60,
    soundOn: true,
    autoRestart: false,
    bridgeKind: "tauri",
    minimized: false,
    theaterOpen: true,
    inspectVersion: 0,
    compassOn: false,
    pace: null,
  };
}

describe.each([
  ["controls", ControlsApp],
  ["decisions", DecisionsApp],
] as const)("auxiliary window recovery: %s", (_name, Component) => {
  const mount = () =>
    render(
      <LanguageProvider
        initial={{ preference: "en", detected: "en" }}
        source={{ read: () => "en", detect: async () => "en", save: () => {} }}
      >
        <Component />
      </LanguageProvider>,
    );

  it("clears a startup sync failure when the game finally publishes a snapshot", async () => {
    remote.sync.mockRejectedValueOnce(new Error("Game still loading"));
    const view = mount();
    await waitFor(() =>
      expect(view.getByRole("status").textContent).toContain("Waiting for the game"),
    );
    act(() => remote.receive?.(data()));
    await waitFor(() => expect(view.queryByRole("alert")).toBeNull());
    expect(view.queryByText(/Could not reach the game/)).toBeNull();
  });

  it("keeps command failures visible through snapshots and clears them when retry succeeds", async () => {
    const view = mount();
    await waitFor(() => expect(remote.sync).toHaveBeenCalledOnce());
    act(() => remote.receive?.(data()));
    remote.send.mockRejectedValueOnce(new Error("Request refused"));
    fireEvent.keyDown(window, { key: "i" });
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain("Could not reach the game"),
    );
    act(() => remote.receive?.(data()));
    expect(view.getByRole("alert")).toBeTruthy();
    fireEvent.keyDown(window, { key: "i" });
    await waitFor(() => expect(remote.send).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view.queryByRole("alert")).toBeNull());
  });
});
