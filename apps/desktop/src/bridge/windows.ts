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
  minimized: "game:minimized",
} as const;

interface Request {
  id: string;
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

export const showControls = (inspect = false): Promise<void> =>
  invoke("show_controls", { inspect });

/** Register before publishing; a late/reloaded panel can always request a fresh snapshot. */
export async function hostControls(execute: SendControl, snapshot: () => ControlsData) {
  const publish = () =>
    emitTo("controls", WINDOW_EVENTS.state, {
      data: snapshot(),
      timeOrigin: performance.timeOrigin,
    } satisfies RemoteSnapshot);
  const stop = await getCurrentWindow().listen<Request>(WINDOW_EVENTS.request, ({ payload }) => {
    void (async () => {
      let ok = true;
      try {
        if (payload.command.type !== "sync") await execute(payload.command);
      } catch {
        ok = false;
      }
      await publish();
      await emitTo("controls", WINDOW_EVENTS.reply, { id: payload.id, ok } satisfies Reply);
    })().catch(() => {});
  });
  return { publish, dispose: stop };
}

/** No commands are retried: retrying a map or a single step would change the game twice. */
export async function connectControls(onState: (data: ControlsData) => void) {
  const pending = new Map<string, { finish(ok: boolean): void }>();
  const instance = crypto.randomUUID();
  let sequence = 0;
  let disposed = false;
  const stops: (() => void)[] = [];
  try {
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
      void emitTo("main", WINDOW_EVENTS.request, { id, command } satisfies Request).catch(() =>
        finish(false),
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
