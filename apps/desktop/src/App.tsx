import type { Action } from "@ccr/core";
import type { GameView } from "@ccr/render";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Sounds } from "./audio.ts";
import { createBridge, createClefClient } from "./bridge/clef.ts";
import type { BudgetStatus } from "./bridge/types.ts";
import { randomSeed } from "./format.ts";
import { GameCanvas } from "./GameCanvas.tsx";
import { readLaunchOptions } from "./launch.ts";
import { Panel } from "./Panel.tsx";
import { buildPolicyChoices, freeSeedRange, nextMapSeed } from "./policies.ts";
import { runSelfTest } from "./selftest.ts";
import { Session, type SessionState, type Timing } from "./session.ts";

const KEYS: Readonly<Record<string, Action>> = {
  ArrowUp: "hop_forward",
  w: "hop_forward",
  W: "hop_forward",
  ArrowDown: "hop_back",
  s: "hop_back",
  S: "hop_back",
  ArrowLeft: "hop_left",
  a: "hop_left",
  A: "hop_left",
  ArrowRight: "hop_right",
  d: "hop_right",
  D: "hop_right",
};

export function App() {
  const bridge = useMemo(createBridge, []);
  const client = useMemo(() => createClefClient(bridge), [bridge]);
  const choices = useMemo(() => buildPolicyChoices(client), [client]);
  const sounds = useMemo(() => new Sounds(), []);
  const session = useMemo(() => {
    const s = new Session();
    s.start(randomSeed());
    return s;
  }, []);

  const [state, setState] = useState<SessionState>(() => session.state());
  const [selectedId, setSelectedId] = useState("lookahead");
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [fps, setFps] = useState(60);
  const [soundOn, setSoundOn] = useState(true);
  const [autoRestart, setAutoRestart] = useState(true);
  const viewRef = useRef<GameView | null>(null);

  const refreshBudget = useCallback(() => {
    bridge
      .budget()
      .then(setBudget)
      .catch(() => setBudget(null));
  }, [bridge]);

  // Push session changes to the UI (events) and refresh numbers that tick (score, tick) at 10 Hz.
  useEffect(() => {
    const unsubscribe = session.subscribe(() => setState(session.state()));
    const timer = setInterval(() => setState(session.state()), 100);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [session]);

  useEffect(() => {
    refreshBudget();
    const timer = setInterval(refreshBudget, 4000);
    return () => clearInterval(timer);
  }, [refreshBudget]);

  // The last cached ("free") seed opened per player, so "New map" can walk through them in order.
  const lastFree = useRef(new Map<string, number>());
  const noteSeed = useCallback(
    (id: string, seed: number) => {
      const range = freeSeedRange(choices.find((c) => c.id === id));
      if (range && seed >= range.min && seed <= range.max) lastFree.current.set(id, seed);
    },
    [choices],
  );

  // Starting point: the free reference unless a shortcut asked for something else (CCR_PLAYER / CCR_SEED).
  // The default never spends anything.
  useEffect(() => {
    let cancelled = false;
    void readLaunchOptions().then((options) => {
      if (cancelled) return;
      const wanted =
        choices.find((c) => c.id === options.player) ?? choices.find((c) => c.id === "lookahead");
      if (!wanted) return;
      setSelectedId(wanted.id);
      session.setPolicy(wanted.factory);
      if (options.seed !== undefined) {
        noteSeed(wanted.id, options.seed);
        session.start(options.seed);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [choices, session, noteSeed]);

  const select = useCallback(
    (id: string) => {
      const choice = choices.find((c) => c.id === id);
      if (!choice) return;
      setSelectedId(id);
      lastFree.current.delete(id);
      session.setPolicy(choice.factory);
    },
    [choices, session],
  );

  const retry = useCallback(() => session.start(session.state().seed), [session]);
  const newMap = useCallback(() => {
    const choice = choices.find((c) => c.id === selectedId);
    const next = nextMapSeed(choice, lastFree.current.get(selectedId), randomSeed);
    if (next.free) lastFree.current.set(selectedId, next.seed);
    session.start(next.seed);
  }, [choices, selectedId, session]);

  // Attract mode: a finished game by a FREE player (a reference) starts a new map after a short pause,
  // so the window keeps showing action. Players that call the model never restart by themselves, so an
  // unattended window cannot use up the day's neurons.
  const selected = choices.find((c) => c.id === selectedId);
  const mayAutoRestart = autoRestart && selected !== undefined && !selected.usesApi && !state.human;
  useEffect(() => {
    if (state.alive || !mayAutoRestart) return;
    const timer = setTimeout(newMap, 2200);
    return () => clearTimeout(timer);
  }, [state.alive, state.seed, mayAutoRestart, newMap]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT")) return;
      sounds.unlock();
      const action = KEYS[event.key];
      if (action) {
        event.preventDefault();
        session.humanInput(action);
      } else if (event.key === " ") {
        event.preventDefault();
        session.togglePause();
      } else if (event.key === "n" || event.key === "N") session.stepOnce();
      else if (event.key === "r" || event.key === "R") retry();
      else if (event.key === "m" || event.key === "M") newMap();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", () => sounds.unlock(), { once: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [session, sounds, retry, newMap]);

  const onReady = useCallback(
    (view: GameView) => {
      viewRef.current = view;
      void runSelfTest({ session, view, bridge, choices, select });
    },
    [session, bridge, choices, select],
  );

  return (
    <div class="shell">
      <GameCanvas
        session={session}
        state={state}
        sounds={sounds}
        onReady={onReady}
        onFps={setFps}
        onRetry={retry}
        onNewMap={newMap}
      />
      <Panel
        state={state}
        choices={choices}
        selectedId={selectedId}
        budget={budget}
        fps={fps}
        soundOn={soundOn}
        autoRestart={autoRestart}
        bridgeKind={bridge.kind}
        onSelect={(id) => {
          select(id);
          refreshBudget();
        }}
        onTiming={(t: Timing) => session.setTiming(t)}
        onSpeed={(s) => session.setSpeed(s)}
        onPause={() => session.togglePause()}
        onStep={() => session.stepOnce()}
        onRetry={retry}
        onNewMap={newMap}
        onSeed={(seed) => {
          noteSeed(selectedId, seed);
          session.start(seed);
        }}
        onSound={(on) => {
          sounds.enabled = on;
          setSoundOn(on);
        }}
        onAutoRestart={setAutoRestart}
      />
    </div>
  );
}
