import { GameView } from "@ccr/render";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Sounds } from "./audio.ts";
import { ACTION_GLYPH, endTitle, percent } from "./format.ts";
import type { Session, SessionState } from "./session.ts";
import { Compass } from "./theater/Compass.tsx";
import { barsOf, winnerOf } from "./theater/compass.ts";
import { Glyph } from "./theater/Glyph.tsx";

export interface GameCanvasProps {
  session: Session;
  state: SessionState;
  sounds: Sounds;
  onReady?: (view: GameView) => void;
  onFps?: (fps: number) => void;
  onRetry: () => void;
  onNewMap: () => void;
  /** The model's decision drawn around the chicken. It replaces the thought bubble while it is on. */
  compass: { on: boolean; conversationOpen: boolean; onConversation(): void };
}

/** How far above its feet the compass is centred, in world units: the middle of the chicken. */
const COMPASS_LIFT = 0.5;

/** Owns the WebGL view and the animation loop; everything else is plain DOM on top of it. */
export function GameCanvas(props: GameCanvasProps) {
  const { session, state } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const compassRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorText, setErrorText] = useState("");
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

        const loop = (now: number) => {
          frameId = requestAnimationFrame(loop);
          const dt = (now - last) / 1000;
          last = now;
          if (dt > 0) fpsEma += (1 / dt - fpsEma) * 0.1;

          const alpha = session.frame(dt);
          const snap = session.game.snapshot();
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
  // The model's choice, not the first hop of the controller that carries it out, with its share of the answer.
  const choice = last && last.decision.source !== "executor" ? winnerOf(last) : last?.action;
  const chosenP =
    last && choice && last.decision.source !== "executor"
      ? (barsOf(last)?.p[choice] ?? last.decision.probabilities?.[choice])
      : undefined;

  return (
    <div class="stage">
      <canvas
        ref={canvasRef}
        class="game"
        tabIndex={0}
        aria-label="Game. Arrow keys or WASD to move; Space to pause."
      />

      <div class="hud">
        <div class="hud-score">{state.score}</div>
        <div class="hud-sub">
          rows · best {state.best} · seed {state.seed}
        </div>
      </div>

      <div ref={bubbleRef} class="bubble-anchor">
        {showBubble && last && (
          <div class="bubble" key={last.index}>
            <span class="bubble-arrow">
              <Glyph glyph={ACTION_GLYPH[choice ?? last.action]} size={22} />
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
        <Compass
          session={session}
          state={state}
          anchorRef={compassRef}
          conversationOpen={props.compass.conversationOpen}
          onConversation={props.compass.onConversation}
        />
      )}

      {status === "loading" && <div class="overlay-note">Loading models…</div>}
      {status === "error" && (
        <div class="overlay-card">
          <h2>Could not start the view</h2>
          <p>{errorText}</p>
          <p class="small">If the models are missing, run: node scripts/fetch-assets.mjs</p>
        </div>
      )}

      {status === "ready" && (!state.alive || state.stalled) && (
        <div class="overlay-card over">
          <div class="over-title">{endTitle(state)}</div>
          <div class="over-score">{state.score}</div>
          <div class="over-sub">rows crossed · best {state.best}</div>
          <div class="over-actions">
            <button type="button" class="btn primary" onClick={props.onRetry}>
              Retry same map
            </button>
            <button type="button" class="btn" onClick={props.onNewMap}>
              New map
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
