import { createRng, DOMAIN_COSMETIC, type RowSnapshot } from "@ccr/core";
import { Group, type Object3D } from "three";
import type { Assets } from "./assets.ts";
import { ENTITY_Y, trainLightPhase } from "./layout.ts";

type RowOf<K extends RowSnapshot["kind"]> = Extract<RowSnapshot, { kind: K }>;

/** The scene objects of one row. `movers` follow the order of the snapshot's movers. */
export interface RowView {
  z: number;
  kind: RowSnapshot["kind"];
  group: Group;
  movers: Object3D[];
  lights?: { inactive: Object3D; a: Object3D; b: Object3D };
}

/** Each train segment is spaced by round(width) = 5, as in upstream's Node/Train.ts. */
const TRAIN_SEGMENT = 5;
/** Number of middle carriages when the snapshot does not say. */
const DEFAULT_TRAIN_MIDDLES = 2;
/** Upstream: 40% boulders, otherwise one of four trees. */
const BOULDER_SHARE = 0.4;

function addGrass(view: RowView, assets: Assets, row: RowOf<"grass">, seed: number): void {
  view.group.add(assets.floors.grass.clone());
  const rng = createRng(seed, row.z, DOMAIN_COSMETIC);
  for (const x of row.blocked) {
    const pool = rng.next() < BOULDER_SHARE ? assets.boulders : assets.trees;
    const source = pool[rng.int(pool.length)];
    if (!source) continue;
    const tree = source.clone();
    tree.position.set(x, ENTITY_Y.tree, 0);
    view.group.add(tree);
  }
}

function addRoad(
  view: RowView,
  assets: Assets,
  row: RowOf<"road">,
  previousKind: RowSnapshot["kind"] | undefined,
): void {
  const first = previousKind !== "road";
  view.group.add((first ? assets.floors.roadBlank : assets.floors.road).clone());
  for (const m of row.movers) {
    const car = assets.cars[m.variant % assets.cars.length]?.clone();
    if (!car) continue;
    car.rotation.y = (Math.PI / 2) * Math.sign(m.speed || 1);
    car.position.set(m.x, ENTITY_Y.car, 0);
    view.group.add(car);
    view.movers.push(car);
  }
}

function addWater(view: RowView, assets: Assets, row: RowOf<"water">): void {
  view.group.add(assets.floors.river.clone());
  for (const m of row.movers) {
    const isLog = m.kind === "log";
    const item = isLog
      ? assets.logs[m.variant % assets.logs.length]?.clone()
      : assets.lilyPad.clone();
    if (!item) continue;
    item.position.set(m.x, isLog ? ENTITY_Y.log : ENTITY_Y.lilyPad, 0);
    if (!isLog) item.rotation.y = 0.5 + ((m.x * 7 + row.z) % 10) / 10;
    view.group.add(item);
    view.movers.push(item);
  }
}

function addRail(view: RowView, assets: Assets, row: RowOf<"rail">): void {
  view.group.add(assets.floors.railroad.clone());
  const inactive = assets.trainLight.inactive.clone();
  const lightA = assets.trainLight.active[0].clone();
  const lightB = assets.trainLight.active[1].clone();
  for (const light of [inactive, lightA, lightB]) {
    light.position.z = -0.5;
    light.rotation.y = Math.PI;
    view.group.add(light);
  }
  view.lights = { inactive, a: lightA, b: lightB };

  const train = new Group();
  const first = row.movers[0];
  train.add(assets.train.front.clone());
  let offset = TRAIN_SEGMENT;
  for (let i = 0; i < (first?.variant ?? DEFAULT_TRAIN_MIDDLES); i++) {
    const middle = assets.train.middle.clone();
    middle.position.x = offset;
    train.add(middle);
    offset += TRAIN_SEGMENT;
  }
  const back = assets.train.back.clone();
  back.position.x = offset;
  train.add(back);
  train.position.set(first?.x ?? 0, ENTITY_Y.train, 0.1);
  view.group.add(train);
  view.movers.push(train);
}

/** `previousKind` is the kind of the row below: a road row after another road row has no kerb. */
export function buildRowView(
  assets: Assets,
  row: RowSnapshot,
  seed: number,
  previousKind: RowSnapshot["kind"] | undefined,
): RowView {
  const group = new Group();
  group.position.z = row.z;
  const view: RowView = { z: row.z, kind: row.kind, group, movers: [] };
  switch (row.kind) {
    case "grass":
      addGrass(view, assets, row, seed);
      break;
    case "road":
      addRoad(view, assets, row, previousKind);
      break;
    case "water":
      addWater(view, assets, row);
      break;
    case "rail":
      addRail(view, assets, row);
      break;
  }
  return view;
}

/** Moves the row's objects to their position for this tick, interpolated by `alpha` towards the next. */
export function updateRowView(view: RowView, row: RowSnapshot, tick: number, alpha: number): void {
  if (row.kind === "grass") return;
  row.movers.forEach((m, i) => {
    const object = view.movers[i];
    // Between ticks a mover advances by exactly its speed; a wrap shows as a one-frame jump
    // far outside the playable area.
    if (object) object.position.x = m.x + m.speed * alpha;
  });
  if (row.kind === "rail" && view.lights) {
    const { inactive, a, b } = view.lights;
    inactive.visible = !row.lightOn;
    const phase = trainLightPhase(tick);
    a.visible = row.lightOn && phase === 0;
    b.visible = row.lightOn && phase === 1;
  }
}
