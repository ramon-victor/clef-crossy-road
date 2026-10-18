import type { BudgetStatus, CredentialStatus } from "./bridge/types.ts";
import type { PolicyChoice } from "./policies.ts";
import type { SessionState, Timing } from "./session.ts";
import type { Pace } from "./theater/preference.ts";

/** The panel never receives policy factories or owns a model client. */
export type PlayerOption = Omit<PolicyChoice, "factory"> & { available: boolean };

export function playerOption({ factory, ...description }: PolicyChoice): PlayerOption {
  return { ...description, available: description.kind !== "model" || factory !== null };
}

export interface ControlsData {
  state: SessionState;
  choices: readonly PlayerOption[];
  selectedId: string;
  budget: BudgetStatus | null;
  credentials: CredentialStatus | null;
  fps: number;
  soundOn: boolean;
  autoRestart: boolean;
  bridgeKind: "tauri" | "http";
  minimized: boolean;
  theaterOpen: boolean;
  compassOn: boolean;
  pace: Pace | null;
}

/** A newly opened/reloaded webview has its own performance clock origin. Only display time moves. */
export function controlsForWindow(
  data: ControlsData,
  senderOrigin: number,
  receiverOrigin: number,
): ControlsData {
  const asking = data.state.asking;
  if (!asking) return data;
  return {
    ...data,
    state: {
      ...data.state,
      asking: { ...asking, since: asking.since + senderOrigin - receiverOrigin },
    },
  };
}

export type ControlCommand =
  | { type: "select"; id: string }
  | { type: "timing"; timing: Timing }
  | { type: "speed"; speed: number }
  | { type: "pause" }
  | { type: "pauseForSettings" }
  | { type: "step" }
  | { type: "retry" }
  | { type: "newMap" }
  | { type: "seed"; seed: number }
  | { type: "sound"; enabled: boolean }
  | { type: "autoRestart"; enabled: boolean }
  | { type: "theater"; enabled: boolean }
  | { type: "compass"; enabled: boolean }
  | { type: "pace"; pace: Pace }
  | { type: "credentialsSaved" };

export type SendControl = (command: ControlCommand) => Promise<void>;
