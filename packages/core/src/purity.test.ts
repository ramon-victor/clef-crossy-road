import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * AGENTS.md hard rule 1: nothing in the core may read the clock, the platform or any other
 * source of nondeterminism. The compiler already has no DOM/Node types here (`types: []`);
 * this test also bans the usual escape hatches by name.
 */
const FORBIDDEN: readonly [string, RegExp][] = [
  ["Math.random", /\bMath\s*\.\s*random\b/],
  ["Date", /\bDate\b/],
  ["performance", /\bperformance\b/],
  ["timers", /\b(setTimeout|setInterval|requestAnimationFrame|queueMicrotask)\b/],
  ["DOM", /\b(document|window|navigator|localStorage)\b/],
  ["process/Buffer", /\b(process|Buffer)\b/],
  ["network/IO", /\b(fetch|XMLHttpRequest|WebSocket)\b/],
  ["crypto", /\bcrypto\b/],
  ["Intl/locale", /\b(Intl|toLocale\w*)\b/],
  ["Three.js", /from\s+["']three/],
  ["node imports", /from\s+["']node:/],
  ["dynamic import/require", /\b(require\s*\(|import\s*\()/],
];

const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/.*$/gm, "");

describe("core purity", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("finds the source files", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const [label, pattern] of FORBIDDEN) {
    it(`uses no ${label}`, () => {
      for (const file of files) {
        const code = stripComments(readFileSync(join(dir, file), "utf8"));
        expect(pattern.test(code), `${file} must not use ${label}`).toBe(false);
      }
    });
  }
});
