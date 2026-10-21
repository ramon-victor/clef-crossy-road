import { GameView } from "@ccr/render";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Sounds } from "./audio.ts";
import { ACTION_GLYPH } from "./format.ts";
import { gameEndTitle } from "./i18n/presentation.ts";
import { useI18n } from "./i18n/provider.tsx";
import { ErrorMessage } from "./panel/ErrorMessage.tsx";
import type { Session, SessionState } from "./session.ts";
import { Compass } from "./theater/Compass.tsx";
import { CompassCaption } from "./theater/CompassCaption.tsx";
import { buildCaption } from "./theater/caption.ts";
import { modelChoice } from "./theater/choice.ts";
import { buildExecution, type ExecutionView } from "./theater/execution.ts";
import { Glyph } from "./theater/Glyph.tsx";

export interface GameCanvasProps {
  session: Session;
  state: SessionState;
  sounds: Sounds;
  onReady?: (view: GameView) => void;
  onUnavailable?: () => void;
  onFps?: (fps: number) => void;
  onRetry: () => void;
  onNewMap: () => void;
  onShowControls?: (() => void) | undefined;
  onToggleControls?: (() => void) | undefined;
  controlsVisible?: boolean;
  /** Where the settings live, which decides how their button is worded. */
  controlsTarget?: keyof typeof CONTROLS_TEXT;
  onToggleDecisions?: (() => void) | undefined;
  decisionsVisible?: boolean;
  /** The model's decision drawn around the chicken. It replaces the thought bubble while it is on. */
  compass: { on: boolean; conversationOpen: boolean; onConversation(): void };
}

/** How far above its feet the compass is centred, in world units: the middle of the chicken. */
const COMPASS_LIFT = 0.5;

const CONTROLS_TEXT = {
  window: {
    show: "windows.openControls",
    hide: "windows.hideControls",
    showHint: "windows.openControlsHelp",
  },
  sidebar: { show: "panel.show", hide: "panel.hide", showHint: "panel.show" },
} as const;

/** Owns the WebGL view and the animation loop; everything else is plain DOM on top of it. */
export function GameCanvas(props: GameCanvasProps) {
  const translation = useI18n();
  const { t, number, percent } = translation;
  const { session, state } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const compassRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorText, setErrorText] = useState("");
  const [execution, setExecution] = useState<ExecutionView>({
    action: null,
    next: null,
    blocked: false,
    overlay: null,
  });
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let frameId = 0;
    let view: GameView | null = null;
    let observer: ResizeObserver | null = null;

    GameView.create({ canvas, assetBase: "/assets" })
      .then((created) => {
        if (disposed) {
          created.dispose();
          return;
        }
        view = created;
        const resizeToCanvas = () => {
          const box = canvas.getBoundingClientRect();
          view?.resize(box.width, box.height, Math.min(window.devicePixelRatio || 1, 2));
        };
        resizeToCanvas();
        observer = new ResizeObserver(resizeToCanvas);
        observer.observe(canvas);
        setStatus("ready");
        latest.current.onReady?.(created);

        let last = performance.now();
        let fpsEma = 60;
        let wasMoving = false;
        let wasAlive = true;
        let lastReport = last;
        let executionKey = "";
        const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

        const loop = (now: number) => {
          frameId = requestAnimationFrame(loop);
          const dt = (now - last) / 1000;
          last = now;
          if (dt > 0) fpsEma += (1 / dt - fpsEma) * 0.1;

          const alpha = session.frame(dt);
          const snap = session.game.snapshot();
          const live = session.state();
          const executing = buildExecution(live, snap);
          const key = `${live.episode}:${live.last?.index}:${executing.action}:${executing.next}:${executing.blocked}:${!!executing.overlay}:${latest.current.compass.on}`;
          if (key !== executionKey) {
            executionKey = key;
            setExecution(executing);
          }
          const overlay = latest.current.compass.on ? executing.overlay : null;
          view?.setDecisionOverlay(
            overlay
              ? {
                  ...overlay,
                  pulse: overlay.pulse && !reducedMotion?.matches,
                }
              : null,
          );
          view?.update(snap, alpha, dt);
          view?.render();

          const { sounds } = latest.current;
          if (snap.hero.moving && !wasMoving) sounds.hop();
          wasMoving = snap.hero.moving;
          if (wasAlive && !snap.alive) sounds.death(snap.deathCause);
          wasAlive = snap.alive;

          const bubble = bubbleRef.current;
          // The thought bubble and the compass replace each other, so only the one that is on is placed.
          const compass = compassRef.current;
          if (compass) {
            const body = view?.heroScreenPosition(COMPASS_LIFT);
            if (body) compass.style.transform = `translate(${body.x}px, ${body.y}px)`;
          } else if (bubble) {
            const pos = view?.heroScreenPosition();
            if (pos) bubble.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
          }

          if (now - lastReport > 500) {
            lastReport = now;
            latest.current.onFps?.(fpsEma);
          }
        };
        frameId = requestAnimationFrame(loop);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        latest.current.onUnavailable?.();
        setStatus("error");
        setErrorText(error instanceof Error ? error.message : String(error));
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      observer?.disconnect();
      view?.dispose();
    };
  }, [session]);

  const last = state.last;
  const showBubble =
    status === "ready" && state.alive && !state.human && last !== null && !props.compass.on;
  const chosen = last ? modelChoice(last) : null;
  const shownMove = chosen?.move ?? last?.action;
  const chosenP = chosen?.bars?.p[chosen.move];
  const controlsText = CONTROLS_TEXT[props.controlsTarget ?? "window"];
  const caption = props.compass.on ? buildCaption(state, execution, translation) : null;

  return (
    <div class="stage">
      <canvas ref={canvasRef} class="game" tabIndex={0} aria-label={t("game.canvas")} />

      <div class="hud">
        <div class="hud-score">{number(state.score)}</div>
        <div class="hud-sub">{t("game.hud", { best: state.best, seed: String(state.seed) })}</div>
      </div>

      {props.onToggleControls && (
        <button
          type="button"
          class="game-tool open-controls"
          onClick={props.onToggleControls}
          aria-pressed={props.controlsVisible ?? false}
          aria-label={t(props.controlsVisible ? controlsText.hide : controlsText.show)}
          title={t(props.controlsVisible ? controlsText.hide : controlsText.showHint)}
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M4 7h16M4 17h16" />
            <circle cx="9" cy="7" r="3" fill="currentColor" stroke="none" />
            <circle cx="15" cy="17" r="3" fill="currentColor" stroke="none" />
          </svg>
        </button>
      )}
      {props.onToggleDecisions && (
        <button
          type="button"
          class="game-tool toggle-decisions"
          onClick={props.onToggleDecisions}
          aria-pressed={props.decisionsVisible ?? false}
          aria-label={t(props.decisionsVisible ? "theater.hide" : "theater.show")}
          title={t(props.decisionsVisible ? "theater.hide" : "theater.show")}
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z" />
            <path d="M7 9h10M7 13h6" />
          </svg>
        </button>
      )}

      {state.paused && status === "ready" && state.alive && !state.stalled && !caption && (
        <div class="paused-note" role="status">
          {t("windows.paused")}
        </div>
      )}

      {state.error && status === "ready" && (
        <section class="game-error">
          <strong>{t("error.stopped")}</strong>
          <ErrorMessage info={{ code: state.errorInfo?.code ?? "unknown", detail: "" }} />
          <div class="game-error-actions">
            {props.onShowControls && (
              <button type="button" class="btn small" onClick={props.onShowControls}>
                {t("setup.configure")}
              </button>
            )}
            <button type="button" class="btn small" onClick={props.compass.onConversation}>
              {t("decisions.details")}
            </button>
          </div>
        </section>
      )}

      <div ref={bubbleRef} class="bubble-anchor">
        {showBubble && last && (
          <div class="bubble" key={last.index}>
            <span class="bubble-arrow">
              <Glyph glyph={ACTION_GLYPH[shownMove ?? last.action]} size={22} />
            </span>
            {chosenP !== undefined && <span class="bubble-p">{percent(chosenP)}</span>}
          </div>
        )}
        {status === "ready" && state.phase === "thinking" && !props.compass.on && (
          <div class="bubble thinking">
            <span class="dots">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
      </div>

      {status === "ready" && props.compass.on && (
        <Compass session={session} state={state} execution={execution} anchorRef={compassRef} />
      )}

      {status === "ready" && caption && (
        <CompassCaption
          view={caption}
          conversationOpen={props.compass.conversationOpen}
          onConversation={props.compass.onConversation}
        />
      )}

      {status === "loading" && <div class="overlay-note">{t("game.loading")}</div>}
      {status === "error" && (
        <div class="overlay-card">
          <h2>{t("game.loadError")}</h2>
          <ErrorMessage info={{ code: "render", detail: errorText }} />
          <p class="small">{t("game.assetsHelp", { command: "node scripts/fetch-assets.mjs" })}</p>
        </div>
      )}

      {status === "ready" && (!state.alive || state.stalled) && (
        <div class="overlay-card over">
          <div class="over-title">{gameEndTitle(state, translation)}</div>
          <div class="over-score">{number(state.score)}</div>
          <div class="over-sub">{t("game.rows", { count: state.score, best: state.best })}</div>
          <div class="over-actions">
            <button type="button" class="btn primary" onClick={props.onRetry}>
              {t("game.retryMap")}
            </button>
            <button type="button" class="btn" onClick={props.onNewMap}>
              {t("controls.newMap")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
