import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendNdjson, endPartialLine, readNdjson } from "./ndjson.ts";

const dirs: string[] = [];
function tempFile(contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ccr-ndjson-"));
  dirs.push(dir);
  const path = join(dir, "data.ndjson");
  if (contents !== undefined) writeFileSync(path, contents);
  return path;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("ndjson", () => {
  it("reads nothing from a file that does not exist", () => {
    expect(readNdjson(join(tmpdir(), "ccr-ndjson-missing.ndjson"))).toEqual([]);
  });

  it("skips blank lines and a line cut short by a crash", () => {
    const path = tempFile('{"a":1}\n\n{"a":2}\n{"a":');
    expect(readNdjson(path)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("does not let the next record be glued to a partial last line", () => {
    const path = tempFile('{"a":1}\n{"a":');
    endPartialLine(path);
    appendNdjson(path, { a: 3 });
    expect(readNdjson(path)).toEqual([{ a: 1 }, { a: 3 }]);
  });

  it("leaves a clean file untouched", () => {
    const path = tempFile('{"a":1}\n');
    endPartialLine(path);
    expect(readFileSync(path, "utf8")).toBe('{"a":1}\n');
  });
});
