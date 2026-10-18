import { AROUND_OPTIONS, MANEUVER_ACTION, ROUTE_ACTION } from "@ccr/agent";
import { ACTIONS, type Action } from "@ccr/core";
import { type Translator, translator } from "../i18n/translate.ts";
import type { DecisionLog } from "../session.ts";
import { asNumber, asText } from "./view.ts";

export interface BranchView {
  kind: "leaving" | "closed" | "passing" | "open";
  p: number;
}

export interface Bars {
  p: Readonly<Record<Action, number>>;
  blocked: ReadonlySet<Action>;
  branch: BranchView | null;
}

const ACTION_OF: Readonly<Record<string, Action>> = { ...MANEUVER_ACTION, ...ROUTE_ACTION };

const NONE = Object.fromEntries(ACTIONS.map((action) => [action, 0])) as Record<Action, number>;

/** The move the model chose: the manoeuvre it picked, which the controller may start with another move. */
export function winnerOf(log: DecisionLog): Action {
  const maneuver = asText(log.decision.extra?.maneuver);
  if (maneuver === "leave_platform") return log.action;
  return (maneuver ? ACTION_OF[maneuver] : undefined) ?? log.action;
}

/**
 * How much the model wants each move within the fork the routing took, so that the lit move is always the biggest.
 * The joint probabilities the benchmark records add the forks up in one row: a closed way could show "go straight"
 * as the biggest bar (22% of the answers on seeds 6 to 8). A strategy with no routing keeps its own probabilities.
 */
export function barsOf(log: DecisionLog): Bars | null {
  const { decision } = log;
  const extra = decision.extra;
  const maneuver = asText(extra?.maneuver);
  const pClosed = asNumber(extra?.pClosed);
  const around = decision.answers?.around?.probabilities;
  if (maneuver === undefined || pClosed === undefined || !around) {
    if (!decision.probabilities) return null;
    return { p: { ...NONE, ...decision.probabilities }, blocked: new Set(), branch: null };
  }
  if (maneuver === "leave_platform") {
    const p = asNumber(extra?.pLeaving) ?? 1;
    return {
      p: { ...NONE, [log.action]: p },
      blocked: new Set(),
      branch: { kind: "leaving", p },
    };
  }
  const ways = Object.fromEntries(
    AROUND_OPTIONS.map((option) => [ROUTE_ACTION[option], around[option] ?? 0]),
  );
  if (extra?.ahead === "closed") {
    return {
      p: { ...NONE, ...ways },
      blocked: new Set<Action>(["hop_forward"]),
      branch: { kind: "closed", p: pClosed },
    };
  }
  const pCross = 1 - pClosed;
  const scaled = Object.entries(ways).map(([action, p]) => [action, pClosed * p]);
  return {
    p: { ...NONE, hop_forward: pCross, ...Object.fromEntries(scaled) },
    blocked: new Set(),
    branch: {
      kind: extra?.ahead === "passing" ? "passing" : "open",
      p: pCross,
    },
  };
}

export const branchText = (
  { kind, p }: BranchView,
  { t, percent }: Translator = translator("en"),
): string => `${t(`route.branch.${kind}`)} ${percent(p)}`;

/** What the model chose and how much it wanted it; null for a step of the controller. */
export function modelChoice(log: DecisionLog): { move: Action; bars: Bars | null } | null {
  if (log.decision.source === "executor") return null;
  return { move: winnerOf(log), bars: barsOf(log) };
}
