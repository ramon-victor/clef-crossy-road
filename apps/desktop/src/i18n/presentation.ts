import { DEFAULT_CLEF, DEFAULT_STALL_LIMIT, type DecisionNotice, decisionCost } from "@ccr/agent";
import { FREE_NEURONS_PER_DAY } from "@ccr/clef";
import type { Action } from "@ccr/core";
import type { PolicyChoice } from "../policies.ts";
import type { SessionState } from "../session.ts";
import type { Translator } from "./translate.ts";

export function actionLabel(action: Action, { t }: Translator): string {
  return t(`actions.${action}`);
}

export function gameEndTitle(
  state: Pick<SessionState, "alive" | "stalled" | "deathCause">,
  { t }: Translator,
): string {
  if (state.alive && state.stalled) return t("game.stalled", { count: DEFAULT_STALL_LIMIT });
  return state.deathCause ? t(`death.${state.deathCause}`) : t("game.over");
}

const baseDecisionCost = decisionCost(DEFAULT_CLEF).neurons;

export function playerText(
  choice: Pick<PolicyChoice, "id" | "presentation" | "neuronsPerDecision">,
  { t }: Translator,
) {
  const cost = Math.round(choice.neuronsPerDecision ?? 0);
  return {
    label: t(`player.${choice.presentation}.label`, { id: choice.id }),
    detail: t(`player.${choice.presentation}.detail`, {
      cost,
      ratio: Math.round((choice.neuronsPerDecision ?? 0) / baseDecisionCost),
      sets: Math.floor(FREE_NEURONS_PER_DAY / (choice.neuronsPerDecision ?? 1)),
    }),
  };
}

export function noticeText(notice: DecisionNotice, translation: Translator): string {
  const { t } = translation;
  const maneuver = "maneuver" in notice ? t(`maneuver.${notice.maneuver}`) : "";
  const cell = "cell" in notice ? t(`cell.${notice.cell}`) : "";
  switch (notice.kind) {
    case "sequence":
      return notice.parts.map((part) => noticeText(part, translation)).join(" ");
    case "model":
      return t("notice.model", { maneuver, step: noticeText(notice.step, translation) });
    case "refused":
    case "returned":
      return t(`notice.${notice.kind}`, {
        maneuver,
        reason: noticeText(notice.reason, translation),
      });
    case "clear":
    case "go":
      return t(`notice.${notice.kind}`, { maneuver });
    case "waiting":
      return t("notice.waiting", { maneuver, cell, waited: notice.waited, limit: notice.limit });
    case "escape":
      return t("notice.escape", {
        action: actionLabel(notice.action, translation),
        remaining: notice.remaining,
        count: notice.remaining,
      });
    case "detour":
      return t("notice.detour", {
        maneuver,
        action: actionLabel(notice.action, translation),
        step: notice.step,
        remaining: notice.remaining,
        count: notice.remaining,
      });
    case "permanent":
    case "cannot_stay":
    case "not_exposed":
      return t(`notice.${notice.kind}`, { cell });
    case "timeout":
      return t("notice.timeout", { cell, count: notice.count });
    case "too_long":
    case "still_carried":
    case "no_exit":
      return t(`notice.${notice.kind}`, { count: notice.count });
    case "no_route":
      return t("notice.no_route", {
        side: t(`side.${notice.side}`),
        count: notice.count,
      });
    case "hopped":
    case "reached":
      return t(`notice.${notice.kind}`, { maneuver, count: notice.count });
    default:
      return t(`notice.${notice.kind}`);
  }
}
