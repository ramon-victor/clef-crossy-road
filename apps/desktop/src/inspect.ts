import { ENCODER_LEVEL, type ManualId, type PerceptionLevel, parseClefPolicyId } from "@ccr/agent";

/** What each prompt style means, in a line a person can read. */
const STYLE_TEXT: Readonly<Record<ManualId, string>> = {
  full: "long rules, and options that say what each move does",
  minimal: "short rules, and options that say what each move does",
  routing: "short rules, and options that say when each move applies",
  rules: "short rules, and options that name the fields of the state and the words they hold",
  ordered: "short rules, and one short rule per move to try in a stated order",
  exclusive: "short rules, and one short rule per move, written so that only one is true",
  lookup: "two small questions with one lookup each, and solved examples",
};

const LEVEL_TEXT: Readonly<Record<PerceptionLevel, string>> = {
  now: "the world as it is now",
  memory: "the world now, and its own last moves",
  forecast: "the world now, where things will be in 0.2 s, and its own last moves",
  words:
    "what fills the cells it could land on (worked out by the code, told in words), where things will be in 0.2 s, and its own last moves",
};

export interface PolicyFacts {
  id: string;
  model: string;
  encoder: string;
  /** What the model gets to know, from least to most. */
  level: PerceptionLevel;
  sees: string;
  /** How the question and the options are written. */
  style: string;
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
    sees: LEVEL_TEXT[level],
    style: STYLE_TEXT[config.manual],
    executor: config.strategy === "maneuver",
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
