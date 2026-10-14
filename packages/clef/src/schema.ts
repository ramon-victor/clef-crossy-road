import { z } from "zod";
import { ClefError } from "./errors.ts";
import type { Answer, ClefUsage } from "./types.ts";

const choiceAnswer = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number().optional(),
});

const noulAnswer = z.object({
  type: z.literal("noul"),
  noul: z.number(),
});

const answerSchema = z.discriminatedUnion("type", [choiceAnswer, noulAnswer]);

const resultSchema = z.object({
  model: z.string().optional(),
  answers: z.record(z.string(), answerSchema),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number().optional(),
  }),
});

export interface ParsedResult {
  answers: Record<string, Answer>;
  usage: ClefUsage;
}

/**
 * The REST API wraps the payload in `{ result, success, errors, messages }`; the Worker binding
 * returns the payload directly. Accept both.
 */
export function parseResult(json: unknown): ParsedResult {
  const payload =
    typeof json === "object" && json !== null && "result" in json
      ? (json as { result: unknown }).result
      : json;
  const parsed = resultSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ClefError(
      "schema",
      `Unexpected response shape: ${parsed.error.message.slice(0, 300)}`,
    );
  }
  const answers: Record<string, Answer> = {};
  for (const [id, a] of Object.entries(parsed.data.answers)) {
    answers[id] =
      a.type === "choice"
        ? {
            type: "choice",
            choice: a.choice,
            probabilities: a.probabilities,
            confidence: a.confidence,
          }
        : { type: "noul", noul: a.noul };
  }
  return {
    answers,
    usage: {
      inputTokens: parsed.data.usage.input_tokens,
      outputTokens: parsed.data.usage.output_tokens ?? 0,
    },
  };
}

/** Pulls the human-readable messages out of Cloudflare's `errors[]` (never headers or bodies we sent). */
export function errorMessages(json: unknown): string {
  if (typeof json !== "object" || json === null || !("errors" in json)) return "";
  const errors = (json as { errors: unknown }).errors;
  if (!Array.isArray(errors)) return "";
  return errors
    .map((e) => (typeof e === "object" && e !== null && "message" in e ? String(e.message) : ""))
    .filter(Boolean)
    .join("; ")
    .slice(0, 400);
}
