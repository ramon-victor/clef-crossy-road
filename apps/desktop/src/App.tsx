import type { GameView } from "@ccr/render";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Sounds } from "./audio.ts";
import { createBridge, createClefClient } from "./bridge/clef.ts";
import type { BudgetStatus } from "./bridge/types.ts";
import { GameCanvas } from "./GameCanvas.tsx";
import { commandForKey } from "./keymap.ts";
import { readLaunchOptions } from "./launch.ts";
import { Panel } from "./Panel.tsx";
import { buildPolicyChoices, freeSeedRange, nextMapSeed } from "./policies.ts";
import { randomSeed } from "./seed.ts";
import { runSelfTest } from "./selftest.ts";
import { Session, type SessionState, type Timing } from "./session.ts";

const DEFAULT_PLAYER = "lookahead";
/** Pause before an attract-mode game starts the next map, long enough to read the result card. */
const RESTART_DELAY_MS = 2200;

export function App() {
  const bridge = useMemo(createBridge, []);
  const client = useMemo(() => createClefClient(bridge), [bridge]);
  const choices = useMemo(() => buildPolicyChoices(client), [client]);
  const byId = useMemo(() => new Map(choices.map((c) => [c.id, c])), [choices]);
  const sounds = useMemo(() => new Sounds(), []);
  const session = useMemo(() => {
    const s = new Session();
    s.start(randomSeed());
    return s;
  }, []);

  const [state, setState] = useState<SessionState>(() => session.state());
  const [selectedId, setSelectedId] = useState(DEFAULT_PLAYER);
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
      const range = freeSeedRange(byId.get(id));
      if (range && seed >= range.min && seed <= range.max) lastFree.current.set(id, seed);
    },
    [byId],
  );

  // Starting point: the free reference unless a shortcut asked for something else (CCR_PLAYER / CCR_SEED).
  // The default never spends anything.
  useEffect(() => {
    let cancelled = false;
    void readLaunchOptions().then((options) => {
      if (cancelled) return;
      const wanted = byId.get(options.player ?? "") ?? byId.get(DEFAULT_PLAYER);
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
  }, [byId, session, noteSeed]);

  const select = useCallback(
    (id: string) => {
      const choice = byId.get(id);
      if (!choice) return;
      setSelectedId(id);
      lastFree.current.delete(id);
      session.setPolicy(choice.factory);
    },
    [byId, session],
  );

  const retry = useCallback(() => session.start(session.state().seed), [session]);
  const newMap = useCallback(() => {
    const next = nextMapSeed(byId.get(selectedId), lastFree.current.get(selectedId), randomSeed);
    if (next.free) lastFree.current.set(selectedId, next.seed);
    session.start(next.seed);
  }, [byId, selectedId, session]);

  // Attract mode: a finished game by a FREE player (a reference) starts a new map after a short pause,
  // so the window keeps showing action. Players that call the model never restart by themselves, so an
  // unattended window cannot use up the day's neurons.
  const selected = byId.get(selectedId);
  const mayAutoRestart = autoRestart && selected !== undefined && !selected.usesApi && !state.human;
  const over = !state.alive || state.stalled;
  useEffect(() => {
    if (!over || !mayAutoRestart) return;
    const timer = setTimeout(newMap, RESTART_DELAY_MS);
    return () => clearTimeout(timer);
  }, [over, state.seed, mayAutoRestart, newMap]);

  useEffect(() => {
    const unlockSound = () => sounds.unlock();
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT")) return;
      sounds.unlock();
      const command = commandForKey(event);
      if (!command) return;
      event.preventDefault();
      switch (command.type) {
        case "move":
          session.humanInput(command.action);
          break;
        case "pause":
          session.togglePause();
          break;
        case "step":
          session.stepOnce();
          break;
        case "retry":
          retry();
          break;
        case "newMap":
          newMap();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", unlockSound, { once: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", unlockSound);
    };
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
