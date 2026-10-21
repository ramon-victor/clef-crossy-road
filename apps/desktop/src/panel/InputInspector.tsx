import { inputAsJson, type ModelInput, optionsOf, prettyState, sentences } from "@ccr/agent";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { ACTION_GLYPH, ACTION_ORDER } from "../format.ts";
import { actionLabel } from "../i18n/presentation.ts";
import { useI18n } from "../i18n/provider.tsx";
import { copyText, policyFacts } from "../inspect.ts";
import type { DecisionLog } from "../session.ts";

const TABS = ["state", "question", "options", "answer"] as const;
type Tab = (typeof TABS)[number];

export interface InputInspectorProps {
  history: readonly DecisionLog[];
  policyId: string | null;
  onClose(): void;
}

function StateTab({ sent }: { sent: ModelInput }) {
  const { t } = useI18n();
  return (
    <>
      <p class="hint">{t("inspect.stateHelp", { count: JSON.stringify(sent.state).length })}</p>
      {sent.images !== undefined && (
        <p class="hint">{t("inspect.images", { count: sent.images })}</p>
      )}
      <pre class="inspector-pre" lang="en" dir="ltr">
        {prettyState(sent.state)}
      </pre>
    </>
  );
}

function QuestionTab({ sent }: { sent: ModelInput }) {
  const { t } = useI18n();
  return (
    <>
      <p class="hint">{t("inspect.questionHelp")}</p>
      {Object.entries(sent.questions).map(([id, question]) => (
        <div key={id}>
          <div class="field-label">
            <code lang="en">
              {id} · {question.type}
            </code>{" "}
            · {t("inspect.characters", { count: question.instructions.length })}
          </div>
          <pre class="inspector-pre" lang="en" dir="ltr">
            {sentences(question.instructions)}
          </pre>
        </div>
      ))}
    </>
  );
}

function OptionsTab({ sent }: { sent: ModelInput }) {
  const { t } = useI18n();
  const choices = Object.entries(sent.questions).filter(
    ([, question]) => question.type === "choice",
  );
  if (choices.length === 0) return <p class="hint">{t("inspect.noOptions")}</p>;
  return (
    <>
      <p class="hint">{t("inspect.optionsHelp")}</p>
      {choices.map(([id, question]) => (
        <table class="options" key={id} lang="en" dir="ltr">
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
  const translation = useI18n();
  const { t, number, percent, ms } = translation;
  const decision = log.decision;
  return (
    <>
      <p class="hint">{t("inspect.answerHelp")}</p>
      <div class="bars">
        {ACTION_ORDER.map((action) => (
          <div class={`bar-row ${action === log.action ? "chosen-row" : ""}`} key={action}>
            <span class="bar-glyph">{ACTION_GLYPH[action]}</span>
            <span class="bar-name">{actionLabel(action, translation)}</span>
            <div class="bar">
              <div
                style={{ width: `${Math.round((decision.probabilities?.[action] ?? 0) * 100)}%` }}
              />
            </div>
            <span class="bar-num">{percent(decision.probabilities?.[action])}</span>
          </div>
        ))}
      </div>
      <p class="hint">
        {t(decision.cached ? "inspect.cached" : "inspect.model")} ·{" "}
        {t("inspect.tokens", {
          value: decision.inputTokens === undefined ? "?" : number(decision.inputTokens),
        })}{" "}
        ·{" "}
        {decision.neurons === undefined && !decision.cached
          ? t("theater.unavailable")
          : t("inspect.neurons", {
              value: decision.cached ? 0 : (decision.neurons ?? 0),
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
        ·{" "}
        {decision.cached
          ? t("theater.originalLatency", { time: ms(decision.latencyMs) })
          : ms(decision.latencyMs)}
      </p>
      {decision.confidence !== undefined && (
        <p class="hint">
          {t("decision.confidence", {
            value: decision.confidence,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </p>
      )}
    </>
  );
}

export function InputInspector({ history, policyId, onClose }: InputInspectorProps) {
  const translation = useI18n();
  const { t } = translation;
  const closeRef = useRef<HTMLButtonElement>(null);
  const copyRequest = useRef(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("state");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const facts = policyFacts(policyId);
  const log = history.find((entry) => entry.decision.sent);
  const sent = log?.decision.sent;
  const controllerSince = log
    ? history.filter((entry) => entry.index > log.index && entry.decision.source === "executor")
        .length
    : 0;

  useLayoutEffect(() => {
    const previous = document.activeElement;
    const focus = () => {
      closeRef.current?.focus({ preventScroll: true });
      closeRef.current?.scrollIntoView?.({ block: "nearest" });
    };
    focus();
    // A native window can finish activation after this commit; focus once more after layout.
    const frame = requestAnimationFrame(focus);
    if (!document.hasFocus()) window.addEventListener("focus", focus, { once: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("focus", focus);
      ++copyRequest.current;
      clearTimeout(copyTimer.current);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async () => {
    if (!sent) return;
    const request = ++copyRequest.current;
    const copied = await copyText(inputAsJson(sent));
    if (request !== copyRequest.current) return;
    setCopyStatus(copied ? "copied" : "error");
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyStatus("idle"), 1500);
  };

  return (
    <section class="inspector" aria-label={t("inspect.title")}>
      <header class="inspector-head">
        <div>
          <div class="inspector-title">{t("inspect.title")}</div>
          <p class="hint">{t("language.original")}</p>
          {facts && (
            <section class="inspector-sub" aria-label={t("windows.modelDetails")}>
              <code>{facts.id}</code>
              <br />
              {t("inspect.sees", { sees: t(`perception.${facts.level}`, { seconds: 0.2 }) })}
              <br />
              {t("inspect.style", { style: t(`style.${facts.style}`) })}
              {facts.timedBy && (
                <p>{t(facts.timedBy === "model" ? "inspect.modelTimes" : "inspect.executor")}</p>
              )}
            </section>
          )}
        </div>
        <div class="inspector-actions">
          <button type="button" class="btn small" onClick={copy} disabled={!sent}>
            {t(copyStatus === "copied" ? "common.copied" : "common.copy")}
          </button>
          <button
            ref={closeRef}
            type="button"
            class="btn small"
            onClick={onClose}
            data-action="close-inspector"
          >
            {t("common.close")}
          </button>
        </div>
        {copyStatus === "error" && (
          <p class="hint" role="status">
            {t("common.copyFailed")}
          </p>
        )}
      </header>
      {!log || !sent ? (
        <p class="hint inspector-empty">{t("inspect.empty")}</p>
      ) : (
        <>
          <div class="inspector-chips" title={t("decision.recent")}>
            <span class="hint">
              {t("inspect.decision", {
                index: log.index + 1,
                row: log.row,
                action: actionLabel(log.action, translation),
              })}
              {controllerSince > 0 && <> · {t("inspect.controller", { count: controllerSince })}</>}
            </span>
          </div>
          <nav class="inspector-tabs">
            {TABS.map((id) => (
              <button
                type="button"
                key={id}
                data-tab={id}
                class={tab === id ? "on" : ""}
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
              >
                {t(`inspect.${id}`)}
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
    </section>
  );
}
