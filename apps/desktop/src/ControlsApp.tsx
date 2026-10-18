import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "preact/hooks";
import { tauriBridge } from "./bridge/tauri.ts";
import { connectControls, WINDOW_EVENTS } from "./bridge/windows.ts";
import { ControlSurface } from "./ControlSurface.tsx";
import type { ControlsData } from "./controls.ts";
import { useI18n } from "./i18n/provider.tsx";
import { commandForKey } from "./keymap.ts";
import { runControlsSelfTest } from "./selftest-controls.ts";

/** A presentation only: no Session, renderer, policy or ClefClient is created here. */
export function ControlsApp() {
  const { t } = useI18n();
  const [data, setData] = useState<ControlsData | null>(null);
  const [connection, setConnection] = useState<Awaited<ReturnType<typeof connectControls>> | null>(
    null,
  );
  const [hiddenVersion, setHiddenVersion] = useState(0);
  const [failed, setFailed] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const latest = useRef({ data, connection });
  latest.current = { data, connection };

  useEffect(() => {
    let disposed = false;
    const stops: (() => void)[] = [];
    const setup = async () => {
      const current = getCurrentWindow();
      const connection = await connectControls((next) => {
        setData(next);
        setSyncFailed(false);
      });
      stops.push(connection.dispose);
      stops.push(
        await current.listen(WINDOW_EVENTS.shown, () => {
          void connection.sync().catch(() => setSyncFailed(true));
        }),
      );
      stops.push(
        await current.listen(WINDOW_EVENTS.hidden, () => {
          setHiddenVersion((n) => n + 1);
        }),
      );
      stops.push(
        await current.onFocusChanged(({ payload }) => {
          if (payload) void connection.sync().catch(() => setSyncFailed(true));
        }),
      );
      stops.push(await runControlsSelfTest());
      if (disposed) {
        for (const stop of stops) stop();
        return;
      }
      setConnection(connection);
      // The game's recurring publication also covers either window loading first.
      void connection.sync().catch(() => setSyncFailed(true));
    };
    void setup().catch(() => {
      for (const stop of stops) stop();
      if (!disposed) setSyncFailed(true);
    });
    return () => {
      disposed = true;
      for (const stop of stops) stop();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const command = commandForKey(event);
      if (!command) return;
      if (
        event.target instanceof Element &&
        event.target.closest('input, select, textarea, dialog, [contenteditable], [role="dialog"]')
      )
        return;
      const { data, connection } = latest.current;
      if (command.type === "inspect") {
        event.preventDefault();
        setFailed(false);
        void connection?.send({ type: "inspect" }).catch(() => setFailed(true));
      } else if (data && connection && (command.type === "theater" || command.type === "compass")) {
        event.preventDefault();
        setFailed(false);
        void connection
          .send({
            type: command.type,
            enabled: !(command.type === "theater" ? data.theaterOpen : data.compassOn),
          })
          .catch(() => setFailed(true));
      }
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
          send={(command) => {
            setFailed(false);
            return connection.send(command);
          }}
          onInspect={() => {
            setFailed(false);
            void connection.send({ type: "inspect" }).catch(() => setFailed(true));
          }}
          hiddenVersion={hiddenVersion}
          externalError={failed || syncFailed ? t("windows.unreachable") : null}
        />
      ) : (
        <p class="connection-status" role="status">
          {failed || syncFailed ? t("windows.reconnect") : t("windows.connecting")}
        </p>
      )}
    </div>
  );
}
