import type { ClefResult } from "@ccr/clef";
import type { Decision, QuestionAnswer } from "./policy.ts";

/**
 * The choice answers of a result by question id, ready to spread into a `Decision`, or nothing when it has none
 * (the `critic` strategy asks yes/no questions that have no options to show).
 */
export function choiceAnswers(result: ClefResult): Pick<Decision, "answers"> {
  const answers: Record<string, QuestionAnswer> = {};
  for (const [id, answer] of Object.entries(result.answers)) {
    if (answer.type === "choice") {
      answers[id] = { choice: answer.choice, probabilities: { ...answer.probabilities } };
    }
  }
  return Object.keys(answers).length > 0 ? { answers } : {};
}
