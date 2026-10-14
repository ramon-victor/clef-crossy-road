import type { Action } from "@ccr/core";
import type { Decision, PolicyFactory } from "./policy.ts";

/** A policy that gives the same answer every time, for testing the runner without a real player. */
export function constantPolicy(action: Action, extra: Partial<Decision> = {}): PolicyFactory {
  const id = `constant-${action}`;
  return {
    id,
    create: () => ({ kind: "observation", id, decide: async () => ({ action, ...extra }) }),
  };
}
