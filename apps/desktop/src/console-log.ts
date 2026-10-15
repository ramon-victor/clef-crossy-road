import { prettyState, questionsAsText } from "@ccr/agent";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./bridge/tauri.ts";
import { ACTION_LABEL, ACTION_ORDER, endTitle } from "./format.ts";
import type { DecisionLog, SessionEvent } from "./session.ts";

/** How much to print in the terminal: nothing, one line per decision, or the whole request. */
export type LogMode = "off" | "brief" | "full";

/** The same words the native side reads from `CCR_LOG`. Anything else is off. */
export function parseLogMode(text: string | null | undefined): LogMode {
  switch (text?.trim().toLowerCase()) {
    case "brief":
      return "brief";
    case "full":
    case "1":
    case "true":
    case "on":
    case "yes":
      return "full";
    default:
      return "off";
  }
}

/** The terminal may not read UTF-8, so everything printed is plain ASCII. */
const ascii = (text: string): string => text.replace(/[^\x20-\x7e\n]/g, "?");

const pct = (p: number | undefined): string => (p === undefined ? "-" : `${Math.round(p * 100)}%`);

function probabilitiesText(log: DecisionLog): string {
  const { probabilities } = log.decision;
  if (!probabilities) return "";
  return ACTION_ORDER.map((a) => `${ACTION_LABEL[a]} ${pct(probabilities[a])}`).join(" | ");
}

function costText(log: DecisionLog): string {
  const d = log.decision;
  const parts = [d.cached ? "cached" : "asked the model"];
  if (d.inputTokens !== undefined) parts.push(`${d.inputTokens} tokens`);
  parts.push(`${(d.neurons ?? 0).toFixed(2)} neurons`);
  if (d.latencyMs !== undefined) parts.push(`${Math.round(d.latencyMs)} ms`);
  return parts.join(" | ");
}

export function formatStart(
  event: Extract<SessionEvent, { type: "start" }>,
  mode: LogMode,
): string {
  return [
    "",
    "==== NEW GAME ====",
    `player: ${event.policyId ?? "you (keyboard)"}   seed: ${event.seed}   timing: ${event.timing}   log: ${mode}`,
  ].join("\n");
}

/** One line: the move, how likely the model found it, and what it cost. */
export function formatBrief(log: DecisionLog): string {
  const answer = log.decision.probabilities
    ? `  [${probabilitiesText(log)}]  ${costText(log)}`
    : "";
  return `#${log.index + 1} row ${log.row} -> ${ACTION_LABEL[log.action]}${answer}`;
}

/** The request of a decision with its state and the answer, for the full log. */
export function formatFull(log: DecisionLog): string {
  const sent = log.decision.sent;
  if (!sent) return formatBrief(log);
  const state = prettyState(sent.state);
  return [
    "",
    `--- decision ${log.index + 1} | row ${log.row} | ${costText(log)}`,
    `STATE (as sent, ${state.length} characters):`,
    state,
    `ANSWER: ${log.action}   [${probabilitiesText(log)}]`,
  ].join("\n");
}

/** The question and the options: sent with every decision and identical in all of them. */
export function formatQuestions(sent: NonNullable<DecisionLog["decision"]["sent"]>): string {
  return ["", "---- SENT WITH EVERY DECISION OF THIS GAME ----", questionsAsText(sent)].join("\n");
}

export function formatEnd(event: Extract<SessionEvent, { type: "end" }>): string {
  const s = event.state;
  return `==== GAME OVER: ${endTitle(s)} | rows ${s.score} | decisions ${s.decisions} | ${s.neurons.toFixed(2)} neurons | seed ${s.seed} ====`;
}

/**
 * What to print for each thing that happens in a game, given the mode. The question and options are
 * printed once per game (and again if they change), because they are the same for every decision.
 */
export function createConsoleLog(
  mode: LogMode,
  write: (text: string) => void,
): (event: SessionEvent) => void {
  let questionsShown: string | null = null;
  return (event) => {
    if (mode === "off") return;
    switch (event.type) {
      case "start":
        questionsShown = null;
        write(ascii(formatStart(event, mode)));
        break;
      case "decision": {
        const sent = event.log.decision.sent;
        if (mode === "full" && sent) {
          const key = JSON.stringify(sent.questions);
          if (key !== questionsShown) {
            questionsShown = key;
            write(ascii(formatQuestions(sent)));
          }
        }
        write(ascii(mode === "full" ? formatFull(event.log) : formatBrief(event.log)));
        break;
      }
      case "end":
        write(ascii(formatEnd(event)));
        break;
    }
  };
}

/** Where the lines go: the native side prints them in the terminal; in a browser, the console. */
export function terminalWriter(): (text: string) => void {
  if (!isTauri()) return (text) => console.log(text);
  return (text) => {
    invoke("console_log", { text }).catch(() => {});
  };
}
