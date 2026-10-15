import type { Decision, ModelInput } from "@ccr/agent";
import { describe, expect, it } from "vitest";
import {
  createConsoleLog,
  formatBrief,
  formatEnd,
  formatFull,
  formatQuestions,
  formatStart,
  parseLogMode,
} from "./console-log.ts";
import type { DecisionLog, SessionEvent, SessionState } from "./session.ts";

const sent: ModelInput = {
  model: "clef-flash",
  state: { player: { col: 0 }, rows: [{ dz: 1, kind: "water", platforms: [] }] },
  questions: {
    move: {
      type: "choice",
      instructions: "You control a chicken. Which move does it make?",
      criteria: { hop_forward: "Go ahead.", stay: "Wait." },
    },
  },
};

function logOf(overrides: Partial<Decision> = {}, index = 2): DecisionLog {
  const decision: Decision = {
    action: "hop_forward",
    probabilities: {
      hop_forward: 0.51,
      hop_left: 0.08,
      hop_right: 0.18,
      stay: 0.05,
      hop_back: 0.18,
    },
    inputTokens: 1425,
    neurons: 0,
    latencyMs: 5,
    cached: true,
    sent,
    ...overrides,
  };
  return { index, tick: 24, row: 9, action: decision.action, decision, wallMs: 5 };
}

/** A decision of a policy that reports nothing: no probabilities, nothing sent. */
const bare = (): DecisionLog => ({
  index: 2,
  tick: 24,
  row: 9,
  action: "hop_forward",
  decision: { action: "hop_forward" },
  wallMs: 5,
});

const start: SessionEvent = { type: "start", seed: 4, policyId: "clef:x", timing: "step" };

describe("parseLogMode", () => {
  it("reads the same words as the native side and turns anything else off", () => {
    expect(parseLogMode("full")).toBe("full");
    for (const word of ["1", "true", "ON", " yes "]) expect(parseLogMode(word)).toBe("full");
    expect(parseLogMode("brief")).toBe("brief");
    for (const word of ["", "off", "0", "loud", null, undefined]) {
      expect(parseLogMode(word)).toBe("off");
    }
  });
});

describe("what is printed", () => {
  it("a new game says who plays, on which seed and how", () => {
    const text = formatStart(start as Extract<SessionEvent, { type: "start" }>, "full");
    expect(text).toContain("NEW GAME");
    expect(text).toContain("player: clef:x");
    expect(text).toContain("seed: 4");
    expect(text).toContain("timing: step");
    expect(
      formatStart(
        { ...(start as { type: "start" }), policyId: null, seed: 1, timing: "step" },
        "brief",
      ),
    ).toContain("you (keyboard)");
  });

  it("a brief line is the move, the probabilities and the cost", () => {
    const line = formatBrief(logOf());
    expect(line).toBe(
      "#3 row 9 -> forward  [forward 51% | left 8% | right 18% | wait 5% | back 18%]  cached | 1425 tokens | 0.00 neurons | 5 ms",
    );
    expect(formatBrief(bare())).toBe("#3 row 9 -> forward");
  });

  it("the full block shows the state exactly as sent and the answer", () => {
    const text = formatFull(logOf());
    expect(text).toContain("--- decision 3 | row 9 | cached | 1425 tokens");
    expect(text).toContain("STATE (as sent,");
    expect(text).toContain('{"dz":1,"kind":"water","platforms":[]}');
    expect(text).toContain("ANSWER: hop_forward");
  });

  it("a decision with nothing sent falls back to the brief line", () => {
    expect(formatFull(bare())).toBe("#3 row 9 -> forward");
  });

  it("the question and the options are printed as the model gets them", () => {
    const text = formatQuestions(sent);
    expect(text).toContain("SENT WITH EVERY DECISION");
    expect(text).toContain('== QUESTION "move" (choice) ==');
    expect(text).toContain("hop_forward: Go ahead.");
  });

  it("the end of a game says how it ended and what it cost", () => {
    const state = {
      score: 2,
      decisions: 2,
      neurons: 1.234,
      seed: 4,
      alive: false,
      stalled: false,
      deathCause: "water",
    };
    const text = formatEnd({ type: "end", state: state as unknown as SessionState });
    expect(text).toBe(
      "==== GAME OVER: Drowned | rows 2 | decisions 2 | 1.23 neurons | seed 4 ====",
    );
  });
});

describe("createConsoleLog", () => {
  const decision = (log: DecisionLog): SessionEvent => ({
    type: "decision",
    seed: 4,
    policyId: "clef:x",
    log,
  });

  it("prints nothing when it is off", () => {
    const lines: string[] = [];
    const handle = createConsoleLog("off", (t) => lines.push(t));
    handle(start);
    handle(decision(logOf()));
    expect(lines).toEqual([]);
  });

  it("the full log shows the question once per game, and every state", () => {
    const lines: string[] = [];
    const handle = createConsoleLog("full", (t) => lines.push(t));
    handle(start);
    handle(decision(logOf({}, 0)));
    handle(decision(logOf({}, 1)));
    handle(decision(logOf({}, 2)));
    const all = lines.join("\n");
    expect(all.match(/SENT WITH EVERY DECISION/g)).toHaveLength(1);
    expect(all.match(/STATE \(as sent/g)).toHaveLength(3);

    handle(start); // a new game: the question is shown again
    handle(decision(logOf({}, 0)));
    expect(lines.join("\n").match(/SENT WITH EVERY DECISION/g)).toHaveLength(2);
  });

  it("shows the question again when it changes inside a game", () => {
    const lines: string[] = [];
    const handle = createConsoleLog("full", (t) => lines.push(t));
    handle(start);
    handle(decision(logOf({}, 0)));
    const other = {
      ...sent,
      questions: { move: { ...sent.questions.move, instructions: "Other." } },
    };
    handle(decision(logOf({ sent: other as ModelInput }, 1)));
    expect(lines.join("\n").match(/SENT WITH EVERY DECISION/g)).toHaveLength(2);
  });

  it("the brief log is one line per decision and never prints the state or the question", () => {
    const lines: string[] = [];
    const handle = createConsoleLog("brief", (t) => lines.push(t));
    handle(start);
    handle(decision(logOf({}, 0)));
    handle(decision(logOf({}, 1)));
    expect(lines).toHaveLength(3);
    expect(lines.join("\n")).not.toContain("STATE");
    expect(lines.join("\n")).not.toContain("QUESTION");
  });

  it("only prints plain ASCII, because the terminal may not read anything else", () => {
    const lines: string[] = [];
    const handle = createConsoleLog("full", (t) => lines.push(t));
    handle({ type: "start", seed: 1, policyId: "café — test", timing: "step" });
    expect(lines.join("")).toMatch(/^[\x20-\x7e\n]*$/);
    expect(lines.join("")).toContain("caf? ? test");
  });
});
