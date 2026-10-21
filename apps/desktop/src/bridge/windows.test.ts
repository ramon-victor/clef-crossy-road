import { afterEach, describe, expect, it, vi } from "vitest";
import { type ControlsData, controlsForWindow, playerOption } from "../controls.ts";
import { buildPolicyChoices } from "../policies.ts";
import { Session } from "../session.ts";
import { connectControls, hostControls, WINDOW_EVENTS } from "./windows.ts";

const bus = vi.hoisted(() => ({
  label: "main",
  listeners: new Map<string, Set<(event: { payload: unknown }) => void>>(),
  dropReply: false,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => {
    const label = bus.label;
    return {
      label,
      listen: async (event: string, handler: (event: { payload: unknown }) => void) => {
        const key = `${label}:${event}`;
        const listeners = bus.listeners.get(key) ?? new Set();
        listeners.add(handler);
        bus.listeners.set(key, listeners);
        return () => listeners.delete(handler);
      },
    };
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: async (target: string, event: string, payload: unknown) => {
    if (bus.dropReply && event === "controls:reply") return;
    const cloned: unknown = JSON.parse(JSON.stringify(payload));
    for (const listener of bus.listeners.get(`${target}:${event}`) ?? [])
      listener({ payload: cloned });
  },
}));

function fixture(): ControlsData {
  return {
    state: new Session().state(),
    choices: buildPolicyChoices(null).map(playerOption),
    selectedId: "human",
    budget: null,
    credentials: { configured: false },
    fps: 60,
    soundOn: true,
    autoRestart: true,
    bridgeKind: "tauri",
    minimized: false,
    theaterOpen: false,
    inspectVersion: 0,
    compassOn: false,
    pace: null,
  };
}

afterEach(() => {
  bus.listeners.clear();
  bus.dropReply = false;
  vi.useRealTimers();
});

describe("desktop controls synchronization", () => {
  it("serves controls and decisions together and acknowledges each sender independently", async () => {
    const execute = vi.fn(async (command) => {
      if (command.type === "inspect") throw new Error("Cannot inspect");
    });
    bus.label = "main";
    const host = await hostControls(execute, fixture);
    bus.label = "controls";
    const controlsState = vi.fn();
    const controls = await connectControls(controlsState);
    bus.label = "decisions";
    const decisionsState = vi.fn();
    const decisions = await connectControls(decisionsState);
    await Promise.all([controls.sync(), decisions.sync()]);
    expect(controlsState).toHaveBeenCalledTimes(2);
    expect(decisionsState).toHaveBeenCalledTimes(2);
    await Promise.all([
      controls.send({ type: "pace", pace: "slow" }),
      expect(decisions.send({ type: "inspect" })).rejects.toThrow(),
    ]);
    expect(execute.mock.calls.map(([command]) => command)).toEqual([
      { type: "pace", pace: "slow" },
      { type: "inspect" },
    ]);
    controls.dispose();
    await decisions.sync();
    expect(controlsState).toHaveBeenCalledTimes(4);
    expect(decisionsState).toHaveBeenCalledTimes(5);
    decisions.dispose();
    host.dispose();
    expect([...bus.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
  });

  it("keeps the real elapsed reading time after reloading the panel's clock", () => {
    const source = fixture();
    source.state.asking = { since: 8900, input: { model: "clef-flash", state: {}, questions: {} } };
    const received = controlsForWindow(source, 1000, 10000);
    expect(received.state.asking?.since).toBe(-100);
    // At epoch 10150 both windows must show the same 250 ms since the request at epoch 9900.
    expect(150 - (received.state.asking?.since ?? 0)).toBe(9150 - source.state.asking.since);
    expect(source.state.asking.since).toBe(8900);
    expect(received.state.asking?.input).toBe(source.state.asking.input);
  });
  it("synchronizes a late panel and executes commands once on the game owner", async () => {
    const session = new Session();
    const execute = vi.fn(async () => session.setPaused(true));
    bus.label = "main";
    const host = await hostControls(execute, () => ({ ...fixture(), state: session.state() }));
    bus.label = "controls";
    const onState = vi.fn();
    const panel = await connectControls(onState);
    await panel.sync();
    expect(onState.mock.lastCall?.[0].state.paused).toBe(false);
    await panel.send({ type: "pauseForSettings" });
    expect(execute).toHaveBeenCalledExactlyOnceWith({ type: "pauseForSettings" });
    expect(onState.mock.lastCall?.[0].state.paused).toBe(true);
    panel.dispose();
    host.dispose();
  });

  it("receives recurring snapshots when the panel loads before the game", async () => {
    bus.label = "controls";
    const onState = vi.fn();
    const panel = await connectControls(onState);
    bus.label = "main";
    const execute = vi.fn(async () => {});
    const host = await hostControls(execute, fixture);
    await host.publish();
    expect(onState).toHaveBeenCalledOnce();
    await panel.sync();
    expect(execute).not.toHaveBeenCalled();
    panel.dispose();
    host.dispose();
  });

  it("reconnects without restarting the game or leaving duplicate subscriptions", async () => {
    bus.label = "main";
    const execute = vi.fn(async () => {});
    const host = await hostControls(execute, fixture);
    bus.label = "controls";
    const oldState = vi.fn();
    const old = await connectControls(oldState);
    old.dispose();
    const newState = vi.fn();
    const panel = await connectControls(newState);
    await panel.sync();
    await panel.send({ type: "step" });
    expect(execute).toHaveBeenCalledExactlyOnceWith({ type: "step" });
    expect(oldState).not.toHaveBeenCalled();
    expect(newState).toHaveBeenCalledTimes(2);
    panel.dispose();
    host.dispose();
    expect([...bus.listeners.values()].every((set) => set.size === 0)).toBe(true);
  });

  it("rejects failed commands instead of opening settings before pause is confirmed", async () => {
    bus.label = "main";
    const execute = vi.fn(async () => {
      throw new Error("game unavailable");
    });
    const host = await hostControls(execute, fixture);
    bus.label = "controls";
    const panel = await connectControls(() => {});
    await expect(panel.send({ type: "pauseForSettings" })).rejects.toThrow();
    expect(execute).toHaveBeenCalledOnce();
    panel.dispose();
    host.dispose();
  });

  it("does not retry an acknowledged-lost command or replay it on reconnect", async () => {
    vi.useFakeTimers();
    bus.label = "main";
    const execute = vi.fn(async () => {});
    const host = await hostControls(execute, fixture);
    bus.label = "controls";
    const panel = await connectControls(() => {});
    bus.dropReply = true;
    const result = expect(panel.send({ type: "newMap" })).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(5000);
    await result;
    expect(execute).toHaveBeenCalledExactlyOnceWith({ type: "newMap" });
    panel.dispose();
    host.dispose();
  });

  it("rejects pending commands on disposal and prevents sends after disconnect", async () => {
    bus.label = "controls";
    const panel = await connectControls(() => {});
    const result = expect(panel.send({ type: "retry" })).rejects.toThrow();
    panel.dispose();
    await result;
    await expect(panel.send({ type: "retry" })).rejects.toThrow("disconnected");
    expect(bus.listeners.get(`controls:${WINDOW_EVENTS.state}`)?.size).toBe(0);
  });
});

describe("player presentation", () => {
  it("serializes availability without sending executable policy factories", () => {
    const choices = buildPolicyChoices(null);
    const person = choices.find((choice) => choice.id === "human");
    const model = choices.find((choice) => choice.kind === "model");
    const reference = choices.find((choice) => choice.id === "lookahead");
    if (!person || !model || !reference) throw new Error("Standard players missing");
    const human = playerOption(person);
    expect(human.available).toBe(true);
    expect(playerOption(model).available).toBe(false);
    const enabled = playerOption({
      ...model,
      factory: reference.factory,
    });
    expect(enabled.available).toBe(true);
    expect(enabled).not.toHaveProperty("factory");
    expect(JSON.parse(JSON.stringify(enabled))).toEqual(enabled);
  });
});

it("delivers character artwork outside recurring snapshots and restores it after decisions reconnect", async () => {
  const artwork = {
    hop_forward: "forward",
    hop_back: "back",
    hop_left: "left",
    hop_right: "right",
  };
  let ready: typeof artwork | null | undefined;
  bus.label = "main";
  const host = await hostControls(
    async () => {},
    fixture,
    () => ready,
  );
  bus.label = "decisions";
  const onArtwork = vi.fn();
  const onState = vi.fn();
  const panel = await connectControls(onState, onArtwork);
  await host.publish();
  expect(onArtwork).not.toHaveBeenCalled();
  ready = artwork;
  await host.publish();
  await host.publish();
  expect(onArtwork).toHaveBeenCalledExactlyOnceWith(artwork);
  expect(onState.mock.lastCall?.[0]).not.toHaveProperty("artwork");
  panel.dispose();
  const reopened = await connectControls(vi.fn(), onArtwork);
  await reopened.sync();
  expect(onArtwork).toHaveBeenCalledTimes(2);
  ready = null;
  await host.publish();
  expect(onArtwork.mock.lastCall?.[0]).toBeNull();
  reopened.dispose();
  host.dispose();
  expect([...bus.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
});
