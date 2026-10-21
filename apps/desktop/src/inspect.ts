import { ENCODER_LEVEL, type ManualId, type PerceptionLevel, parseClefPolicyId } from "@ccr/agent";

export interface PolicyFacts {
  id: string;
  model: string;
  encoder: string;
  /** What the model gets to know, from least to most. */
  level: PerceptionLevel;
  /** How the question and the options are written. */
  style: ManualId;
  /** Set when a controller times the hops: the model only picks the manoeuvre. */
  executor: boolean;
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
    executor:
      config.strategy === "maneuver" ||
      config.strategy === "route" ||
      config.strategy === "route-live",
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
