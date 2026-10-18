import { useEffect, useRef, useState } from "preact/hooks";
import type { Bridge } from "./bridge/types.ts";
import type { ControlCommand, ControlsData, SendControl } from "./controls.ts";
import { Panel } from "./Panel.tsx";
import { ConnectionDialog } from "./panel/ConnectionDialog.tsx";
import { InputInspector } from "./panel/InputInspector.tsx";

interface Props {
  data: ControlsData;
  bridge: Bridge;
  send: SendControl;
  inspectorOpen: boolean;
  onInspect(open: boolean): void;
  /** Changes when the native panel is hidden, so write-only forms are discarded. */
  hiddenVersion?: number;
}

/** Shared by the browser sidebar and the native controls window. */
export function ControlSurface({
  data,
  bridge,
  send,
  inspectorOpen,
  onInspect,
  hiddenVersion,
}: Props) {
  const [configuring, setConfiguring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const hidden = useRef(hiddenVersion);
  const latestHidden = useRef(hiddenVersion);
  latestHidden.current = hiddenVersion;

  useEffect(() => {
    if (hiddenVersion === undefined || hidden.current === hiddenVersion) return;
    hidden.current = hiddenVersion;
    setConfiguring(false);
    setError(null);
    onInspect(false);
  }, [hiddenVersion, onInspect]);

  const dispatch = (command: ControlCommand) => {
    setError(null);
    void send(command).catch(() => setError("Could not reach the game. Try again."));
  };

  return (
    <>
      <Panel
        {...data}
        controlError={error}
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
            .catch(() => setError("Could not pause the game. Try again."))
            .finally(() => setOpening(false));
        }}
        onSelect={(id) => dispatch({ type: "select", id })}
        onTiming={(timing) => dispatch({ type: "timing", timing })}
        onSpeed={(speed) => dispatch({ type: "speed", speed })}
        onPause={() => dispatch({ type: "pause" })}
        onStep={() => dispatch({ type: "step" })}
        onRetry={() => dispatch({ type: "retry" })}
        onNewMap={() => dispatch({ type: "newMap" })}
        onInspect={() => onInspect(true)}
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
      {inspectorOpen && (
        <InputInspector
          history={data.state.history}
          policyId={data.state.policyId}
          onClose={() => onInspect(false)}
        />
      )}
    </>
  );
}
