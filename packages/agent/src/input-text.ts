import type { Question } from "@ccr/clef";
import type { ModelInput } from "./policy.ts";

/**
 * The state as a person reads it. A string (a text map) is shown as it is. JSON keeps its shape but
 * each row of the world goes on its own line, so a map of twelve rows is not one long line. This is
 * only for display: what is sent is the object itself.
 */
export function prettyState(state: unknown): string {
  if (typeof state === "string") return state;
  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    return JSON.stringify(state, null, 2);
  }
  const parts = Object.entries(state).map(([key, value]) => {
    if (key !== "rows" || !Array.isArray(value))
      return `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`;
    const rows = value.map((row) => `    ${JSON.stringify(row)}`).join(",\n");
    return `  "rows": [\n${rows}\n  ]`;
  });
  return `{\n${parts.join(",\n")}\n}`;
}

/** One sentence per line, for reading a long instruction. Display only; the text sent is unchanged. */
export const sentences = (text: string): string => text.replace(/\.\s+(?=[A-Z])/g, ".\n");

/** What the model was sent, as JSON a person can paste into a conversation. */
export function inputAsJson(input: ModelInput): string {
  return JSON.stringify(input, null, 2);
}

/** The options of a choice question as `[id, description]`, in the order the service sorts them. */
export function optionsOf(question: Question): Array<[string, string]> {
  return question.type === "choice"
    ? Object.entries(question.criteria).sort(([a], [b]) => a.localeCompare(b))
    : [];
}

/**
 * The part of a request that is the same for every decision of a game: each question with its
 * instructions and its options, as plain text.
 */
export function questionsAsText(input: ModelInput): string {
  const sections: string[] = [];
  for (const [id, question] of Object.entries(input.questions)) {
    sections.push(
      `== QUESTION "${id}" (${question.type}) ==`,
      sentences(question.instructions),
      "",
    );
    const options = optionsOf(question);
    if (options.length > 0) {
      sections.push(
        `== OPTIONS of "${id}" ==`,
        ...options.map(([name, text]) => `${name}: ${text}`),
        "",
      );
    }
  }
  return sections.join("\n");
}

/** The input as plain text, the way `bench show-input` prints it. */
export function inputAsText(input: ModelInput): string {
  const sections = [questionsAsText(input), "== STATE ==", prettyState(input.state)];
  if (input.images) {
    sections.push(
      "",
      `(${input.images} picture${input.images === 1 ? "" : "s"} sent with the state)`,
    );
  }
  return sections.join("\n");
}
