// Shared by the tests of this folder: a real session playing the default gameplay on a fake Clef, so what
// they read is what the app would hold (no network, no key).
import { clefPolicy, DEFAULT_CLEF } from "@ccr/agent";
import { ClefClient, MemoryCache, type Transport } from "@ccr/clef";
import { Session } from "../session.ts";

export const FRAME = 1 / 60;

/** Lets pending promise callbacks run, without waiting for a timer. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

export function choice(picked: string, probabilities: Record<string, number>) {
  return { type: "choice", choice: picked, probabilities, confidence: 0.5 };
}

/** A Clef that answers with `answers` whatever it is asked. */
export function clientAnswering(answers: Record<string, unknown>): ClefClient {
  const transport: Transport = {
    async post() {
      return {
        status: 200,
        json: {
          result: { answers, usage: { input_tokens: 1500, output_tokens: 0 } },
          success: true,
        },
      };
    },
  };
  return new ClefClient({ transport, cache: new MemoryCache(), sleep: async () => {} });
}

/** The three lookups of the default gameplay, answered as told. */
export const routeAnswers = (cell: string, moving: string, around: string, pStand = 0.8) => ({
  cell: choice(cell, { stand: pStand, no_stand: 1 - pStand }),
  moving: choice(moving, { moving: 0.5, still: 0.5 }),
  around: choice(around, { detour_left: 0.2, detour_right: 0.6, wait_here: 0.2 }),
});

/** A session playing the default gameplay, stopped while the first question is out. */
export function readingSession(answers: Record<string, unknown>, seed = 4): Session {
  const session = new Session();
  session.setPolicy(clefPolicy(clientAnswering(answers), DEFAULT_CLEF));
  session.start(seed);
  session.frame(FRAME);
  return session;
}

/** The same, once the model has answered and the controller has taken `steps` steps of its manoeuvre. */
export async function answeredSession(
  answers: Record<string, unknown>,
  seed = 4,
  steps = 0,
): Promise<Session> {
  const session = readingSession(answers, seed);
  await settle();
  for (let i = 0; i < 600 && session.state().stepsSinceModel < steps; i++) {
    session.frame(FRAME);
    await settle();
  }
  return session;
}
