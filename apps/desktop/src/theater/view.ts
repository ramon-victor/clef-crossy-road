import { optionsOf } from "@ccr/agent";
import type { DecisionLog } from "../session.ts";
import { optionLabel, orderOptions, ROUTE_LABELS, titleOf } from "./labels.ts";

/** What to draw: nothing yet, a question the model is reading, or the answer it gave. */
export type FrameMode = "waiting" | "reading" | "answered";

export interface OptionView {
  id: string;
  glyph: string;
  label: string;
  short: string;
  /** The rule the option carries in the request, as sent (for a tooltip). */
  rule: string;
  /** The probability the model gave it; null while the model is still reading. */
  p: number | null;
  chosen: boolean;
}

export interface QuestionView {
  id: string;
  title: string;
  options: OptionView[];
  /** The option the model picked; null while it reads. */
  chosen: string | null;
  /** The answer did not matter this time, and why (the routing never looked at it). */
  skipped: string | null;
}

export const asText = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/** Which questions the routing never looked at, with the reason (the `route` strategy only). */
function skippedBecause(
  questionId: string,
  extra: Record<string, unknown> | undefined,
): string | null {
  const ahead = asText(extra?.ahead);
  if (ahead === undefined) return null;
  if (questionId === "moving" && extra?.cell === "stand") return "not needed: it can stand there";
  if (questionId === "around" && ahead !== "closed")
    return "not needed: the way ahead isn't closed";
  return null;
}

/**
 * The questions of a request with their options, and, once `log` is the decision they led to, what the
 * model answered to each. Only choice questions have options to show.
 */
export function questionsOf(
  input: NonNullable<DecisionLog["decision"]["sent"]>,
  log: DecisionLog | null,
): QuestionView[] {
  const answers = log?.decision.answers;
  const extra = log?.decision.extra;
  const ids = Object.keys(ROUTE_LABELS).every((id) => id in input.questions)
    ? Object.keys(ROUTE_LABELS)
    : Object.keys(input.questions);
  const views: QuestionView[] = [];
  for (const id of ids) {
    const question = input.questions[id];
    if (!question) continue;
    const rules = optionsOf(question);
    if (rules.length === 0) continue;
    const answer = answers?.[id];
    const ruleOf = new Map(rules);
    const options = orderOptions(
      id,
      rules.map(([option]) => option),
    ).map((option): OptionView => {
      const words = optionLabel(id, option);
      return {
        id: option,
        glyph: words.glyph,
        label: words.label,
        short: words.short,
        rule: ruleOf.get(option) ?? "",
        p: answer ? (answer.probabilities[option] ?? 0) : null,
        chosen: answer?.choice === option,
      };
    });
    views.push({
      id,
      title: titleOf(id),
      options,
      chosen: answer?.choice ?? null,
      skipped: answer ? skippedBecause(id, extra) : null,
    });
  }
  return views;
}
