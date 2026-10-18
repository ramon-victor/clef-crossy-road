// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bridge } from "./bridge/types.ts";
import { ControlSurface } from "./ControlSurface.tsx";
import { type ControlsData, playerOption, type SendControl } from "./controls.ts";
import { LanguageProvider } from "./i18n/provider.tsx";
import { buildPolicyChoices } from "./policies.ts";
import { Session } from "./session.ts";

const dialogMethods = ["showModal", "close"] as const;
const originalMethods = dialogMethods.map((name) =>
  Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name),
);
beforeEach(() => {
  for (const name of dialogMethods)
    Object.defineProperty(HTMLDialogElement.prototype, name, {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = name === "showModal";
      },
    });
});
afterEach(() => {
  cleanup();
  dialogMethods.forEach((name, index) => {
    const descriptor = originalMethods[index];
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  });
  vi.restoreAllMocks();
});

function data(): ControlsData {
  const state = new Session().state();
  return {
    state: { ...state, human: false },
    choices: buildPolicyChoices(null).map(playerOption),
    selectedId: "clef-flash",
    budget: null,
    credentials: { configured: false },
    fps: 60,
    soundOn: true,
    autoRestart: true,
    bridgeKind: "tauri",
    minimized: false,
    theaterOpen: true,
    inspectVersion: 0,
    compassOn: true,
    pace: "relaxed",
  };
}

describe("detached control surface", () => {
  it("keeps decisions out of controls and routes pace changes to the owner", () => {
    const send = vi.fn<SendControl>(async () => {});
    const view = render(
      <LanguageProvider initial={{ preference: "en", detected: "en" }}>
        <ControlSurface data={data()} bridge={{} as Bridge} send={send} onInspect={vi.fn()} />
      </LanguageProvider>,
    );
    const setup = view.container.querySelector<HTMLDetailsElement>("details.setup");
    if (setup) setup.open = true;
    fireEvent.click(view.getByRole("button", { name: "Slow", exact: true }));
    expect(view.container.querySelector(".theater")).toBeNull();
    expect(view.container.querySelector(".inspector")).toBeNull();
    expect(send.mock.calls.map(([command]) => command)).toEqual([{ type: "pace", pace: "slow" }]);
  });

  it("does not reopen credential input after hiding while pause confirmation is pending", async () => {
    let acknowledge = () => {};
    const send = () =>
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      });
    const inspect = vi.fn();
    const snapshot = data();
    const surface = (hiddenVersion: number) => (
      <LanguageProvider initial={{ preference: "en", detected: "en" }}>
        <ControlSurface
          data={snapshot}
          bridge={{} as Bridge}
          send={send}
          onInspect={inspect}
          hiddenVersion={hiddenVersion}
        />
      </LanguageProvider>
    );
    const view = render(surface(0));
    const setup = view.container.querySelector<HTMLDetailsElement>("details.setup");
    if (setup) setup.open = true;
    fireEvent.click(view.getByRole("button", { name: "Configure", exact: true }));
    expect(view.container.querySelector(".connection-dialog")).toBeNull();
    view.rerender(surface(1));
    await act(async () => {
      acknowledge();
    });
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Configure", exact: true })).toBeTruthy(),
    );
    expect(view.container.querySelector(".connection-dialog")).toBeNull();
  });
});
