import { isBudgetRefusal } from "@ccr/clef";
import { Game } from "@ccr/core";
import type { GameView } from "@ccr/render";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./bridge/tauri.ts";
import type { Bridge } from "./bridge/types.ts";
import { CLEF_CACHED_SEEDS, CLEF_ID, type PolicyChoice } from "./policies.ts";

/** The first map whose decisions the benchmark left in the cache for Clef-flash. */
const CACHED_SEED = Number(CLEF_CACHED_SEEDS.split("-")[0]);

import type { Session } from "./session.ts";

interface Context {
  session: Session;
  view: GameView;
  bridge: Bridge;
  choices: PolicyChoice[];
  select(id: string): void;
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
  while (performance.now() - started < 12_000 && ctx.session.state().decisions < 1)
    await sleep(100);

  const press = () =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
  press();
  await sleep(250);
  const text = (selector: string) => document.querySelector(selector)?.textContent ?? "";
  const opened = document.querySelector(".inspector") !== null;
  const state = text(".inspector-pre");
  const click = (tab: string) =>
    document.querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`)?.click();
  click("question");
  await sleep(100);
  const question = text(".inspector-pre");
  click("options");
  await sleep(100);
  const options = text(".inspector-body");
  press();
  await sleep(150);
  return {
    inspector: {
      opened,
      // The route gameplay keys its state by the names of the manoeuvres (the rows are summed up in words).
      stateHasRows: state.includes('"cross_ahead"') && state.includes('"detour_left"'),
      stateChars: state.length,
      questionHasRules: question.includes("chicken"),
      optionsListMoves: [
        "stand",
        "no_stand",
        "moving",
        "still",
        "detour_left",
        "detour_right",
        "wait_here",
      ].every((m) => options.includes(m)),
      closedAgain: document.querySelector(".inspector") === null,
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

  const report: Report = { startedAt: new Date().toISOString() };
  try {
    for (const check of [
      checkRendering,
      checkBudget,
      checkClefFromCache,
      checkInspector,
      checkHumanKeys,
      checkHeldKey,
    ]) {
      Object.assign(report, await check(ctx));
    }
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  }
  report.finishedAt = new Date().toISOString();
  await invoke("report_selftest", { report });
}
