/**
 * Pixel-art icons for the moves and the answers, drawn by hand on a 9x9 grid so they stay crisp at any size:
 * one arrow that turns in quarter turns into the four directions, and a few signs. Nothing here is rotated by
 * an odd angle, which is what makes pixel art blur.
 */
export type Direction = "n" | "e" | "s" | "w";
export type Sign = "wait" | "check" | "cross" | "both" | "block" | "warn";
export type IconName = Direction | Sign;

/** The arrow straight up, 9x9. */
const STRAIGHT = [
  "....#....",
  "...###...",
  "..#####..",
  ".#######.",
  "#########",
  "...###...",
  "...###...",
  "...###...",
  "...###...",
];

const SIGNS: Readonly<Record<Sign, readonly string[]>> = {
  // Two bars: the chicken stays where it is.
  wait: [
    ".........",
    ".###.###.",
    ".###.###.",
    ".###.###.",
    ".###.###.",
    ".###.###.",
    ".###.###.",
    ".###.###.",
    ".........",
  ],
  check: [
    ".........",
    "........#",
    ".......##",
    "......##.",
    "#....##..",
    "##..##...",
    ".####....",
    "..##.....",
    ".........",
  ],
  cross: [
    ".........",
    ".##...##.",
    ".###.###.",
    "..#####..",
    "...###...",
    "..#####..",
    ".###.###.",
    ".##...##.",
    ".........",
  ],
  both: [
    ".........",
    ".........",
    ".#.....#.",
    "##.....##",
    "#########",
    "##.....##",
    ".#.....#.",
    ".........",
    ".........",
  ],
  block: [
    ".........",
    ".........",
    "..#####..",
    "..#####..",
    "..#####..",
    "..#####..",
    "..#####..",
    ".........",
    ".........",
  ],
  // An exclamation mark: the platform is carrying the chicken to the edge of the world.
  warn: [
    "...###...",
    "...###...",
    "...###...",
    "...###...",
    "...###...",
    ".........",
    "...###...",
    "...###...",
    ".........",
  ],
};

/** A quarter turn clockwise. */
function turnOnce(rows: readonly string[]): string[] {
  const n = rows.length;
  return rows.map((_, r) => rows.map((__, c) => rows[n - 1 - c]?.[r] ?? ".").join(""));
}

function turned(rows: readonly string[], quarters: number): string[] {
  let out = [...rows];
  for (let i = 0; i < ((quarters % 4) + 4) % 4; i++) out = turnOnce(out);
  return out;
}

export const DIRECTIONS: readonly Direction[] = ["n", "e", "s", "w"];

/** The nine-by-nine drawing of an icon, one string per row, `#` for a pixel. */
export function spriteOf(icon: IconName): string[] {
  switch (icon) {
    case "n":
      return turned(STRAIGHT, 0);
    case "e":
      return turned(STRAIGHT, 1);
    case "s":
      return turned(STRAIGHT, 2);
    case "w":
      return turned(STRAIGHT, 3);
    default:
      return [...SIGNS[icon]];
  }
}

/** Side of the drawing with its one-pixel edge around it. */
export const ICON_SIZE = 11;

export interface IconCells {
  /** Pixels of the icon itself, as `[x, y]` on the 11x11 canvas. */
  fill: Array<[number, number]>;
  /** The pixels around it, which keep it readable on any background. */
  edge: Array<[number, number]>;
}

/** The pixels of an icon and of its edge, on a canvas one pixel wider than the drawing on every side. */
export function cellsOf(icon: IconName): IconCells {
  const sprite = spriteOf(icon);
  const on = (x: number, y: number): boolean => sprite[y]?.[x] === "#";
  const fill: Array<[number, number]> = [];
  const edge: Array<[number, number]> = [];
  for (let y = -1; y <= sprite.length; y++) {
    for (let x = -1; x <= (sprite[0]?.length ?? 0); x++) {
      if (on(x, y)) {
        fill.push([x + 1, y + 1]);
        continue;
      }
      let touches = false;
      for (let dy = -1; dy <= 1 && !touches; dy++)
        for (let dx = -1; dx <= 1; dx++) if (on(x + dx, y + dy)) touches = true;
      if (touches) edge.push([x + 1, y + 1]);
    }
  }
  return { fill, edge };
}

/** An SVG path of one square per pixel, so a whole icon is a single element per colour. */
export const pathOf = (cells: ReadonlyArray<readonly [number, number]>): string =>
  cells.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join("");

/**
 * The icon for a character the app writes moves and answers with, or null for any other text. The arrows are
 * straight: forward is up and back is down, as the page reads, even though the camera is turned and the
 * chicken's hop climbs the screen to the upper right (about 27 degrees).
 */
export function iconForGlyph(glyph: string): IconName | null {
  switch (glyph) {
    case "↑":
      return "n";
    case "↓":
      return "s";
    case "←":
      return "w";
    case "→":
      return "e";
    case "•":
      return "wait";
    case "✓":
      return "check";
    case "✗":
      return "cross";
    case "↔":
      return "both";
    case "▪":
      return "block";
    case "!":
      return "warn";
    default:
      return null;
  }
}
