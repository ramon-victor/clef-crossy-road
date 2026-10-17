import { type Decision, HOLD_WHYS, type HoldWhy, type WaitWhy } from "@ccr/agent";
import type { Turn } from "../session.ts";
import { spoken } from "./labels.ts";

/** A `RouteStep` as read back from `Decision.extra`, which is untyped: the screen never reads the note's sentence. */
export type ControllerStep =
  | { kind: "hop" }
  | { kind: "wait"; n: number; of: number; cell: string; why: WaitWhy }
  | { kind: "walk"; n: number; left: number }
  | { kind: "leave"; n: number; left: number }
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
    case "walk":
    case "leave":
      return isCount(step.n) && isCount(step.left)
        ? { kind: step.kind, n: step.n, left: step.left }
        : null;
    default:
      return null;
  }
}

/** What the chicken is waiting for, said the way a person watching the game would. */
const WAITING_FOR: Readonly<Record<string, string>> = {
  vehicle: "a vehicle to pass",
  train: "the train to pass",
  train_coming: "the train to pass",
  water: "a log to come",
};

const WOULD_REACH: Readonly<Record<string, string>> = {
  vehicle: "a vehicle",
  train: "the train",
};

export function waitingText(step: Extract<ControllerStep, { kind: "wait" }>): string {
  const count = `${step.n}/${step.of}`;
  if (step.why === "no_rest") {
    const what = WOULD_REACH[step.cell] ?? `the ${spoken(step.cell)}`;
    return `the cell is clear, but ${what} would reach it before the chicken could go on · waiting ${count}`;
  }
  const what = WAITING_FOR[step.cell] ?? `the ${spoken(step.cell)} to clear`;
  return `waiting for ${what} ${count}`;
}

export function walkText(step: Extract<ControllerStep, { kind: "walk" }>): string {
  return `walking the detour: hop ${step.n}, ${step.left} to go`;
}

export function leaveText(step: Extract<ControllerStep, { kind: "leave" }>): string {
  return `getting off the platform: hop ${step.n}, ${step.left} to go`;
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
export function controllerSays(decision: Pick<Decision, "extra" | "note">): string | null {
  if (decision.extra?.fallback !== undefined) return controllerNote(decision);
  const step = controllerStep(decision);
  if (step?.kind === "wait") return waitingText(step);
  if (step?.kind === "walk") return walkText(step);
  if (step?.kind === "leave") return leaveText(step);
  if (step?.kind === "hold") return controllerNote(decision);
  return null;
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
