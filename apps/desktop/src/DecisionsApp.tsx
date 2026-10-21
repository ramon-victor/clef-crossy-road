import type { ChickenArtwork } from "@ccr/render";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "preact/hooks";
import { connectControls, showControls, WINDOW_EVENTS } from "./bridge/windows.ts";
import type { ControlCommand, ControlsData } from "./controls.ts";
import { useI18n } from "./i18n/provider.tsx";
import { commandForKey } from "./keymap.ts";
import { runDecisionsSelfTest } from "./selftest-decisions.ts";
import { Theater } from "./theater/Theater.tsx";

/** A third presentation of the game owner's state; never creates a session or model client. */
export function DecisionsApp() {
  const { t } = useI18n();
  const [data, setData] = useState<ControlsData | null>(null);
  const [artwork, setArtwork] = useState<ChickenArtwork | null | undefined>(undefined);
  const [connection, setConnection] = useState<Awaited<ReturnType<typeof connectControls>> | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const latest = useRef({ data, connection });
  latest.current = { data, connection };

  useEffect(() => {
    let disposed = false;
    const stops: (() => void)[] = [];
    const setup = async () => {
      const current = getCurrentWindow();
      const remote = await connectControls((next) => {
        setData(next);
        setSyncFailed(false);
      }, setArtwork);
      stops.push(remote.dispose);
      stops.push(
        await current.listen(WINDOW_EVENTS.decisionsShown, () => {
          void remote.sync().catch(() => setSyncFailed(true));
        }),
      );
      stops.push(
        await current.onFocusChanged(({ payload }) => {
          if (payload) void remote.sync().catch(() => setSyncFailed(true));
        }),
      );
      stops.push(await runDecisionsSelfTest());
      if (disposed) {
        for (const stop of stops) stop();
        return;
      }
      setConnection(remote);
      void remote.sync().catch(() => setSyncFailed(true));
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

  const send = (command: ControlCommand) => {
    setFailed(false);
    void latest.current.connection?.send(command).catch(() => setFailed(true));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('input, select, textarea, [contenteditable], dialog, [role="dialog"]')
      )
        return;
      const command = commandForKey(event);
      const { connection, data } = latest.current;
      if (!connection || !data) return;
      if (command?.type === "theater" || command?.type === "compass" || command?.type === "pause") {
        // Space on a focused button retains its normal activation behavior.
        if (
          command.type === "pause" &&
          event.target instanceof Element &&
          event.target.closest("button, summary, a[href]")
        )
          return;
        event.preventDefault();
        setFailed(false);
        const outgoing: ControlCommand =
          command.type === "pause"
            ? { type: "pause" }
            : {
                type: command.type,
                enabled: command.type === "theater" ? false : !data.compassOn,
              };
        void connection.send(outgoing).catch(() => setFailed(true));
      } else if (command?.type === "controls") {
        event.preventDefault();
        setFailed(false);
        void showControls().catch(() => setFailed(true));
      } else if (command?.type === "inspect") {
        event.preventDefault();
        setFailed(false);
        void connection.send({ type: "inspect" }).catch(() => setFailed(true));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div class="shell decisions-shell">
      {(failed || syncFailed) && (
        <p class="connection-error" role="alert">
          {t("windows.unreachable")}
        </p>
      )}
      {data && connection ? (
        <Theater
          artwork={artwork}
          state={data.state}
          kind={data.choices.find((choice) => choice.id === data.selectedId)?.kind}
          compassOn={data.compassOn}
          onCompass={() => send({ type: "compass", enabled: !data.compassOn })}
          onClose={() => send({ type: "theater", enabled: false })}
          onPause={() => send({ type: "pause" })}
          minimized={data.minimized}
          inspectVersion={data.inspectVersion}
          pace={data.pace}
          onPace={(pace) => send({ type: "pace", pace })}
          fps={data.fps}
        />
      ) : (
        <p class="connection-status" role="status">
          {t(failed || syncFailed ? "windows.reconnect" : "windows.connecting")}
        </p>
      )}
    </div>
  );
}
