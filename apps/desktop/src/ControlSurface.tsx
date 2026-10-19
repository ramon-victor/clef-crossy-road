import { useEffect, useRef, useState } from "preact/hooks";
import type { Bridge } from "./bridge/types.ts";
import type { ControlCommand, ControlsData, SendControl } from "./controls.ts";
import { useI18n } from "./i18n/provider.tsx";
import { Panel } from "./Panel.tsx";
import { ConnectionDialog } from "./panel/ConnectionDialog.tsx";

interface Props {
  data: ControlsData;
  bridge: Bridge;
  send: SendControl;
  externalError?: string | null;
  /** Changes when the native panel is hidden, so write-only forms are discarded. */
  hiddenVersion?: number;
}

/** Shared by the browser sidebar and the native controls window. */
export function ControlSurface({ data, bridge, send, hiddenVersion, externalError }: Props) {
  const { t } = useI18n();
  const [configuring, setConfiguring] = useState(false);
  const [error, setError] = useState<"windows.unreachable" | "windows.pauseFailed" | null>(null);
  const [opening, setOpening] = useState(false);
  const hidden = useRef(hiddenVersion);
  const latestHidden = useRef(hiddenVersion);
  latestHidden.current = hiddenVersion;

  useEffect(() => {
    if (hiddenVersion === undefined || hidden.current === hiddenVersion) return;
    hidden.current = hiddenVersion;
    setConfiguring(false);
    setError(null);
  }, [hiddenVersion]);

  const dispatch = (command: ControlCommand) => {
    setError(null);
    void send(command).catch(() => setError("windows.unreachable"));
  };

  return (
    <>
      <Panel
        {...data}
        controlError={error ? t(error) : (externalError ?? null)}
        configuring={opening}
        onConfigure={() => {
          if (opening) return;
          setOpening(true);
          setError(null);
          const startedAt = hiddenVersion;
          // The authoritative session must be paused before credentials can be edited.
          void send({ type: "pauseForSettings" })
            .then(() => {
              if (latestHidden.current === startedAt) setConfiguring(true);
            })
            .catch(() => setError("windows.pauseFailed"))
            .finally(() => setOpening(false));
        }}
        onSelect={(id) => dispatch({ type: "select", id })}
        onTiming={(timing) => dispatch({ type: "timing", timing })}
        onSpeed={(speed) => dispatch({ type: "speed", speed })}
        onPause={() => dispatch({ type: "pause" })}
        onStep={() => dispatch({ type: "step" })}
        onRetry={() => dispatch({ type: "retry" })}
        onNewMap={() => dispatch({ type: "newMap" })}
        onSeed={(seed) => dispatch({ type: "seed", seed })}
        onSound={(enabled) => dispatch({ type: "sound", enabled })}
        onAutoRestart={(enabled) => dispatch({ type: "autoRestart", enabled })}
      />
      {configuring && (
        <ConnectionDialog
          bridge={bridge}
          configured={data.credentials?.configured ?? false}
          onClose={() => setConfiguring(false)}
          onSaved={() => {
            setConfiguring(false);
            dispatch({ type: "credentialsSaved" });
          }}
        />
      )}
    </>
  );
}
