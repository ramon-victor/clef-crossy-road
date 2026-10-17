import type { Decision } from "@ccr/agent";
import type { Turn } from "../session.ts";
import { spoken } from "./labels.ts";

/**
 * What a step of the controller is (the route strategy reports it with every decision: see `RouteStep`):
 * the crossing made now, standing until the cell ahead clears, one hop of a detour, one hop off a platform
 * that carries the chicken to the edge, or a refusal that holds the chicken where it is safe. The screen tells
 * them apart by this and never by reading the sentence.
 */
export type ControllerStep =
  | { kind: "hop" }
  | { kind: "wait"; n: number; of: number; cell: string; why: "gap" | "no_rest" }
  | { kind: "walk"; n: number; left: number }
  | { kind: "leave"; n: number; left: number }
  | { kind: "hold"; why: "refused" | "unsafe_here" | "edge" | "no_way" | null };

const HOLD_WHY = ["refused", "unsafe_here", "edge", "no_way"] as const;

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
      return { kind: "hold", why: HOLD_WHY.find((why) => why === step.why) ?? null };
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

/** What would reach a cell that is clear for the hop but not for the chicken to stay on. */
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
 * simply made). A wait, a detour and a way off a platform are told from what the step reports; a refusal from the
 * controller's own note.
 */
export function controllerSays(decision: Pick<Decision, "extra" | "note">): string | null {
  const step = controllerStep(decision);
  if (step?.kind === "wait") return waitingText(step);
  if (step?.kind === "walk") return walkText(step);
  if (step?.kind === "leave") return leaveText(step);
  if (step?.kind === "hold") return controllerNote(decision);
  return null;
}

/**
 * The round's crossing waited for the way to open: the controller's own first step or a later one stood still for
 * a gap. "Go straight" then means "go straight when it is clear". A way that only opens as things pass but was
 * crossed at once is just "Go straight": the label says what the chicken did, not what the answers allowed.
 */
export function waitsForGap(turn: Turn): boolean {
  const waits = (decision: Pick<Decision, "extra">) => controllerStep(decision)?.kind === "wait";
  return waits(turn.model.decision) || turn.steps.some((step) => waits(step.decision));
}
