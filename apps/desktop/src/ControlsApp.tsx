import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "preact/hooks";
import { tauriBridge } from "./bridge/tauri.ts";
import { connectControls, WINDOW_EVENTS } from "./bridge/windows.ts";
import { ControlSurface } from "./ControlSurface.tsx";
import type { ControlsData } from "./controls.ts";
import { runControlsSelfTest } from "./selftest-controls.ts";

/** A presentation only: no Session, renderer, policy or ClefClient is created here. */
export function ControlsApp() {
  const [data, setData] = useState<ControlsData | null>(null);
  const [connection, setConnection] = useState<Awaited<ReturnType<typeof connectControls>> | null>(
    null,
  );
  const [inspecting, setInspecting] = useState(false);
  const [hiddenVersion, setHiddenVersion] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    const stops: (() => void)[] = [];
    const setup = async () => {
      const current = getCurrentWindow();
      const connection = await connectControls(setData);
      stops.push(connection.dispose);
      stops.push(
        await current.listen<boolean>(WINDOW_EVENTS.shown, ({ payload }) => {
          if (payload) setInspecting(true);
          void connection.sync().catch(() => setFailed(true));
        }),
      );
      stops.push(
        await current.listen(WINDOW_EVENTS.hidden, () => {
          setInspecting(false);
          setHiddenVersion((n) => n + 1);
        }),
      );
      stops.push(
        await current.onFocusChanged(({ payload }) => {
          if (payload) void connection.sync().catch(() => setFailed(true));
        }),
      );
      stops.push(await runControlsSelfTest());
      if (disposed) {
        for (const stop of stops) stop();
        return;
      }
      setConnection(connection);
      // The game's recurring publication also covers either window loading first.
      void connection.sync().catch(() => setFailed(true));
    };
    void setup().catch(() => {
      for (const stop of stops) stop();
      if (!disposed) setFailed(true);
    });
    return () => {
      disposed = true;
      for (const stop of stops) stop();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.isComposing
      )
        return;
      if (
        event.key.toLowerCase() !== "i" ||
        (event.target instanceof Element &&
          event.target.closest("input, select, textarea, button, dialog, [contenteditable]"))
      )
        return;
      event.preventDefault();
      setInspecting((open) => !open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div class="shell controls-shell">
      {data && connection ? (
        <ControlSurface
          data={data}
          bridge={tauriBridge}
          send={connection.send}
          inspectorOpen={inspecting}
          onInspect={setInspecting}
          hiddenVersion={hiddenVersion}
        />
      ) : (
        <p class="connection-status" role="status">
          {failed
            ? "Waiting for the game. Reopen the panel to reconnect."
            : "Connecting to the game…"}
        </p>
      )}
    </div>
  );
}
