// Generates docs/images/clef-flow-{light,dark}.svg, the animated "How Clef plays" figure of the README.
// Each theme is one self-contained SVG: a static diagram plus CSS keyframes compiled from SCENES. There is no
// script and no external font, so it animates wherever an <img> renders, GitHub included. Under
// prefers-reduced-motion it shows the last scene, complete. Nothing in the SVGs is hand-written:
//   node scripts/gen-flow-figure.mjs           rewrite both files
//   node scripts/gen-flow-figure.mjs --check   exit 1 if a file differs from what this script writes
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const out = resolve(import.meta.dirname, "../docs/images");
const THEMES = {
  light: {
    paper: "#f5f5f5",
    node: "#ffffff",
    ink: "#2d3142",
    soft: "#5a6580",
    rule: "#bfc0c0",
    accent: "#bf4520",
    tint: "rgba(191,69,32,0.05)",
    track: "rgba(45,49,66,0.10)",
    water: "rgba(46,90,168,0.16)",
    road: "rgba(45,49,66,0.10)",
    grass: "rgba(124,143,111,0.22)",
    log: "#9c6b50",
    car: "#2d3142",
    pad: "#7c8f6f",
    hen: "#ffffff",
  },
  dark: {
    paper: "#2d3142",
    node: "#353a4e",
    ink: "#f5f5f5",
    soft: "#a9b1c4",
    rule: "rgba(191,192,192,0.35)",
    accent: "#f08a59",
    tint: "rgba(240,138,89,0.09)",
    track: "rgba(245,245,245,0.10)",
    water: "rgba(115,159,223,0.20)",
    road: "rgba(245,245,245,0.08)",
    grass: "rgba(156,175,143,0.20)",
    log: "#b88670",
    car: "#bfc0c0",
    pad: "#9caf8f",
    hen: "#f5f5f5",
  },
};
const SANS = `-apple-system,'Segoe UI',Inter,Roboto,'Helvetica Neue',Arial,sans-serif`;
const MONO = `ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace`;

// Three real decisions of the cached Clef-flash replay of seed 624140 (route-live), one per outcome. Answers come
// from runs/live2-s624140/episodes.ndjson (records[decision - 1].extra) and the app's technical details; the words
// from `node apps/bench/src/cli.ts show-input --seed 624140 --actions <the moves before that decision>`.
const SCENES = [
  {
    decision: 6,
    row: 13,
    words: ["lands_on: empty", "things_move: still"],
    answers: [["stand", 0.97], ["still", 0.94], null, ["remain", 0.95]],
    outcome: 0,
  },
  {
    decision: 7,
    row: 14,
    words: ["lands_on: water", "things_move: right"],
    answers: [["no_stand", 0.7], ["moving", 0.87], null, ["remain", 0.97]],
    outcome: 1,
  },
  {
    decision: 24,
    row: 17,
    words: ["lands_on: water", "things_move: still", "right: three_or_more"],
    answers: [
      ["no_stand", 0.57],
      ["still", 0.95],
      ["right", 0.83],
      ["remain", 0.97],
    ],
    outcome: 2,
  },
];
const QUESTIONS = ["Land ahead?", "Row moves?", "Which way?", "Stay here?"];
const OUTCOMES = [
  ["Hop now", "it can land ahead"],
  ["Wait, ask again", "the row ahead moves"],
  ["Go round", "code walks the path"],
];
const SCENE = 5.5; // seconds per scene
const LOOP = SCENE * SCENES.length;
const LAST = SCENES.length - 1;

// Layout, on a 4px grid. Cards share one row; the outcomes stack on the right.
const W = 880;
const H = 292;
const CARD = { y: 56, h: 180 };
const GAME = { x: 16, w: 160 };
const WORDS = { x: 212, w: 172 };
const CLEF = { x: 420, w: 208 };
const PILL = { x: 676, w: 184, h: 44 };
const MID = CARD.y + CARD.h / 2;
const PILL_Y = [MID - 54, MID, MID + 54];
const JOIN = 652;
const LOOP_X = 868;
const LOOP_Y = 264;
const R = 8;

const pct = (t) => `${Number(((t / LOOP) * 100).toFixed(3))}%`;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One CSS class per animated element; every track runs on the shared loop. */
class Sheet {
  rules = [];
  add(...tracks) {
    const name = `a${this.rules.length}`;
    const frames = [];
    const uses = [];
    tracks.forEach(([prop, timing, keys], i) => {
      const held = new Map([[0, keys[0][1]], ...keys, [LOOP, keys.at(-1)[1]]]);
      const stops = [...held].map(([t, v]) => `${pct(t)}{${prop}:${v}}`).join("");
      frames.push(`@keyframes ${name}k${i}{${stops}}`);
      uses.push(`${name}k${i} ${LOOP}s ${timing} infinite`);
    });
    this.rules.push(`${frames.join("")}.${name}{animation:${uses.join(",")}}`);
    return name;
  }
}

/** Visible from `start` until the scene ends (or the loop ends, for the last scene). */
function shown(scene, start) {
  const begin = scene * SCENE + start;
  const end = (scene + 1) * SCENE;
  const keys = [
    [0, "0"],
    [begin, "1"],
  ];
  if (end < LOOP) keys.push([end, "0"]);
  return ["opacity", "step-end", keys];
}

/** Elements of the last scene are what the static frame shows; the others start hidden. */
const base = (scene) => (scene === LAST ? "" : ' opacity="0"');

/** Length of an orthogonal path made of H/V moves with quarter-circle elbows of radius R. */
function route(points) {
  let d = `M${points[0][0]} ${points[0][1]}`;
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const last = i === points.length - 1;
    const next = points[i + 1];
    const span = Math.abs(x1 - x0) + Math.abs(y1 - y0);
    if (last || !next) {
      d += x1 === x0 ? ` V${y1}` : ` H${x1}`;
      length += span;
      continue;
    }
    const sx = Math.sign(x1 - x0);
    const sy = Math.sign(y1 - y0);
    const tx = Math.sign(next[0] - x1);
    const ty = Math.sign(next[1] - y1);
    d += x1 === x0 ? ` V${y1 - sy * R}` : ` H${x1 - sx * R}`;
    d += ` Q${x1} ${y1} ${x1 + tx * R} ${y1 + ty * R}`;
    points[i] = [x1 + tx * R, y1 + ty * R];
    length += span - R + (Math.PI * R) / 2;
  }
  return { d, length: Math.round(length) };
}

function build(theme) {
  const c = THEMES[theme];
  const sheet = new Sheet();
  const body = [];
  const add = (s) => body.push(s);

  // Wires: the main row, the fork to the three outcomes and the loop back to the game.
  const toWords = route([
    [GAME.x + GAME.w, MID],
    [WORDS.x - 2, MID],
  ]);
  const toClef = route([
    [WORDS.x + WORDS.w, MID],
    [CLEF.x - 2, MID],
  ]);
  const fork = PILL_Y.map((y) =>
    y === MID
      ? route([
          [CLEF.x + CLEF.w, MID],
          [PILL.x - 2, MID],
        ])
      : route([
          [CLEF.x + CLEF.w, MID],
          [JOIN, MID],
          [JOIN, y],
          [PILL.x - 2, y],
        ]),
  );
  const back = PILL_Y.map((y) =>
    route([
      [PILL.x + PILL.w, y],
      [LOOP_X, y],
      [LOOP_X, LOOP_Y],
      [GAME.x + GAME.w / 2, LOOP_Y],
      [GAME.x + GAME.w / 2, CARD.y + CARD.h + 2],
    ]),
  );
  for (const w of [toWords, toClef, ...fork])
    add(`<path class="wire" d="${w.d}" marker-end="url(#cf-head)"/>`);
  add(`<path class="wire" d="${back[0].d}" marker-end="url(#cf-head)"/>`);
  for (const y of PILL_Y.slice(1))
    add(`<path class="wire" d="M${PILL.x + PILL.w} ${y} H${LOOP_X}"/>`);
  const labelX = (GAME.x + GAME.w / 2 + LOOP_X) / 2;
  add(`<rect class="paper" x="${labelX - 76}" y="${LOOP_Y - 10}" width="152" height="20"/>`);
  add(
    `<text class="mono soft" x="${labelX}" y="${LOOP_Y + 4}" text-anchor="middle">next step, 0.2 s later</text>`,
  );

  // A short accent dash runs along a wire between two times of a scene.
  const pulse = (wire, scene, from, to) => {
    const t0 = scene * SCENE + from;
    const t1 = scene * SCENE + to;
    const name = sheet.add(
      [
        "stroke-dashoffset",
        "linear",
        [
          [t0, "18px"],
          [t1, `${-wire.length}px`],
        ],
      ],
      [
        "opacity",
        "step-end",
        [
          [0, "0"],
          [t0, "1"],
          [t1, "0"],
        ],
      ],
    );
    add(
      `<path class="pulse ${name}" d="${wire.d}" stroke-dasharray="18 ${wire.length + 18}" opacity="0"/>`,
    );
  };

  // The game: three lanes and the chicken. The lane ahead shows what each decision saw.
  const lanes = { x: GAME.x + 12, w: GAME.w - 24, y: CARD.y + 40, h: 30, gap: 4 };
  const laneY = (i) => lanes.y + i * (lanes.h + lanes.gap);
  add(
    `<rect class="node" x="${GAME.x}" y="${CARD.y}" width="${GAME.w}" height="${CARD.h}" rx="12"/>`,
  );
  add(`<text class="title" x="${GAME.x + 16}" y="${CARD.y + 26}">The game</text>`);
  add(
    `<clipPath id="cf-lanes"><rect x="${lanes.x}" y="${lanes.y}" width="${lanes.w}" height="${4 * lanes.h + 3 * lanes.gap}" rx="6"/></clipPath>`,
  );
  add(`<g clip-path="url(#cf-lanes)">`);
  add(
    `<rect x="${lanes.x}" y="${laneY(0)}" width="${lanes.w}" height="${lanes.h}" fill="${c.road}"/>`,
  );
  add(
    `<rect class="car" x="${lanes.x}" y="${laneY(0) + 8}" width="26" height="14" rx="3" fill="${c.car}"/>`,
  );
  SCENES.forEach((s, i) => {
    const name = sheet.add(shown(i, 0));
    const y = laneY(1);
    const lane = s.words[0].endsWith("water") ? c.water : c.grass;
    let extra = "";
    if (s.outcome === 1)
      extra = `<rect class="log" x="${lanes.x}" y="${y + 9}" width="40" height="12" rx="3" fill="${c.log}"/>`;
    if (s.outcome === 2) {
      extra = [100, 120]
        .map(
          (dx) =>
            `<rect x="${lanes.x + dx}" y="${y + 9}" width="12" height="12" rx="3" fill="${c.pad}"/>`,
        )
        .join("");
    }
    add(
      `<g class="${name}"${base(i)}><rect x="${lanes.x}" y="${y}" width="${lanes.w}" height="${lanes.h}" fill="${lane}"/>${extra}</g>`,
    );
  });
  add(
    `<rect x="${lanes.x}" y="${laneY(2)}" width="${lanes.w}" height="${lanes.h}" fill="${c.grass}"/>`,
  );
  add(
    `<rect x="${lanes.x}" y="${laneY(3)}" width="${lanes.w}" height="${lanes.h}" fill="${c.grass}"/>`,
  );
  // The chicken hops forward (scene 1), stays (scene 2) or goes right three times and then forward (scene 3).
  const hop = lanes.h + lanes.gap;
  const keys = [[0, "translate(0px,0px)"]];
  SCENES.forEach((s, i) => {
    const o = i * SCENE;
    const at = (t, x, y) => keys.push([o + t, `translate(${x}px,${y}px)`]);
    if (s.outcome === 0) {
      at(3.6, 0, 0);
      at(3.8, 0, -hop);
      at(SCENE - 0.02, 0, -hop);
    }
    if (s.outcome === 2) {
      at(3.6, 0, 0);
      at(3.75, 16, 0);
      at(3.95, 32, 0);
      at(4.15, 48, 0);
      at(4.35, 48, -hop);
      if (i < LAST) at(SCENE - 0.02, 48, -hop);
    }
    if (i < LAST) at(SCENE, 0, 0);
  });
  const henX = GAME.x + GAME.w / 2 - 20;
  SCENES.forEach((_, i) => {
    const name = sheet.add(shown(i, 0.7));
    add(
      `<rect class="target ${name}" x="${henX - 2}" y="${laneY(1) + 6}" width="18" height="18" rx="4"${base(i)}/>`,
    );
  });
  const hen = sheet.add(["transform", "linear", keys]);
  add(
    `<rect class="${hen}" x="${henX}" y="${laneY(2) + 8}" width="14" height="14" rx="3" fill="${c.hen}" stroke="${c.ink}" stroke-width="1.25"/>`,
  );
  add(
    `<rect class="${hen}" x="${henX + 4}" y="${laneY(2) + 5}" width="6" height="4" rx="1" fill="${c.accent}"/>`,
  );
  add("</g>");

  // In words: the fields the questions read, one after another.
  add(
    `<rect class="node" x="${WORDS.x}" y="${CARD.y}" width="${WORDS.w}" height="${CARD.h}" rx="12"/>`,
  );
  add(`<text class="title" x="${WORDS.x + 16}" y="${CARD.y + 26}">In words</text>`);
  add(`<text class="mono soft" x="${WORDS.x + 16}" y="${CARD.y + 44}">what Clef reads</text>`);
  SCENES.forEach((s, i) => {
    s.words.forEach((word, j) => {
      const name = sheet.add(shown(i, 0.7 + 0.25 * j));
      const y = CARD.y + 60 + j * 32;
      add(
        `<g class="${name}"${base(i)}><rect class="chip" x="${WORDS.x + 12}" y="${y}" width="${WORDS.w - 24}" height="24" rx="6"/>` +
          `<text class="mono" x="${WORDS.x + 22}" y="${y + 16}">${esc(word)}</text></g>`,
      );
    });
  });

  // Clef-flash: one call, four one-word questions, each answer with its probability.
  add(
    `<rect class="clef" x="${CLEF.x}" y="${CARD.y}" width="${CLEF.w}" height="${CARD.h}" rx="12"/>`,
  );
  add(`<text class="title accent" x="${CLEF.x + 16}" y="${CARD.y + 26}">Clef-flash</text>`);
  add(`<text class="mono soft" x="${CLEF.x + 16}" y="${CARD.y + 44}">1 call · 4 questions</text>`);
  const rowY = (r) => CARD.y + 70 + r * 28;
  const barW = CLEF.w - 32;
  QUESTIONS.forEach((q, r) => {
    add(`<text class="label" x="${CLEF.x + 16}" y="${rowY(r)}">${q}</text>`);
    add(
      `<rect x="${CLEF.x + 16}" y="${rowY(r) + 7}" width="${barW}" height="3" rx="1.5" fill="${c.track}"/>`,
    );
  });
  SCENES.forEach((s, i) => {
    s.answers.forEach((answer, r) => {
      const start = 1.9 + 0.3 * r;
      const name = sheet.add(shown(i, start));
      const right = CLEF.x + CLEF.w - 16;
      if (!answer) {
        add(
          `<text class="mono soft ${name}" x="${right}" y="${rowY(r)}" text-anchor="end"${base(i)}>not needed</text>`,
        );
        return;
      }
      const [word, p] = answer;
      const t0 = i * SCENE + start;
      const grow = sheet.add([
        "transform",
        "linear",
        [
          [0, "scaleX(0)"],
          [t0, "scaleX(0)"],
          [t0 + 0.45, "scaleX(1)"],
        ],
      ]);
      add(
        `<g class="${name}"${base(i)}><text class="mono" x="${right}" y="${rowY(r)}" text-anchor="end">${word} ${Math.round(p * 100)}%</text>` +
          `<rect class="bar ${grow}" x="${CLEF.x + 16}" y="${rowY(r) + 7}" width="${Math.round(barW * p)}" height="3" rx="1.5"/></g>`,
      );
    });
  });

  // Outcomes: the three things an answer can do. The one each decision took lights up.
  OUTCOMES.forEach(([title, sub], k) => {
    const y = PILL_Y[k] - PILL.h / 2;
    const cx = PILL.x + PILL.w / 2;
    add(`<rect class="node" x="${PILL.x}" y="${y}" width="${PILL.w}" height="${PILL.h}" rx="12"/>`);
    add(`<text class="title small" x="${cx}" y="${y + 19}" text-anchor="middle">${title}</text>`);
    add(`<text class="mono soft" x="${cx}" y="${y + 34}" text-anchor="middle">${sub}</text>`);
  });
  SCENES.forEach((s, i) => {
    const k = s.outcome;
    const y = PILL_Y[k] - PILL.h / 2;
    const name = sheet.add(shown(i, 3.4));
    add(
      `<g class="${name}"${base(i)}><rect class="clef" x="${PILL.x}" y="${y}" width="${PILL.w}" height="${PILL.h}" rx="12"/>` +
        `<text class="title small accent" x="${PILL.x + PILL.w / 2}" y="${y + 19}" text-anchor="middle">${OUTCOMES[k][0]}</text>` +
        `<text class="mono soft" x="${PILL.x + PILL.w / 2}" y="${y + 34}" text-anchor="middle">${OUTCOMES[k][1]}</text></g>`,
    );
    pulse(toWords, i, 0.2, 0.6);
    pulse(toClef, i, 1.3, 1.7);
    pulse(fork[k], i, 3.0, 3.4);
    pulse(back[k], i, 4.4, 5.3);
  });

  // Header: which decision is playing, and where it sits in the loop.
  SCENES.forEach((s, i) => {
    const name = sheet.add(shown(i, 0));
    add(
      `<text class="mono soft ${name}" x="16" y="32"${base(i)}>seed 624140 · decision ${s.decision} · row ${s.row}</text>`,
    );
    const dot = sheet.add(shown(i, 0));
    add(`<circle cx="${W - 56 + i * 16}" cy="28" r="4" fill="${c.rule}"/>`);
    add(
      `<circle class="${dot}" cx="${W - 56 + i * 16}" cy="28" r="4" fill="${c.accent}"${base(i)}/>`,
    );
  });

  const css = [
    `.paper{fill:${c.paper}}.node{fill:${c.node};stroke:${c.rule};stroke-width:1}`,
    `.clef{fill:${c.tint};stroke:${c.accent};stroke-width:1.25}.chip{fill:${c.track}}.target{fill:none;stroke:${c.ink};stroke-width:1.25;stroke-dasharray:3 3}`,
    `.wire{fill:none;stroke:${c.rule};stroke-width:1.5}.pulse{fill:none;stroke:${c.accent};stroke-width:2.5;stroke-linecap:round}`,
    `text{font-family:${SANS}}.title{font-size:15px;font-weight:600;fill:${c.ink}}.title.small{font-size:13.5px}`,
    `.label{font-size:12px;fill:${c.ink}}.mono{font-family:${MONO};font-size:11px;fill:${c.ink}}.soft{fill:${c.soft}}`,
    `.accent{fill:${c.accent}}.bar{fill:${c.accent};transform-box:fill-box;transform-origin:left center}`,
    `.car{animation:cfcar 4s linear infinite}@keyframes cfcar{from{transform:translateX(150px)}to{transform:translateX(-40px)}}`,
    `.log{animation:cflog 3s linear infinite}@keyframes cflog{from{transform:translateX(-44px)}to{transform:translateX(150px)}}`,
    ...sheet.rules,
    "@media (prefers-reduced-motion:reduce){*{animation:none!important}}",
  ].join("");

  const desc =
    "Three real decisions of Clef-flash on seed 624140, in a loop. The game is turned into words, Clef-flash answers " +
    "four one-word questions in one call, and the answer picks what happens. Decision 6: it can land ahead, so the " +
    "chicken hops now. Decision 7: the row ahead moves, so it waits and asks again. Decision 24: the way is closed and " +
    "Clef picks the right side, so code walks the detour. Then the next step starts.";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="cf-title cf-desc">` +
    `<title id="cf-title">How Clef plays: three real decisions</title><desc id="cf-desc">${desc}</desc>` +
    `<defs><marker id="cf-head" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="${c.rule}"/></marker></defs>` +
    `<style>${css}</style><rect class="paper" width="${W}" height="${H}" rx="14"/>\n${body.join("\n")}\n</svg>\n`
  );
}

const check = process.argv.includes("--check");
let stale = false;
for (const theme of Object.keys(THEMES)) {
  const file = join(out, `clef-flow-${theme}.svg`);
  const svg = build(theme);
  if (!check) {
    writeFileSync(file, svg);
    console.log(`wrote ${file} (${(Buffer.byteLength(svg) / 1024).toFixed(1)} KB)`);
    continue;
  }
  if (!existsSync(file) || readFileSync(file, "utf8") !== svg) {
    console.error(
      `${file} is not what scripts/gen-flow-figure.mjs writes; run it and commit the result.`,
    );
    stale = true;
  }
}
if (stale) process.exit(1);
