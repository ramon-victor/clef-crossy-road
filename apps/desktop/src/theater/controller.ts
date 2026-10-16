import type { Decision } from "@ccr/agent";
import type { Turn } from "../session.ts";
import { spoken } from "./labels.ts";

/**
 * What a step of the controller is (the route strategy reports it with every decision: see `RouteStep`):
 * the crossing made now, standing until the cell ahead clears, one hop of a detour, or a refusal that holds
 * the chicken where it is safe. The screen tells them apart by this and never by reading the sentence.
 */
export type ControllerStep =
  | { kind: "hop" }
  | { kind: "wait"; n: number; of: number; cell: string }
  | { kind: "walk"; n: number; left: number }
  | { kind: "hold" };

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
      return { kind: "hold" };
    case "wait":
      return isCount(step.n) && isCount(step.of) && typeof step.cell === "string"
        ? { kind: "wait", n: step.n, of: step.of, cell: step.cell }
        : null;
    case "walk":
      return isCount(step.n) && isCount(step.left)
        ? { kind: "walk", n: step.n, left: step.left }
        : null;
    default:
      return null;
  }
}

/**
 * The way ahead is not open but things on it will pass, so "go straight" means "go when it is clear". The
 * route strategy tells the three cases apart (open, passing, closed) when it folds the model's answers.
 */
export const isPassing = (decision: Pick<Decision, "extra">): boolean =>
  decision.extra?.ahead === "passing";

/** What the chicken is waiting for, said the way a person watching the game would. */
const WAITING_FOR: Readonly<Record<string, string>> = {
  vehicle: "a vehicle to pass",
  train: "the train to pass",
  train_coming: "the train to pass",
  water: "a log to come",
};

export function waitingText(step: Extract<ControllerStep, { kind: "wait" }>): string {
  const what = WAITING_FOR[step.cell] ?? `the ${spoken(step.cell)} to clear`;
  return `waiting for ${what} ${step.n}/${step.of}`;
}

export function walkText(step: Extract<ControllerStep, { kind: "walk" }>): string {
  return `walking the detour: hop ${step.n}, ${step.left} to go`;
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
 * simply made). A wait and a detour are told from what the step reports; a refusal from the controller's own note.
 */
export function controllerSays(decision: Pick<Decision, "extra" | "note">): string | null {
  const step = controllerStep(decision);
  if (step?.kind === "wait") return waitingText(step);
  if (step?.kind === "walk") return walkText(step);
  if (step?.kind === "hold") return controllerNote(decision);
  return null;
}

/**
 * The round's crossing waits for the way to open: the model's answers say things on that row will pass, or the
 * controller had to wait at some step. "Go straight" then means "go straight when it is clear".
 */
export function waitsForGap(turn: Turn): boolean {
  const waits = (decision: Pick<Decision, "extra">) => controllerStep(decision)?.kind === "wait";
  return (
    isPassing(turn.model.decision) ||
    waits(turn.model.decision) ||
    turn.steps.some((step) => waits(step.decision))
  );
}
