import { appendFileSync, existsSync, readFileSync } from "node:fs";

/**
 * Parsed lines of an NDJSON file, or `[]` if it does not exist. Blank and unparseable lines are
 * skipped: a process killed mid-write leaves a truncated last line, and that record is simply lost.
 */
export function readNdjson(path: string): unknown[] {
  if (!existsSync(path)) return [];
  const values: unknown[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      values.push(JSON.parse(line));
    } catch {
      // truncated by a crash
    }
  }
  return values;
}

/**
 * Ends a partial last line left by a crash. Call it once before appending: otherwise the next record
 * would be glued to the fragment and lost, which for the spend ledger means under-counting spending.
 */
export function endPartialLine(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  if (text.length > 0 && !text.endsWith("\n")) appendFileSync(path, "\n");
}

export function appendNdjson(path: string, value: unknown): void {
  appendFileSync(path, `${JSON.stringify(value)}\n`);
}
