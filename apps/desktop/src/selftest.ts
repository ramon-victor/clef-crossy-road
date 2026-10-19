import { isBudgetRefusal } from "@ccr/clef";
import { Game } from "@ccr/core";
import type { GameView } from "@ccr/render";
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import { isTauri } from "./bridge/tauri.ts";
import type { Bridge } from "./bridge/types.ts";
import { showControls } from "./bridge/windows.ts";
import { CLEF_CACHED_SEEDS, CLEF_ID, type PolicyChoice } from "./policies.ts";

/** The first map whose decisions the benchmark left in the cache for Clef-flash. */
const CACHED_SEED = Number(CLEF_CACHED_SEEDS.split("-")[0]);

import type { Session } from "./session.ts";
import { buildExecution } from "./theater/execution.ts";
import { type Pace, PREFERENCE_KEYS } from "./theater/preference.ts";

interface Context {
  session: Session;
  view: GameView;
  bridge: Bridge;
  choices: PolicyChoice[];
  select(id: string): void;
  /** `persist: false` is for this run only, so a check never leaves its own choice as the person's. */
  setPace(pace: Pace, persist?: boolean): void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function measureFps(seconds: number): Promise<{ mean: number; p5: number; frames: number }> {
  const deltas: number[] = [];
  await new Promise<void>((done) => {
    const start = performance.now();
    let last = start;
    const step = (now: number) => {
      deltas.push(now - last);
      last = now;
      if (now - start < seconds * 1000) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  });
  const frames = deltas.slice(2); // ignore the first frames while things warm up
  const fps = frames.map((d) => 1000 / d).sort((a, b) => a - b);
  const mean = fps.reduce((a, b) => a + b, 0) / Math.max(1, fps.length);
  return { mean, p5: fps[Math.floor(fps.length * 0.05)] ?? 0, frames: frames.length };
}

async function distinctColours(dataUrl: string): Promise<number> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  ctx.drawImage(image, 0, 0, 64, 64);
  const data = ctx.getImageData(0, 0, 64, 64).data;
  const colours = new Set<number>();
  for (let i = 0; i < data.length; i += 4) {
    colours.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
  }
  return colours.size;
}

function webglRenderer(): string {
  const gl = document.createElement("canvas").getContext("webgl2");
  if (!gl) return "no webgl2";
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
}

type Report = Record<string, unknown>;

async function controlsReport(
  action: string,
  target: "controls" | "decisions" = "controls",
): Promise<Report> {
  const id = crypto.randomUUID();
  let stop = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = new Promise<Report>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Controls self-test timed out")), 8000);
    void getCurrentWindow()
      .listen<{ id: string; report: Report }>(`selftest:${target}-result`, ({ payload }) => {
        if (payload.id === id) resolve(payload.report);
      })
      .then((unlisten) => {
        stop = unlisten;
        return emitTo(target, `selftest:${target}`, { id, action });
      })
      .catch(reject);
  });
  try {
    return await result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    stop();
  }
}

async function checkWindows(ctx: Context): Promise<Report> {
  ctx.select("human");
  ctx.session.start(1);
  ctx.session.setPaused(false);
  await showControls();
  await sleep(350);
  const initial = await controlsReport("status");
  const focusKeepsPlaying = !ctx.session.state().paused;
  const settings = await controlsReport("settings");
  const settingsPaused = ctx.session.state().paused;
  const seed = ctx.session.state().seed;
  await invoke("selftest_window_action", { action: "close-controls" });
  await sleep(200);
  const controls = await Window.getByLabel("controls");
  const hidden = controls !== null && !(await controls.isVisible());
  const button = document.querySelector<HTMLButtonElement>(".open-controls");
  button?.click();
  await sleep(250);
  const reopened = await controlsReport("status");
  const visible = controls !== null && (await controls.isVisible());
  const sameSession = ctx.session.state().seed === seed && ctx.session.state().human;

  const decisions = await Window.getByLabel("decisions");
  const decisionsButton = document.querySelector<HTMLButtonElement>(".toggle-decisions");
  ctx.session.setPaused(false);
  const gameBeforeDecisions = ctx.session.game;
  if (decisions && (await decisions.isVisible())) {
    decisionsButton?.click();
    await sleep(250);
  }
  decisionsButton?.click();
  await sleep(300);
  const decisionsOpened = decisions !== null && (await decisions.isVisible());
  const openingKeepsPlaying = !ctx.session.state().paused;
  const controlsStillVisible = controls !== null && (await controls.isVisible());
  await invoke("selftest_window_action", { action: "close-decisions" });
  await sleep(250);
  const decisionsClosed = decisions !== null && !(await decisions.isVisible());
  decisionsButton?.click();
  await sleep(300);
  const decisionsReopened = decisions !== null && (await decisions.isVisible());
  await invoke("selftest_window_action", { action: "minimize-decisions" });
  await sleep(300);
  const minimizedButtonOff = decisionsButton?.getAttribute("aria-pressed") === "false";
  decisionsButton?.click();
  await sleep(300);
  const decisionsRestored = decisions !== null && !(await decisions.isMinimized());
  const pause = await controlsReport("pause", "decisions");
  const manualPause = pause.paused === true && ctx.session.state().paused;
  await controlsReport("pause", "decisions");
  const manualResume = !ctx.session.state().paused;
  const sameGameAfterDecisions = gameBeforeDecisions === ctx.session.game;
  const menuBounds = button?.getBoundingClientRect();
  const decisionsBounds = decisionsButton?.getBoundingClientRect();
  const decisionsBelowControls =
    !!menuBounds &&
    !!decisionsBounds &&
    decisionsBounds.top >= menuBounds.bottom &&
    decisionsBounds.width === menuBounds.width &&
    decisionsBounds.height === menuBounds.height;

  const originalLanguage = document.documentElement.lang;
  const originalGame = ctx.session.game;
  let language: Report;
  try {
    const changed = await controlsReport("language");
    await sleep(200);
    language = {
      controls: changed.language,
      game: document.documentElement.lang,
      decisions: (await controlsReport("status", "decisions")).language,
      synchronized:
        changed.language === document.documentElement.lang &&
        changed.language === (await controlsReport("status", "decisions")).language,
      sameGame: ctx.session.game === originalGame && ctx.session.state().seed === seed,
    };
  } finally {
    await controlsReport("restore-language");
    await sleep(200);
  }
  language.restored = document.documentElement.lang === originalLanguage;

  ctx.session.setPaused(false);
  await invoke("selftest_window_action", { action: "minimize" });
  await sleep(1500);
  const pausedOnMinimize = ctx.session.state().paused;
  const tick = ctx.session.state().tick;
  await sleep(300);
  const stopped = ctx.session.state().tick === tick;
  await invoke("selftest_window_action", { action: "restore" });
  await sleep(250);
  const stayedPaused = ctx.session.state().paused;
  ctx.session.setPaused(false);

  return {
    windows: {
      gameHasNoPanel: document.querySelector(".panel") === null,
      initial,
      focusKeepsPlaying,
      settings,
      settingsPaused,
      hidden,
      buttonPresent: !!button,
      visible,
      reopened,
      sameSession,
      decisions: {
        decisionsOpened,
        openingKeepsPlaying,
        controlsStillVisible,
        decisionsClosed,
        decisionsReopened,
        minimizedButtonOff,
        decisionsRestored,
        manualPause,
        manualResume,
        sameGameAfterDecisions,
        decisionsBelowControls,
      },
      language,
      pausedOnMinimize,
      stopped,
      stayedPaused,
    },
  };
}

/** Plays the free look-ahead, measures the frame rate and checks that the scene really rendered. */
async function checkRendering(ctx: Context): Promise<Report> {
  ctx.select("lookahead");
  ctx.session.setSpeed(1);
  ctx.session.start(1);
  await sleep(1500); // let the first rows and models settle

  const fps = await measureFps(5);
  const canvas = document.querySelector("canvas.game") as HTMLCanvasElement | null;
  const colours = await distinctColours(ctx.view.captureDataUrl(256, 256));
  const state = ctx.session.state();
  return {
    window: {
      inner: [window.innerWidth, window.innerHeight],
      canvas: canvas ? [canvas.width, canvas.height] : null,
      devicePixelRatio: window.devicePixelRatio,
    },
    webgl: { renderer: webglRenderer(), stats: ctx.view.stats() },
    fps,
    render: { distinctColours: colours, rendered: colours > 12 },
    game: {
      seed: state.seed,
      score: state.score,
      decisions: state.decisions,
      alive: state.alive,
      policy: state.policyId,
    },
  };
}

/** The budget view, and, only when the day's budget is spent, that the Rust side refuses a call. */
async function checkBudget(ctx: Context): Promise<Report> {
  const budget = await ctx.bridge.budget();
  let refusal: Report = { ok: true, skipped: "budget not exhausted, so no call was attempted" };
  if (budget.spent >= budget.limit) {
    try {
      await ctx.bridge.run("clef-flash", { model: "clef-flash", state: {}, questions: {} });
      refusal = { ok: false, note: "the call was NOT refused" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      refusal = { ok: isBudgetRefusal(message), message };
    }
  }
  return {
    budget,
    refusal,
    cacheMiss: await ctx.bridge.cacheGet("selftest-key-that-does-not-exist"),
  };
}

/**
 * The whole Clef pipeline through the native side WITHOUT spending: the first cached map was already played
 * with this exact policy by the benchmark, so every decision should come from the cache.
 */
async function checkClefFromCache(ctx: Context): Promise<Report> {
  ctx.select(CLEF_ID);
  ctx.session.setSpeed(4);
  ctx.session.start(CACHED_SEED);
  const started = performance.now();
  while (performance.now() - started < 12_000) {
    const s = ctx.session.state();
    if (s.decisions >= 3 || s.phase === "error" || !s.alive) break;
    await sleep(100);
  }
  const clef = ctx.session.state();
  return {
    clef: {
      policy: clef.policyId,
      decisions: clef.decisions,
      cacheHits: clef.cacheHits,
      neurons: clef.neurons,
      phase: clef.phase,
      error: clef.error,
      lastAction: clef.last?.action ?? null,
      probabilities: clef.last?.decision.probabilities ?? null,
      confidence: clef.last?.decision.confidence ?? null,
      // A manoeuvre's own steps are not model calls, so the test is that every answer came from the cache and cost nothing.
      allFromCache: clef.cacheHits > 0 && clef.neurons === 0,
      ...(clef.decisions === 0 && clef.phase === "error"
        ? { skipped: "Cached replay unavailable; self-test never uses the API" }
        : {}),
    },
    budgetAfter: await ctx.bridge.budget(),
  };
}

/**
 * Human mode through the real keyboard handler of the window. The key events are synthetic, but they
 * reach the same `keydown` listener a physical key would.
 */
async function checkHumanKeys(ctx: Context): Promise<Report> {
  ctx.select("human");
  ctx.session.setSpeed(1);
  ctx.session.start(1);
  await sleep(200);
  const before = { row: ctx.session.game.heroRow, x: ctx.session.game.heroX };
  const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowLeft"];
  for (const key of keys) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    await sleep(320);
  }
  const human = ctx.session.state();
  return {
    human: {
      keysSent: keys.length,
      decisions: human.decisions,
      moved:
        ctx.session.game.heroRow !== before.row ||
        ctx.session.game.heroX !== before.x ||
        human.invalidMoves > 0,
      invalidMoves: human.invalidMoves,
      score: human.score,
      alive: human.alive,
      handledAllKeys: human.decisions === keys.length,
    },
  };
}

/**
 * Holding the forward key in the real window (a key repeat every frame, far faster than a hop) must be
 * the same game as hopping forward one hop at a time: the same score and the same cause of death.
 * Before the input queue, the chained hops skipped the water and car checks and ran for dozens of rows.
 */
async function checkHeldKey(ctx: Context): Promise<Report> {
  const seed = 1;
  ctx.select("human");
  ctx.session.setSpeed(1);
  ctx.session.start(seed);
  const started = performance.now();
  while (performance.now() - started < 4000 && ctx.session.state().alive) {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", repeat: true, bubbles: true }),
    );
    await sleep(16);
  }
  const held = ctx.session.state();
  const stepped = new Game({ seed });
  for (let i = 0; i < 100 && stepped.alive; i++) stepped.step("hop_forward");
  return {
    heldKey: {
      score: held.score,
      deathCause: held.deathCause,
      steppedScore: stepped.score,
      steppedDeathCause: stepped.deathCause,
      matchesSteppedGame: held.score === stepped.score && held.deathCause === stepped.deathCause,
    },
  };
}

/**
 * The window that shows what the model read, opened with the I key in the real window: it must exist,
 * show the state (with the rows of the world), the question and the options, and close again.
 */
async function checkInspector(ctx: Context): Promise<Report> {
  ctx.select(CLEF_ID);
  ctx.session.setSpeed(4);
  ctx.session.start(CACHED_SEED);
  const started = performance.now();
  while (
    performance.now() - started < 12_000 &&
    ctx.session.state().decisions < 1 &&
    ctx.session.state().phase !== "error"
  )
    await sleep(100);

  const press = () =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
  press();
  await sleep(250);
  return { inspector: await controlsReport("inspector", "decisions") };
}

/** What the person had chosen, to put back after a check that presses the keys that save a choice. */
function savePreferences(): Array<[string, string | null]> {
  return PREFERENCE_KEYS.map((key): [string, string | null] => {
    try {
      return [key, localStorage.getItem(key)];
    } catch {
      return [key, null];
    }
  });
}

function restorePreferences(saved: ReadonlyArray<readonly [string, string | null]>): void {
  try {
    for (const [key, value] of saved) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
  } catch {
    // Storage is not available; nothing was kept either.
  }
}

/**
 * What shows live execution in the real window: the compass around the chicken (five moves, one active, a
 * caption) and the conversation column (a CLEF bubble whose options carry the model's pick). C and T hide
 * and bring them back.
 */
async function checkTheater(ctx: Context): Promise<Report> {
  const saved = savePreferences();
  ctx.setPace("live", false);
  ctx.select(CLEF_ID);
  ctx.session.setSpeed(4);
  ctx.session.start(CACHED_SEED);
  const count = (selector: string) => document.querySelectorAll(selector).length;
  const press = async (key: string) => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    await sleep(250);
  };
  const started = performance.now();
  while (
    performance.now() - started < 12_000 &&
    ctx.session.state().decisions < 1 &&
    ctx.session.state().phase !== "error"
  )
    await sleep(100);
  // A choice saved by an earlier session may have hidden one of them; the check is about the views themselves.
  const compassByDefault = count(".compass-anchor") === 1;
  if (!compassByDefault) await press("c");
  const conversation = async () =>
    (await controlsReport("status", "decisions")).conversation as {
      shown: boolean;
      bubbles: number;
      questions: number;
      picks: number;
    };
  const conversationByDefault = (await conversation()).shown;
  if (!conversationByDefault) await press("t");
  // The cached game keeps going: wait for a moment when an answer, not a question, is on screen.
  while (
    performance.now() - started < 20_000 &&
    count(".compass .cb.actual") === 0 &&
    ctx.session.state().phase !== "error"
  )
    await sleep(50);
  ctx.session.setPaused(true);
  await sleep(80);
  const buttons = count(".compass .cb");
  const lit = count(".compass .cb.actual");
  const actual = buildExecution(ctx.session.state(), ctx.session.game.snapshot()).action;
  const activeMatches = document.querySelector(".cb.actual")?.getAttribute("data-move") === actual;
  const pathMarkers = ctx.view.stats().decisionMarkers;
  const caption = document.querySelector(".cap-main")?.textContent ?? "";
  const { bubbles, picks, questions } = await conversation();
  await invoke("selftest_window_action", { action: "small-decisions" });
  await sleep(250);
  const smallWindow = await controlsReport("status", "decisions");
  await invoke("selftest_window_action", { action: "restore-decisions-size" });
  await sleep(250);
  await press("c");
  const compassHiddenWithC = count(".compass-anchor") === 0;
  const pathHiddenWithC = ctx.view.stats().decisionMarkers === 0;
  await press("c");
  const compassShownAgain = count(".compass-anchor") === 1;
  await press("t");
  const conversationHiddenWithT = !(await conversation()).shown;
  await press("t");
  const conversationShownAgain = (await conversation()).shown;
  // The checks that follow run against the window as it started: both views end up shown, so hide what was hidden.
  if (!compassByDefault) await press("c");
  if (!conversationByDefault) await press("t");
  restorePreferences(saved);
  ctx.session.setPaused(false);
  return {
    theater: {
      compassByDefault,
      conversationByDefault,
      compass: {
        buttons,
        lit,
        activeMatches,
        pathMarkers,
        pathHiddenWithC,
        caption,
        hiddenWithC: compassHiddenWithC,
        shownAgain: compassShownAgain,
      },
      conversation: {
        smallWindow,
        bubbles,
        questions,
        picks,
        everyQuestionHasAPick: questions > 0 && picks === questions,
        hiddenWithT: conversationHiddenWithT,
        shownAgain: conversationShownAgain,
      },
    },
  };
}

/**
 * Only runs in the desktop app when launched with CCR_SELFTEST=1: checks rendering, the budget,
 * the cached Clef pipeline and the keyboard, writes runs/selftest.json and exits.
 */
export async function runSelfTest(ctx: Context): Promise<void> {
  if (!isTauri()) return;
  let enabled = false;
  try {
    enabled = await invoke<boolean>("selftest_enabled");
  } catch {
    return;
  }
  if (!enabled) return;

  const preferences = savePreferences();
  const report: Report = { startedAt: new Date().toISOString() };
  // Full speed, as before the pace existed: the checks wait on the game, not on a person reading.
  ctx.setPace("live", false);
  try {
    for (const check of [
      checkRendering,
      checkWindows,
      checkBudget,
      checkClefFromCache,
      checkInspector,
      checkTheater,
      checkHumanKeys,
      checkHeldKey,
    ]) {
      Object.assign(report, await check(ctx));
    }
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  } finally {
    restorePreferences(preferences);
  }
  report.finishedAt = new Date().toISOString();
  await invoke("report_selftest", { report });
}
