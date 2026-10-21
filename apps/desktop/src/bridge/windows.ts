import type { ChickenArtwork } from "@ccr/render";
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type ControlCommand,
  type ControlsData,
  controlsForWindow,
  type SendControl,
} from "../controls.ts";

export const WINDOW_EVENTS = {
  request: "controls:request",
  state: "controls:state",
  reply: "controls:reply",
  shown: "controls:shown",
  hidden: "controls:hidden",
  controlsVisible: "controls:visible",
  minimized: "game:minimized",
  decisionsShown: "decisions:shown",
  decisionsClosed: "decisions:closed",
  decisionsVisible: "decisions:visible",
  artwork: "decisions:artwork",
} as const;

export type AuxiliaryWindow = "controls" | "decisions";

interface Request {
  id: string;
  sender: AuxiliaryWindow;
  command: ControlCommand | { type: "sync" };
}

interface Reply {
  id: string;
  ok: boolean;
}

interface RemoteSnapshot {
  data: ControlsData;
  timeOrigin: number;
}

export const showControls = (): Promise<void> => invoke("show_controls");

/** Fit the initial native layout to CSS pixels, then show the game. Reloads preserve user sizing. */
export const showGame = (pixelRatio: number): Promise<void> => invoke("show_game", { pixelRatio });

/** The native window owns visibility, including consecutive clicks before UI events arrive. */
export const toggleControls = (): Promise<void> => invoke("toggle_controls");

export const setDecisionsVisible = (visible: boolean, focus = false): Promise<void> =>
  invoke("set_decisions_visible", { visible, focus });

/** Register before publishing; a late/reloaded panel can always request a fresh snapshot. */
export async function hostControls(
  execute: SendControl,
  snapshot: () => ControlsData,
  artwork?: () => ChickenArtwork | null | undefined,
) {
  let lastArtwork: ChickenArtwork | null | undefined;
  const publishArtwork = async (force = false) => {
    const next = artwork?.();
    if (next === undefined || (!force && next === lastArtwork)) return;
    await emitTo("decisions", WINDOW_EVENTS.artwork, next);
    lastArtwork = next;
  };
  const publish = async () => {
    const payload = {
      data: snapshot(),
      timeOrigin: performance.timeOrigin,
    } satisfies RemoteSnapshot;
    // One unavailable presentation must not block replies to the other.
    await Promise.allSettled([
      publishArtwork(),
      ...(["controls", "decisions"] as const).map((target) =>
        emitTo(target, WINDOW_EVENTS.state, payload),
      ),
    ]);
  };
  const stop = await getCurrentWindow().listen<Request>(WINDOW_EVENTS.request, ({ payload }) => {
    if (payload.sender !== "controls" && payload.sender !== "decisions") return;
    void (async () => {
      let ok = true;
      try {
        if (payload.command.type !== "sync") await execute(payload.command);
        else if (payload.sender === "decisions") await publishArtwork(true).catch(() => {});
      } catch {
        ok = false;
      }
      await publish();
      await emitTo(payload.sender, WINDOW_EVENTS.reply, { id: payload.id, ok } satisfies Reply);
    })().catch(() => {});
  });
  return { publish, dispose: stop };
}

/** No commands are retried: retrying a map or a single step would change the game twice. */
export async function connectControls(
  onState: (data: ControlsData) => void,
  onArtwork?: (artwork: ChickenArtwork | null) => void,
) {
  const label = getCurrentWindow().label;
  if (label !== "controls" && label !== "decisions") throw new Error("Unknown auxiliary window");
  const sender: AuxiliaryWindow = label;
  const pending = new Map<string, { finish(ok: boolean): void }>();
  const instance = crypto.randomUUID();
  let sequence = 0;
  let disposed = false;
  const stops: (() => void)[] = [];
  try {
    if (sender === "decisions" && onArtwork)
      stops.push(
        await getCurrentWindow().listen<ChickenArtwork | null>(
          WINDOW_EVENTS.artwork,
          ({ payload }) => onArtwork(payload),
        ),
      );
    stops.push(
      await getCurrentWindow().listen<RemoteSnapshot>(WINDOW_EVENTS.state, ({ payload }) =>
        onState(controlsForWindow(payload.data, payload.timeOrigin, performance.timeOrigin)),
      ),
    );
    stops.push(
      await getCurrentWindow().listen<Reply>(WINDOW_EVENTS.reply, ({ payload }) =>
        pending.get(payload.id)?.finish(payload.ok),
      ),
    );
  } catch (error) {
    for (const stop of stops) stop();
    throw error;
  }

  const send = (command: Request["command"]): Promise<void> => {
    if (disposed) return Promise.reject(new Error("Controls disconnected"));
    const id = `${instance}:${++sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(false), 5000);
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        pending.delete(id);
        if (ok) resolve();
        else reject(new Error("Game did not acknowledge the command"));
      };
      pending.set(id, { finish });
      void emitTo("main", WINDOW_EVENTS.request, { id, sender, command } satisfies Request).catch(
        () => finish(false),
      );
    });
  };
  return {
    send: send as SendControl,
    sync: () => send({ type: "sync" }),
    dispose: () => {
      disposed = true;
      for (const stop of stops) stop();
      for (const request of [...pending.values()]) request.finish(false);
    },
  };
}
