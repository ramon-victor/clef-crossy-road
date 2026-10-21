import type { GameView } from "@ccr/render";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Sounds } from "./audio.ts";
import { createBridge, createClefClient } from "./bridge/clef.ts";
import type { BudgetStatus, CredentialStatus } from "./bridge/types.ts";
import {
  hostControls,
  setDecisionsVisible,
  showControls,
  WINDOW_EVENTS,
} from "./bridge/windows.ts";
import { ControlSurface } from "./ControlSurface.tsx";
import { createConsoleLog, terminalWriter } from "./console-log.ts";
import { type ControlCommand, type ControlsData, playerOption } from "./controls.ts";
import { GameCanvas } from "./GameCanvas.tsx";
import { useI18n } from "./i18n/provider.tsx";
import { commandForKey } from "./keymap.ts";
import { readLaunchOptions } from "./launch.ts";
import {
  buildPolicyChoices,
  canonicalPlayerId,
  customChoice,
  freeSeedRange,
  nextMapSeed,
  type PolicyChoice,
} from "./policies.ts";
import { randomSeed } from "./seed.ts";
import { runSelfTest } from "./selftest.ts";
import { Session, type SessionState } from "./session.ts";
import {
  openByDefault,
  PACE_MS,
  type Pace,
  readFlag,
  readPace,
  writeFlag,
  writePace,
} from "./theater/preference.ts";
import { Theater } from "./theater/Theater.tsx";

const DEFAULT_PLAYER = "clef-flash";
/** Pause before an attract-mode game starts the next map, long enough to read the result card. */
const RESTART_DELAY_MS = 2200;

export function App({ desktop = false }: { desktop?: boolean }) {
  const { t } = useI18n();
  const bridge = useMemo(createBridge, []);
  const client = useMemo(() => createClefClient(bridge), [bridge]);
  const standardChoices = useMemo(() => buildPolicyChoices(client), [client]);
  const standardById = useMemo(
    () => new Map(standardChoices.map((c) => [c.id, c])),
    [standardChoices],
  );
  // A player made from a benchmark id in CCR_PLAYER joins the list after the launch options are read.
  const [custom, setCustom] = useState<PolicyChoice | null>(null);
  const choices = useMemo(
    () => (custom ? [...standardChoices, custom] : standardChoices),
    [standardChoices, custom],
  );
  const byId = useMemo(() => new Map(choices.map((c) => [c.id, c])), [choices]);
  const sounds = useMemo(() => new Sounds(), []);
  const session = useMemo(() => {
    const s = new Session();
    s.start(randomSeed());
    return s;
  }, []);

  const [state, setState] = useState<SessionState>(() => session.state());
  const [selectedId, setSelectedId] = useState(
    bridge.kind === "http" ? "lookahead" : DEFAULT_PLAYER,
  );
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [credentials, setCredentials] = useState<CredentialStatus | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [fps, setFps] = useState(60);
  const [soundOn, setSoundOn] = useState(true);
  const [autoRestart, setAutoRestart] = useState(true);
  const [inspectVersion, setInspectVersion] = useState(0);
  const [launchReady, setLaunchReady] = useState(false);
  const [windowsReady, setWindowsReady] = useState(false);
  const [decisionsVisible, setDecisionsShown] = useState(false);
  const [windowFailed, setWindowFailed] = useState(false);
  // What the person chose for the Theater, or null if they never did (then a model player opens it).
  const [theaterChoice, setTheaterChoice] = useState<boolean | null>(() =>
    desktop ? false : readFlag("theater"),
  );
  const [compassChoice, setCompassChoice] = useState<boolean | null>(() => readFlag("compass"));
  // Only the browser sidebar can be hidden; desktop settings live in their own window.
  const [settingsVisible, setSettingsVisible] = useState(
    () => desktop || (readFlag("settings") ?? true),
  );
  const [pace, setPaceState] = useState<Pace>(() => readPace());
  const viewRef = useRef<GameView | null>(null);
  const minimizedRef = useRef(false);

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

  useEffect(() => {
    let cancelled = false;
    bridge
      .credentialStatus()
      .then((status) => {
        if (!cancelled) setCredentials(status);
      })
      .catch(() => {
        if (!cancelled) setCredentials(null);
      });
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  // The last cached ("free") seed opened per player, so "New map" can walk through them in order.
  const lastFree = useRef(new Map<string, number>());
  const noteSeed = useCallback(
    (id: string, seed: number) => {
      const range = freeSeedRange(standardById.get(id));
      if (range && seed >= range.min && seed <= range.max) lastFree.current.set(id, seed);
    },
    [standardById],
  );

  // Native starts on Clef-flash's first cached map; browser development defaults to a free reference.
  // A cached replay is only free if that worktree actually contains all of its cached decisions.
  useEffect(() => {
    let cancelled = false;
    let stopLogging = () => {};
    void readLaunchOptions().then((options) => {
      if (cancelled) return;
      // Listening first, so the log starts with the very first game.
      if (options.log) {
        stopLogging = session.subscribeEvents(createConsoleLog(options.log, terminalWriter()));
      }
      const requested = options.player ?? DEFAULT_PLAYER;
      const wanted =
        standardById.get(canonicalPlayerId(requested)) ??
        customChoice(requested, client) ??
        standardById.get("lookahead");
      if (!wanted) return;
      if (!standardById.has(wanted.id)) setCustom(wanted);
      setSelectedId(wanted.id);
      // Without a seed from a shortcut, a player with cached maps starts on the first of them.
      const seed = options.seed ?? freeSeedRange(wanted)?.min;
      if (seed !== undefined) noteSeed(wanted.id, seed);
      session.setPolicy(wanted.factory, seed);
      setLaunchReady(true);
    });
    return () => {
      cancelled = true;
      stopLogging();
    };
  }, [standardById, client, session, noteSeed]);

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
  const showTheater = openByDefault(theaterChoice, selected?.kind);
  const setTheater = useCallback(
    (on: boolean) => {
      setTheaterChoice(on);
      if (!desktop) writeFlag("theater", on);
      // Browser hiding unmounts the conversation, so its consumed request must not replay on reopen.
      if (!desktop && !on) setInspectVersion(0);
    },
    [desktop],
  );
  const openDecisions = useCallback(
    async (inspect = false) => {
      setTheater(true);
      if (inspect) setInspectVersion((n) => n + 1);
      if (desktop) await setDecisionsVisible(true, true);
      setWindowFailed(false);
    },
    [desktop, setTheater],
  );
  useEffect(() => {
    if (!desktop || !launchReady || !windowsReady) return;
    void setDecisionsVisible(showTheater).catch(() => setWindowFailed(true));
  }, [desktop, launchReady, windowsReady, showTheater]);
  const theaterVisible = desktop ? decisionsVisible : showTheater;
  const setSettings = useCallback(
    (on: boolean) => {
      setSettingsVisible(on);
      if (!desktop) writeFlag("settings", on);
    },
    [desktop],
  );
  const showCompass = openByDefault(compassChoice, selected?.kind);
  const setCompass = useCallback((on: boolean) => {
    setCompassChoice(on);
    writeFlag("compass", on);
  }, []);
  // `persist: false` changes the pace for this run only: the self-test must not leave its own choice behind.
  const setPace = useCallback((next: Pace, persist = true) => {
    setPaceState(next);
    if (persist) writePace(next);
  }, []);
  // Only someone watching a model gets the wait that leaves time to read an answer; everyone else plays at full speed.
  const watching =
    ((desktop ? decisionsVisible : showTheater) || showCompass) && selected?.kind === "model";
  useEffect(() => {
    session.setLinger(watching ? PACE_MS[pace] : 0);
  }, [session, watching, pace]);
  useEffect(() => {
    if (!over || !mayAutoRestart || state.paused || minimized) return;
    const timer = setTimeout(newMap, RESTART_DELAY_MS);
    return () => clearTimeout(timer);
  }, [over, state.seed, state.paused, mayAutoRestart, newMap, minimized]);

  const execute = useCallback(
    async (command: ControlCommand) => {
      switch (command.type) {
        case "select":
          select(command.id);
          refreshBudget();
          break;
        case "timing":
          session.setTiming(command.timing);
          break;
        case "speed":
          session.setSpeed(command.speed);
          break;
        case "pause":
          if (!minimizedRef.current) session.togglePause();
          break;
        case "pauseForSettings":
          session.setPaused(true);
          break;
        case "step":
          if (!minimizedRef.current) session.stepOnce();
          break;
        case "retry":
          retry();
          break;
        case "newMap":
          newMap();
          break;
        case "seed":
          noteSeed(selectedId, command.seed);
          session.start(command.seed);
          break;
        case "sound":
          sounds.enabled = command.enabled;
          setSoundOn(command.enabled);
          break;
        case "theater":
          if (command.enabled) await openDecisions();
          else {
            setTheater(false);
            if (desktop) await setDecisionsVisible(false);
          }
          break;
        case "inspect":
          await openDecisions(true);
          break;
        case "compass":
          setCompass(command.enabled);
          break;
        case "pace":
          setPace(command.pace);
          break;
        case "autoRestart":
          setAutoRestart(command.enabled);
          break;
        case "credentialsSaved": {
          setCredentials(await bridge.credentialStatus());
          const current = session.state();
          if (current.phase === "error" || current.phase === "thinking")
            session.start(current.seed);
          session.setPaused(true);
          refreshBudget();
          break;
        }
      }
    },
    [
      desktop,
      select,
      refreshBudget,
      session,
      retry,
      newMap,
      noteSeed,
      selectedId,
      sounds,
      bridge,
      setTheater,
      openDecisions,
      setCompass,
      setPace,
    ],
  );

  const controls: ControlsData = {
    state,
    choices: choices.map(playerOption),
    selectedId,
    budget,
    credentials,
    fps,
    soundOn,
    autoRestart,
    bridgeKind: bridge.kind,
    minimized,
    theaterOpen: theaterVisible,
    inspectVersion,
    compassOn: showCompass,
    pace: selected?.kind === "model" ? pace : null,
  };
  const latest = useRef({ controls, execute });
  latest.current = { controls, execute };

  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let publishing = false;
    let host: Awaited<ReturnType<typeof hostControls>> | null = null;
    const stops: (() => void)[] = [];
    const updateMinimized = (value: boolean) => {
      if (minimizedRef.current === value) return;
      minimizedRef.current = value;
      setMinimized(value);
      if (value) session.setPaused(true);
    };
    const setup = async () => {
      const current = getCurrentWindow();
      host = await hostControls(
        (command) => latest.current.execute(command),
        () => ({
          ...latest.current.controls,
          state: session.state(),
          minimized: minimizedRef.current,
        }),
      );
      stops.push(
        await current.listen<boolean>(WINDOW_EVENTS.minimized, ({ payload }) =>
          updateMinimized(payload),
        ),
      );
      stops.push(await current.listen(WINDOW_EVENTS.decisionsClosed, () => setTheater(false)));
      stops.push(
        await current.listen<boolean>(WINDOW_EVENTS.decisionsVisible, ({ payload }) =>
          setDecisionsShown(payload),
        ),
      );
      updateMinimized(await current.isMinimized());
      if (!disposed) setWindowsReady(true);
      if (disposed) {
        host.dispose();
        for (const stop of stops) stop();
      }
    };
    void setup().catch(() => {
      host?.dispose();
      for (const stop of stops) stop();
    });
    // The native event handles minimizing immediately. Polling covers platforms which omit resize
    // events on minimize, and recurring snapshots cover either webview finishing its startup first.
    const timer = setInterval(() => {
      if (disposed || publishing) return;
      publishing = true;
      void (async () => {
        updateMinimized(await getCurrentWindow().isMinimized());
        await host?.publish();
      })()
        .catch(() => {})
        .finally(() => {
          publishing = false;
        });
    }, 100);
    return () => {
      disposed = true;
      clearInterval(timer);
      host?.dispose();
      for (const stop of stops) stop();
    };
  }, [desktop, session, setTheater]);

  const openControls = useCallback(() => {
    if (desktop)
      void showControls()
        .then(() => setWindowFailed(false))
        .catch(() => setWindowFailed(true));
  }, [desktop]);
  const toggleDecisions = useCallback(() => {
    void execute({ type: "theater", enabled: !theaterVisible })
      .then(() => setWindowFailed(false))
      .catch(() => setWindowFailed(true));
  }, [theaterVisible, execute]);

  useEffect(() => {
    const unlockSound = () => sounds.unlock();
    const onKey = (event: KeyboardEvent) => {
      const command = commandForKey(event);
      if (!command) return;
      // Opening a native panel is also available while a result/HUD button has keyboard focus.
      if (command.type === "controls") {
        if (desktop) {
          event.preventDefault();
          openControls();
        }
        return;
      }
      if (
        (command.type === "theater" || command.type === "inspect") &&
        !(
          event.target instanceof Element &&
          event.target.closest(
            'input, select, textarea, [contenteditable], dialog, [role="dialog"]',
          )
        )
      ) {
        event.preventDefault();
        if (command.type === "inspect") void openDecisions(true).catch(() => setWindowFailed(true));
        else toggleDecisions();
        return;
      }
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          'input, select, textarea, button, summary, dialog, a[href], [contenteditable]:not([contenteditable="false"]), [role="dialog"]',
        )
      )
        return;
      sounds.unlock();
      if (minimizedRef.current && command.type !== "inspect") return;
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

        case "compass":
          setCompass(!showCompass);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", unlockSound, { once: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", unlockSound);
    };
  }, [
    session,
    sounds,
    retry,
    newMap,
    desktop,
    openControls,
    openDecisions,
    toggleDecisions,
    setCompass,
    showCompass,
  ]);

  const onReady = useCallback(
    (view: GameView) => {
      viewRef.current = view;
      void runSelfTest({ session, view, bridge, choices, select, setPace });
    },
    [session, bridge, choices, select, setPace],
  );

  return (
    <div class={`shell ${desktop ? "game-shell" : ""}`}>
      <GameCanvas
        session={session}
        state={state}
        sounds={sounds}
        onReady={onReady}
        onFps={setFps}
        onRetry={retry}
        onNewMap={newMap}
        compass={{
          on: showCompass && selected?.kind === "model",
          conversationOpen: theaterVisible,
          onConversation: () => void openDecisions().catch(() => setWindowFailed(true)),
        }}
        // The browser error card offers "Configure" only while the sidebar is hidden.
        onShowControls={
          desktop ? openControls : settingsVisible ? undefined : () => setSettings(true)
        }
        onToggleControls={desktop ? undefined : () => setSettings(!settingsVisible)}
        controlsVisible={settingsVisible}
        onToggleDecisions={toggleDecisions}
        decisionsVisible={theaterVisible}
      />
      {windowFailed && (
        <p class="window-error" role="alert">
          {t("windows.unreachable")}
        </p>
      )}
      {!desktop && showTheater && (
        <Theater
          state={state}
          kind={selected?.kind}
          compassOn={showCompass}
          onCompass={() => setCompass(!showCompass)}
          onClose={() => setTheater(false)}
          inspectVersion={inspectVersion}
          onPause={() => void execute({ type: "pause" })}
          minimized={minimized}
          pace={selected?.kind === "model" ? pace : null}
          onPace={setPace}
          fps={fps}
        />
      )}
      {!desktop && settingsVisible && (
        <ControlSurface data={controls} bridge={bridge} send={execute} />
      )}
    </div>
  );
}
