import { inputAsJson, type ModelInput, optionsOf, prettyState, sentences } from "@ccr/agent";
import { useEffect, useState } from "preact/hooks";
import { ACTION_GLYPH, ACTION_LABEL, ACTION_ORDER, ms, percent } from "../format.ts";
import { copyText, policyFacts } from "../inspect.ts";
import type { DecisionLog } from "../session.ts";

type Tab = "state" | "question" | "options" | "answer";

const TABS: readonly { id: Tab; label: string }[] = [
  { id: "state", label: "State" },
  { id: "question", label: "Question" },
  { id: "options", label: "Options" },
  { id: "answer", label: "Answer" },
];

export interface InputInspectorProps {
  history: readonly DecisionLog[];
  policyId: string | null;
  onClose(): void;
}

function StateTab({ sent }: { sent: ModelInput }) {
  return (
    <>
      <p class="hint">
        The state the model evaluates, exactly as sent ({JSON.stringify(sent.state).length}{" "}
        characters).
        {sent.images ? ` ${sent.images} picture(s) went with it.` : ""}
      </p>
      <pre class="inspector-pre">{prettyState(sent.state)}</pre>
    </>
  );
}

function QuestionTab({ sent }: { sent: ModelInput }) {
  return (
    <>
      <p class="hint">
        The instructions of each question, one sentence per line here (they are sent as one text).
      </p>
      {Object.entries(sent.questions).map(([id, question]) => (
        <div key={id}>
          <div class="field-label">
            {id} · {question.type} · {question.instructions.length} characters
          </div>
          <pre class="inspector-pre">{sentences(question.instructions)}</pre>
        </div>
      ))}
    </>
  );
}

function OptionsTab({ sent }: { sent: ModelInput }) {
  const choices = Object.entries(sent.questions).filter(([, q]) => q.type === "choice");
  if (choices.length === 0) {
    return (
      <p class="hint">This player asks yes/no questions, so it has no options to choose from.</p>
    );
  }
  return (
    <>
      <p class="hint">The options the model picks from, and the text it is given for each.</p>
      {choices.map(([id, question]) => (
        <table class="options" key={id}>
          <tbody>
            {optionsOf(question).map(([name, text]) => (
              <tr key={name}>
                <th>{name}</th>
                <td>{text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </>
  );
}

function AnswerTab({ log }: { log: DecisionLog }) {
  const d = log.decision;
  return (
    <>
      <p class="hint">
        What the model answered: its probability for each option, and the move taken (the most
        likely one).
      </p>
      <div class="bars">
        {ACTION_ORDER.map((a) => (
          <div class={`bar-row ${a === log.action ? "chosen-row" : ""}`} key={a}>
            <span class="bar-glyph">{ACTION_GLYPH[a]}</span>
            <span class="bar-name">{ACTION_LABEL[a]}</span>
            <div class="bar">
              <div style={{ width: `${Math.round((d.probabilities?.[a] ?? 0) * 100)}%` }} />
            </div>
            <span class="bar-num">{percent(d.probabilities?.[a])}</span>
          </div>
        ))}
      </div>
      <p class="hint">
        {d.cached ? "answered from the cache (free)" : "answered by the model"} ·{" "}
        {d.inputTokens ?? "?"} input tokens · {(d.neurons ?? 0).toFixed(2)} neurons ·{" "}
        {ms(d.latencyMs)}
        {d.confidence !== undefined
          ? ` · confidence ${d.confidence.toFixed(2)} (undocumented)`
          : ""}
      </p>
    </>
  );
}

/**
 * A window over the game that shows what the model read for a decision: the state, the question, the
 * options and its answer, as sent. It is the place to look when the chicken does something odd.
 */
export function InputInspector({ history, policyId, onClose }: InputInspectorProps) {
  const [picked, setPicked] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("state");
  const [copied, setCopied] = useState(false);
  const facts = policyFacts(policyId);
  const log = history.find((h) => h.index === picked) ?? history[history.length - 1];
  const sent = log?.decision.sent;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async () => {
    if (!sent) return;
    setCopied(await copyText(inputAsJson(sent)));
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div class="inspector" role="dialog" aria-label="What the model read">
      <header class="inspector-head">
        <div>
          <div class="inspector-title">What the model read</div>
          {facts && (
            <div class="inspector-sub">
              <code>{facts.id}</code>
              <br />
              sees {facts.sees}; question: {facts.style}
            </div>
          )}
        </div>
        <div class="inspector-actions">
          <button type="button" class="btn small" onClick={copy} disabled={!sent}>
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" class="btn small" onClick={onClose}>
            Close
          </button>
        </div>
      </header>

      {!log || !sent ? (
        <p class="hint inspector-empty">
          Nothing to show yet. Pick the Clef and let it make a move: this window shows what it was
          sent for each decision. The look-ahead and the baselines never ask a model.
        </p>
      ) : (
        <>
          <div class="inspector-chips" title="Recent decisions">
            {history.map((h) => (
              <button
                type="button"
                key={h.index}
                class={`chip ${h.index === log.index ? "on" : ""}`}
                title={`Decision ${h.index + 1}: ${ACTION_LABEL[h.action]} at row ${h.row}`}
                onClick={() => setPicked(h.index)}
              >
                {ACTION_GLYPH[h.action]}
              </button>
            ))}
            <button
              type="button"
              class={`btn small ${picked === null ? "primary" : ""}`}
              onClick={() => setPicked(null)}
            >
              Latest
            </button>
            <span class="hint">
              decision {log.index + 1} · row {log.row} · took {ACTION_LABEL[log.action]}
            </span>
          </div>

          <nav class="inspector-tabs">
            {TABS.map((t) => (
              <button
                type="button"
                key={t.id}
                class={tab === t.id ? "on" : ""}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div class="inspector-body">
            {tab === "state" && <StateTab sent={sent} />}
            {tab === "question" && <QuestionTab sent={sent} />}
            {tab === "options" && <OptionsTab sent={sent} />}
            {tab === "answer" && <AnswerTab log={log} />}
          </div>
        </>
      )}
    </div>
  );
}
