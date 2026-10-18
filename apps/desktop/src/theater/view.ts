import { optionsOf } from "@ccr/agent";
import { type Translator, translator } from "../i18n/translate.ts";
import type { DecisionLog } from "../session.ts";
import { ALWAYS_ASKED, optionLabel, orderOptions, ROUTE_LABELS, titleOf } from "./labels.ts";

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

export const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Which questions the routing never looked at, with the reason (the `route` strategy only). */
function skippedBecause(
  questionId: string,
  extra: Record<string, unknown> | undefined,
  { t }: Translator,
): string | null {
  const ahead = asText(extra?.ahead);
  if (ahead === undefined) return null;
  if (extra?.ride === "leaving" && ALWAYS_ASKED.some((id) => id === questionId)) {
    return t("route.skip.leaving");
  }
  if (questionId === "moving" && extra?.cell === "stand") return t("route.skip.stand");
  if (questionId === "around" && ahead !== "closed") return t("route.skip.open");
  return null;
}

/**
 * The questions of a request with their options, and, once `log` is the decision they led to, what the
 * model answered to each. Only choice questions have options to show.
 */
export function questionsOf(
  input: NonNullable<DecisionLog["decision"]["sent"]>,
  log: DecisionLog | null,
  translation: Translator = translator("en"),
): QuestionView[] {
  const answers = log?.decision.answers;
  const extra = log?.decision.extra;
  const isRoute = ALWAYS_ASKED.every((id) => id in input.questions);
  const ids = isRoute
    ? Object.keys(ROUTE_LABELS).filter((id) => id in input.questions)
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
      const words = optionLabel(id, option, translation);
      return {
        id: option,
        glyph: words.glyph,
        label: words.label,
        short: words.short,
        rule: ruleOf.get(option) ?? "",
        p: answer ? (answer.probabilities[option] ?? null) : null,
        chosen: answer?.choice === option,
      };
    });
    views.push({
      id,
      title: titleOf(id, translation),
      options,
      chosen: answer?.choice ?? null,
      skipped: answer ? skippedBecause(id, extra, translation) : null,
    });
  }
  return views;
}
