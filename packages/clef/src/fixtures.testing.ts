import type { Transport, TransportRequest, TransportResponse } from "./transport.ts";
import type { ClefRequest } from "./types.ts";

/** A successful REST response with one `move` choice answer that used `inputTokens`. */
export const choiceBody = (choice = "hop_forward", inputTokens = 444) => ({
  result: {
    model: "clef-flash",
    answers: {
      move: {
        type: "choice",
        choice,
        probabilities: { hop_forward: 0.88, hop_back: 0.05, stay: 0.07 },
        confidence: 0.73,
      },
    },
    usage: { input_tokens: inputTokens, output_tokens: 0 },
  },
  success: true,
  errors: [],
  messages: [],
});

/** A request whose cache key depends on `i`, so different `i` are different questions. */
export const sampleRequest = (i = 0): ClefRequest => ({
  model: "clef-flash",
  state: { player: { col: 0 }, rows: [], i },
  questions: {
    move: {
      type: "choice",
      instructions: "Pick a move.",
      criteria: { hop_forward: "forward", stay: "wait" },
    },
  },
});

/**
 * A transport that replays a script of responses (or thrown errors) and then repeats the last one,
 * recording what it was sent.
 */
export function scripted(steps: Array<TransportResponse | Error>) {
  const seen: TransportRequest[] = [];
  let i = 0;
  const transport: Transport = {
    async post(req) {
      seen.push(req);
      const step = steps[Math.min(i++, steps.length - 1)] as TransportResponse | Error;
      if (step instanceof Error) throw step;
      return step;
    },
  };
  return { transport, seen, calls: () => i };
}

/** A transport that always succeeds, reporting `tokens` input tokens, and counts its calls. */
export const countingTransport = (tokens: number) =>
  scripted([{ status: 200, json: choiceBody("hop_forward", tokens) }]);
