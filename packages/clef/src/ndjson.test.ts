import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendNdjson, endPartialLine, readNdjson } from "./ndjson.ts";
import { useTempDirs } from "./temp.testing.ts";

const tempDir = useTempDirs();
function tempFile(contents?: string): string {
  const path = join(tempDir(), "data.ndjson");
  if (contents !== undefined) writeFileSync(path, contents);
  return path;
}

describe("ndjson", () => {
  it("reads nothing from a file that does not exist", () => {
    expect(readNdjson(tempFile())).toEqual([]);
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
