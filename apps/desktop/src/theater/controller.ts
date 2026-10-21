import { type Decision, HOLD_WHYS, type HoldWhy, type WaitWhy } from "@ccr/agent";
import { noticeText } from "../i18n/presentation.ts";
import { type Translator, translator } from "../i18n/translate.ts";
import type { DecisionLog, SessionState, Turn } from "../session.ts";
import { spoken } from "./labels.ts";

/** A `RouteStep` as read back from `Decision.extra`, which is untyped: the screen never reads the note's sentence. */
export type ControllerStep =
  | { kind: "hop" }
  | { kind: "wait"; n: number; of: number; cell: string; why: WaitWhy }
  | { kind: "walk"; n: number; left: number }
  | { kind: "leave"; n: number; left: number }
  | { kind: "dodge"; left: number }
  | { kind: "hold"; why: HoldWhy | null };

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** The kind of step a decision was, or null for one with no controller behind it (the model's plain moves). */
export function controllerStep(decision: Pick<Decision, "extra">): ControllerStep | null {
  const raw = decision.extra?.controller;
  if (raw === null || typeof raw !== "object") return null;
  const step = raw as Record<string, unknown>;
  switch (step.kind) {
    case "hop":
      return { kind: "hop" };
    case "hold":
      return { kind: "hold", why: HOLD_WHYS.find((why) => why === step.why) ?? null };
    case "wait":
      return isCount(step.n) && isCount(step.of) && typeof step.cell === "string"
        ? {
            kind: "wait",
            n: step.n,
            of: step.of,
            cell: step.cell,
            why: step.why === "no_rest" ? "no_rest" : "gap",
          }
        : null;
    case "dodge":
      return isCount(step.left) ? { kind: "dodge", left: step.left } : null;
    case "walk":
    case "leave":
      return isCount(step.n) && isCount(step.left)
        ? { kind: step.kind, n: step.n, left: step.left }
        : null;
    default:
      return null;
  }
}

export function waitingText(
  step: Extract<ControllerStep, { kind: "wait" }>,
  { t }: Translator = translator("en"),
): string {
  const cell = step.cell === "train_coming" ? "train" : step.cell;
  let obstacle: string;
  if (step.why === "no_rest") {
    obstacle =
      cell === "vehicle" || cell === "train"
        ? t(`controller.approach.${cell}`)
        : cell === "water"
          ? t("cell.water")
          : spoken(cell);
  } else {
    obstacle =
      cell === "vehicle" || cell === "train" || cell === "water"
        ? t(`controller.pass.${cell}`)
        : t("controller.pass.other", { cell: spoken(cell) });
  }
  // A wait with no limit (`of` is 0) is the model's own, one decision at a time.
  const key =
    step.why === "no_rest"
      ? "controller.waitRest"
      : step.of === 0
        ? "controller.waitLive"
        : "controller.waitGap";
  return t(key, { ...step, obstacle });
}

export function walkText(
  step: Extract<ControllerStep, { kind: "walk" }>,
  { t }: Translator = translator("en"),
): string {
  return t("controller.walk", step);
}

export function leaveText(
  step: Extract<ControllerStep, { kind: "leave" }>,
  { t }: Translator = translator("en"),
): string {
  return t("controller.leave", step);
}

/**
 * What the controller says about a step, without the name of the manoeuvre it belongs to ("cross_ahead:
 * waiting for the cell (water) to clear, 3/15" -> "waiting for the cell (water) to clear, 3/15").
 */
export function controllerNote(decision: Pick<Decision, "note">): string | null {
  const text = decision.note;
  if (!text) return null;
  const note = text.replace(/^model chose [^;]+;\s*/, "").replace(/^\w+:\s*/, "");
  return note.length > 0 ? note : null;
}

/**
 * What the controller is doing at a step, in a sentence, or null when there is nothing to say (the crossing is
 * simply made). A wait, a detour and a way off a platform are told from what the step reports; a refusal, and a
 * manoeuvre that began as another one, from the controller's own note.
 */
export function controllerSays(
  decision: Pick<Decision, "extra" | "note" | "notice">,
  translation: Translator = translator("en"),
): string | null {
  if (decision.extra?.fallback !== undefined && decision.notice)
    return noticeText(decision.notice, translation);
  if (decision.extra?.fallback !== undefined) return controllerNote(decision);
  const step = controllerStep(decision);
  if (step?.kind === "wait") return waitingText(step, translation);
  if (step?.kind === "walk") return walkText(step, translation);
  if (step?.kind === "leave") return leaveText(step, translation);
  if (step?.kind === "hold" || step?.kind === "dodge")
    return decision.notice ? noticeText(decision.notice, translation) : controllerNote(decision);
  return null;
}

/** The wait the session has played and not yet followed. Unlike the live execution, it holds through the idle frames between two waits. */
export function waitingStep(
  state: Pick<SessionState, "last" | "playback" | "phase">,
): Extract<ControllerStep, { kind: "wait" }> | null {
  const { last } = state;
  if (last?.action !== "stay" || state.phase === "reading") return null;
  if (state.playback?.index !== last.index || state.playback.outcome !== "stay") return null;
  const step = controllerStep(last.decision);
  return step?.kind === "wait" ? step : null;
}

/** The crossing waited for a gap, in the controller's first step or a later one: "Go straight" then reads "when clear". */
export function waitsForGap(turn: Turn): boolean {
  const waits = (decision: Pick<Decision, "extra">) => controllerStep(decision)?.kind === "wait";
  return waits(turn.model.decision) || turn.steps.some((step) => waits(step.decision));
}

/** Folds each run of consecutive waits into one item with a count. */
export function foldWaits<E, T extends { count: number }>(
  entries: readonly E[],
  isWait: (entry: E) => boolean,
  make: (entry: E) => T,
  extend: (item: T, entry: E) => T = (item) => item,
): T[] {
  const items: T[] = [];
  let inRun = false;
  for (const entry of entries) {
    const waits = isWait(entry);
    const last = items.at(-1);
    if (waits && inRun && last) {
      items[items.length - 1] = { ...extend(last, entry), count: last.count + 1 };
      continue;
    }
    items.push(make(entry));
    inRun = waits;
  }
  return items;
}

/** Fold waits only when their recorded reason and source match; counters may advance. */
export function recordedSteps(
  entries: readonly DecisionLog[],
): Array<{ log: DecisionLog; count: number }> {
  const items: Array<{ log: DecisionLog; count: number }> = [];
  const identity = (log: DecisionLog) => {
    const step = controllerStep(log.decision);
    const notice = log.decision.notice;
    return JSON.stringify({
      source: log.decision.source,
      step:
        step?.kind === "wait"
          ? { kind: step.kind, cell: step.cell, why: step.why, of: step.of }
          : step,
      notice:
        step?.kind === "wait" && notice?.kind === "waiting"
          ? { ...notice, waited: undefined }
          : notice,
      note: step ? undefined : log.decision.note,
    });
  };
  for (const log of entries) {
    const last = items.at(-1);
    if (
      last &&
      last.log.action === "stay" &&
      log.action === "stay" &&
      identity(last.log) === identity(log)
    ) {
      items[items.length - 1] = { log, count: last.count + 1 };
    } else items.push({ log, count: 1 });
  }
  return items;
}
