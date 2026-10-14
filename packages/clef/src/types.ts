import type { ClefModel } from "./models.ts";

export interface ChoiceQuestion {
  type: "choice";
  /** Required by Workers AI (omitting it gives a 400). */
  instructions: string;
  /** Option id -> description. Ids are sorted as strings and are part of the model's input. */
  criteria: Record<string, string>;
}

export interface NoulQuestion {
  type: "noul";
  instructions: string;
}

export type Question = ChoiceQuestion | NoulQuestion;

export interface ClefRequest {
  model: ClefModel;
  /** String, array or object. Object keys are sorted by the service, so put ordered data in arrays. */
  state: unknown;
  questions: Record<string, Question>;
  /** data: URLs or raw base64 (PNG/JPEG/WebP), max 4. */
  images?: string[];
  /** Versioning tag mixed into the cache key (prompt version, encoder, ...). */
  cacheTag?: string;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  /** Undocumented by Cloudflare; not the top probability. */
  confidence: number | undefined;
}

export interface NoulAnswer {
  type: "noul";
  /** Probability of "yes". */
  noul: number;
}

export type Answer = ChoiceAnswer | NoulAnswer;

export interface ClefUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ClefResult {
  model: ClefModel;
  answers: Record<string, Answer>;
  usage: ClefUsage;
  /** Round trip of the successful attempt. For cache hits: the latency recorded when it was stored. */
  latencyMs: number;
  /** Attempts used (1 = first try worked). 0 for cache hits. */
  attempts: number;
  cached: boolean;
  /** Neurons charged for this call (0 for cache hits). */
  neurons: number;
}

export interface ClefStats {
  calls: number;
  cacheHits: number;
  retries: number;
  failures: number;
  inputTokens: number;
  neurons: number;
  usd: number;
  /** Latencies (ms) of network calls, in call order. */
  latenciesMs: number[];
}
