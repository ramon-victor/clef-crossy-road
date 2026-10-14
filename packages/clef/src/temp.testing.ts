import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

/**
 * Scratch directories for a test file, all removed after each test. Call it once at the top of the
 * file; the returned function makes a new directory and returns its path.
 */
export function useTempDirs(): () => string {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  return () => {
    const dir = mkdtempSync(join(tmpdir(), "ccr-clef-"));
    dirs.push(dir);
    return dir;
  };
}
