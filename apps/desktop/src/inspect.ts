import { ENCODER_LEVEL, type ManualId, type PerceptionLevel, parseClefPolicyId } from "@ccr/agent";

export interface PolicyFacts {
  id: string;
  model: string;
  encoder: string;
  /** What the model gets to know, from least to most. */
  level: PerceptionLevel;
  /** How the question and the options are written. */
  style: ManualId;
  /**
   * Who times the hops when a controller takes part: `controller` when the model only picks the manoeuvre,
   * `model` when the model times every hop and the controller only walks paths; null when the model picks each move.
   */
  timedBy: "controller" | "model" | null;
}

/** The facts about a model player that the inspector shows next to what it read; null for anyone else. */
export function policyFacts(policyId: string | null): PolicyFacts | null {
  if (!policyId?.startsWith("clef:")) return null;
  const config = parseClefPolicyId(policyId);
  const level = ENCODER_LEVEL[config.encoder];
  return {
    id: policyId,
    model: config.model,
    encoder: config.encoder,
    level,
    style: config.manual,
    timedBy:
      config.strategy === "route-live"
        ? "model"
        : config.strategy === "maneuver" || config.strategy === "route"
          ? "controller"
          : null,
  };
}

/**
 * Puts text on the clipboard. The webview allows it from a click; the fallback covers the cases where
 * the async API is refused. Returns whether it worked.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = document.createElement("textarea");
    box.value = text;
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    try {
      return document.execCommand("copy");
    } finally {
      box.remove();
    }
  }
}
