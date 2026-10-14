/** A number with fixed decimals, or `n/a` when it is not finite (an empty class, no samples). */
export const fixed = (n: number, digits = 2): string =>
  Number.isFinite(n) ? n.toFixed(digits) : "n/a";

/** `part` as a whole-number percentage of `total`. */
export const percent = (part: number, total: number): string =>
  `${Math.round((100 * part) / Math.max(1, total))}%`;

/** The lines of a GitHub-flavoured markdown table. */
export function markdownTable(
  headers: readonly string[],
  rows: readonly (readonly (string | number)[])[],
): string[] {
  return [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ];
}

/** Policy ids are shown as code. */
export const code = (text: string): string => `\`${text}\``;
