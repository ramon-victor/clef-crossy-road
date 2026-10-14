import type { GameView } from "@ccr/render";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./bridge/tauri.ts";
import type { Bridge } from "./bridge/types.ts";
import type { PolicyChoice } from "./policies.ts";
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

/**
 * Only runs in the desktop app when launched with CCR_SELFTEST=1: plays the free look-ahead for a
 * few seconds, measures the frame rate, checks that the scene really rendered and that the Rust
 * side refuses an over-budget call, writes runs/selftest.json and exits.
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

  const report: Record<string, unknown> = { startedAt: new Date().toISOString() };
  try {
    ctx.select("lookahead");
    ctx.session.setSpeed(1);
    ctx.session.start(1);
    await sleep(1500); // let the first rows and models settle

    const fps = await measureFps(5);
    const canvas = document.querySelector("canvas.game") as HTMLCanvasElement | null;
    const colours = await distinctColours(ctx.view.captureDataUrl(256, 256));
    const state = ctx.session.state();

    report.window = {
      inner: [window.innerWidth, window.innerHeight],
      canvas: canvas ? [canvas.width, canvas.height] : null,
      devicePixelRatio: window.devicePixelRatio,
    };
    report.webgl = { renderer: webglRenderer(), stats: ctx.view.stats() };
    report.fps = fps;
    report.render = { distinctColours: colours, rendered: colours > 12 };
    report.game = {
      seed: state.seed,
      score: state.score,
      decisions: state.decisions,
      alive: state.alive,
      policy: state.policyId,
    };

    // Budget IPC and the Rust-side refusal.
    const budget = await ctx.bridge.budget();
    report.budget = budget;
    if (budget.spent >= budget.limit) {
      try {
        await ctx.bridge.run("clef-flash", { model: "clef-flash", state: {}, questions: {} });
        report.refusal = { ok: false, note: "the call was NOT refused" };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        report.refusal = { ok: /Nothing was sent/.test(message), message };
      }
    } else {
      report.refusal = { ok: true, skipped: "budget not exhausted, so no call was attempted" };
    }
    report.cacheMiss = await ctx.bridge.cacheGet("selftest-key-that-does-not-exist");

    // The whole Clef pipeline through the native side WITHOUT spending: seed 1 was already played
    // with this exact policy by the benchmark, so every decision should come from the cache.
    ctx.select("clef-flash-json");
    ctx.session.setSpeed(4);
    ctx.session.start(1);
    const clefStart = performance.now();
    while (performance.now() - clefStart < 12_000) {
      const s = ctx.session.state();
      if (s.decisions >= 3 || s.phase === "error" || !s.alive) break;
      await sleep(100);
    }
    const clef = ctx.session.state();
    report.clef = {
      policy: clef.policyId,
      decisions: clef.decisions,
      cacheHits: clef.cacheHits,
      neurons: clef.neurons,
      phase: clef.phase,
      error: clef.error,
      lastAction: clef.last?.action ?? null,
      probabilities: clef.last?.decision.probabilities ?? null,
      confidence: clef.last?.decision.confidence ?? null,
      allFromCache: clef.decisions > 0 && clef.cacheHits === clef.decisions && clef.neurons === 0,
    };
    report.budgetAfter = await ctx.bridge.budget();

    // Human mode through the real keyboard handler of the window (synthetic key events: they reach
    // the same `keydown` listener a physical key would).
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
    report.human = {
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
    };
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  }

  report.finishedAt = new Date().toISOString();
  await invoke("report_selftest", { report });
}
