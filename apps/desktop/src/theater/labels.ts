import type { EdgeIn } from "@ccr/agent";
import { ACTIONS, type Action } from "@ccr/core";
import { ACTION_GLYPH, ACTION_ORDER } from "../format.ts";
import { type Translator, translator } from "../i18n/translate.ts";

export interface OptionLabel {
  glyph: string;
  label: string;
  short: string;
}

export interface QuestionLabel {
  title: string;
  options: Readonly<Record<string, OptionLabel>>;
}

const ROUTE_OPTIONS = {
  cell: ["stand", "no_stand"],
  moving: ["moving", "still"],
  around: ["detour_left", "detour_right", "wait_here"],
  ride: ["leaving", "staying"],
} as const;

const OPTION_GLYPH = {
  stand: "✓",
  no_stand: "✗",
  moving: "↔",
  still: "▪",
  detour_left: "←",
  detour_right: "→",
  wait_here: "•",
  leaving: "!",
  staying: "✓",
} as const;

const MANEUVER_GLYPH = {
  cross_ahead: "↑",
  detour_left: "←",
  detour_right: "→",
  sidestep_left: "←",
  sidestep_right: "→",
  back_off: "↓",
  wait_here: "•",
  leave_platform: "↓",
} as const;

export const ALWAYS_ASKED = ["cell", "moving", "around"] as const;
const named = (glyph: string, label: string): OptionLabel => ({ glyph, label, short: label });
const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
export const spoken = (word: string): string => word.replaceAll("_", " ");

export function titleOf(questionId: string, { t }: Translator = translator("en")): string {
  return Object.hasOwn(ROUTE_OPTIONS, questionId)
    ? t(`route.question.${questionId as keyof typeof ROUTE_OPTIONS}`)
    : capitalized(spoken(questionId));
}

export function optionLabel(
  questionId: string,
  optionId: string,
  { t }: Translator = translator("en"),
): OptionLabel {
  const options: readonly string[] = Object.hasOwn(ROUTE_OPTIONS, questionId)
    ? ROUTE_OPTIONS[questionId as keyof typeof ROUTE_OPTIONS]
    : [];
  if (options.includes(optionId)) {
    const id = optionId as keyof typeof OPTION_GLYPH;
    return {
      glyph: OPTION_GLYPH[id],
      label: t(`route.${id}.label`),
      short: t(`route.${id}.short`),
    };
  }
  if ((ACTIONS as readonly string[]).includes(optionId)) {
    const action = optionId as Action;
    return named(ACTION_GLYPH[action], capitalized(t(`actions.${action}`)));
  }
  if (Object.hasOwn(MANEUVER_GLYPH, optionId)) {
    const id = optionId as keyof typeof MANEUVER_GLYPH;
    return named(MANEUVER_GLYPH[id], t(`theater.move.${id}`));
  }
  return named("", capitalized(spoken(optionId)));
}

export const ROUTE_LABELS: Readonly<Record<string, QuestionLabel>> = Object.fromEntries(
  Object.entries(ROUTE_OPTIONS).map(([id, options]) => [
    id,
    {
      title: titleOf(id),
      options: Object.fromEntries(options.map((option) => [option, optionLabel(id, option)])),
    },
  ]),
);
export const MANEUVER_LABELS: Readonly<Record<string, OptionLabel>> = Object.fromEntries(
  Object.keys(MANEUVER_GLYPH).map((id) => [id, optionLabel("", id)]),
);

export function decisionLabel(
  maneuverId: string | undefined,
  action: Action,
  translation: Translator = translator("en"),
): OptionLabel {
  if (maneuverId === "leave_platform") {
    return {
      glyph: ACTION_GLYPH[action],
      label: translation.t("theater.move.leave_platform"),
      short: translation.t("route.getOff"),
    };
  }
  return optionLabel(
    "",
    maneuverId && Object.hasOwn(MANEUVER_GLYPH, maneuverId) ? maneuverId : action,
    translation,
  );
}

export function orderOptions(questionId: string, ids: readonly string[]): string[] {
  const options: readonly string[] = Object.hasOwn(ROUTE_OPTIONS, questionId)
    ? ROUTE_OPTIONS[questionId as keyof typeof ROUTE_OPTIONS]
    : ACTION_ORDER;
  const rank = (id: string) => options.indexOf(id);
  return ids.every((id) => rank(id) >= 0) ? [...ids].sort((a, b) => rank(a) - rank(b)) : [...ids];
}

export function readPath(state: unknown, path: string): string | undefined {
  let at: unknown = state;
  for (const key of path.split(".")) {
    if (at === null || typeof at !== "object" || !Object.hasOwn(at, key)) return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return typeof at === "string" || typeof at === "number" || typeof at === "boolean"
    ? String(at)
    : undefined;
}

const CELL_SCENE = {
  empty: { tile: "grass", moves: false },
  tree: { tile: "tree", moves: false },
  water: { tile: "water", moves: true },
  log: { tile: "log", moves: true },
  lily_pad: { tile: "lily", moves: true },
  vehicle: { tile: "car", moves: true },
  train: { tile: "train", moves: true },
  train_coming: { tile: "train", moves: false },
  outside_world: { tile: "edge", moves: false },
  unseen: { tile: "edge", moves: false },
} as const;

export interface PlatformView {
  phrase: string;
  urgency: "now" | "soon" | "later" | "none";
}
export interface SceneView {
  tile: string;
  phrase: string;
  gaps: string[];
  platform: PlatformView | null;
}

const PLATFORM_URGENCY: Readonly<Record<EdgeIn, PlatformView["urgency"]>> = {
  a_moment: "now",
  soon: "soon",
  later: "later",
  not_carried: "none",
};

function platformOf(state: unknown, { t }: Translator): PlatformView | null {
  const word = readPath(state, "chicken.edge_in");
  if (!word || !Object.hasOwn(PLATFORM_URGENCY, word)) return null;
  const clock = t(`scene.clock.${word as EdgeIn}`);
  const side = readPath(state, "chicken.carried_towards");
  return {
    phrase:
      side === "left" || side === "right"
        ? t("scene.carried", { side: t(`side.${side}`), clock })
        : t("scene.platform", { clock }),
    urgency: PLATFORM_URGENCY[word as EdgeIn],
  };
}

export function sceneOf(
  state: unknown,
  translation: Translator = translator("en"),
): SceneView | null {
  const { t } = translation;
  const lands = readPath(state, "cross_ahead.lands_on");
  if (lands === undefined) return null;
  const known = Object.hasOwn(CELL_SCENE, lands) ? (lands as keyof typeof CELL_SCENE) : null;
  const cell = known ? CELL_SCENE[known] : { tile: "edge", moves: false };
  const cellName = known ? t(`scene.${known}`) : spoken(lands);
  const move = readPath(state, "cross_ahead.things_move");
  const side = move === "left" || move === "right" ? t(`side.${move}`) : "";
  const phrase = cell.moves
    ? t(side ? "scene.moving" : "scene.still", { cell: cellName, side })
    : side
      ? t("scene.thingsMoving", { cell: cellName, side })
      : cellName;
  const gaps = (["left", "right"] as const).flatMap((side) => {
    const opening = readPath(state, `detour_${side}.opening_ahead`);
    if (opening === undefined) return [];
    return [
      t("scene.gap", {
        side: t(`side.${side}`),
        opening:
          opening === "adjacent" ||
          opening === "two_away" ||
          opening === "three_or_more" ||
          opening === "none"
            ? t(`scene.opening.${opening}`)
            : spoken(opening),
      }),
    ];
  });
  return { tile: cell.tile, phrase, gaps, platform: platformOf(state, translation) };
}
