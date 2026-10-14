import {
  Box3,
  type Group,
  type Material,
  type Mesh,
  MeshLambertMaterial,
  NearestFilter,
  type Object3D,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
} from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

/** One loaded model: geometry shared by every clone, material shared per texture. */
export interface ModelTemplate {
  readonly object: Group;
  /** Height of the bounding box, used to scale the hero. */
  readonly size: { x: number; y: number; z: number };
}

export interface Assets {
  floors: {
    grass: Group;
    road: Group; // lane stripes variant
    roadBlank: Group; // first lane of a road
    river: Group;
    railroad: Group;
  };
  cars: Group[]; // Node/Car.ts order
  logs: Group[];
  lilyPad: Group;
  trees: Group[];
  boulders: Group[];
  train: { front: Group; middle: Group; back: Group };
  trainLight: { inactive: Group; active: [Group, Group] };
  chicken: ModelTemplate;
}

const CAR_NAMES = [
  "police_car",
  "blue_car",
  "blue_truck",
  "green_car",
  "orange_car",
  "purple_car",
  "red_truck",
  "taxi",
] as const;

interface Spec {
  model: string;
  texture: string;
  castShadow: boolean;
  receiveShadow: boolean;
}

const materials = new Map<string, MeshLambertMaterial>();

/**
 * Loads every model Expo-Crossy-Road uses. `base` is the URL of the folder that contains
 * `models/` (fetched locally by `node scripts/fetch-assets.mjs`).
 */
export async function loadAssets(base: string): Promise<Assets> {
  const objLoader = new OBJLoader();
  const textureLoader = new TextureLoader();
  const url = (path: string) => `${base.replace(/\/$/, "")}/${path}`;

  async function material(texturePath: string): Promise<Material> {
    const cached = materials.get(texturePath);
    if (cached) return cached;
    const texture = await textureLoader.loadAsync(url(texturePath));
    texture.magFilter = NearestFilter; // crisp voxel pixels
    texture.minFilter = NearestFilter;
    texture.colorSpace = SRGBColorSpace;
    const created = new MeshLambertMaterial({ map: texture });
    materials.set(texturePath, created);
    return created;
  }

  async function load(spec: Spec): Promise<Group> {
    const [text, mat] = await Promise.all([
      fetch(url(spec.model)).then((r) => {
        if (!r.ok)
          throw new Error(
            `Missing model ${spec.model} (${r.status}). Run: node scripts/fetch-assets.mjs`,
          );
        return r.text();
      }),
      material(spec.texture),
    ]);
    const group = objLoader.parse(text);
    group.traverse((child: Object3D) => {
      if ((child as Mesh).isMesh) {
        const mesh = child as Mesh;
        mesh.material = mat;
        mesh.castShadow = spec.castShadow;
        mesh.receiveShadow = spec.receiveShadow;
      }
    });
    return group;
  }

  const env = (name: string, texture = "0.png", model = "0.obj", cast = true, receive = false) =>
    load({
      model: `models/environment/${name}/${model}`,
      texture: `models/environment/${name}/${texture}`,
      castShadow: cast,
      receiveShadow: receive,
    });
  const vehicle = (name: string) =>
    load({
      model: `models/vehicles/${name}/0.obj`,
      texture: `models/vehicles/${name}/0.png`,
      castShadow: true,
      receiveShadow: true,
    });

  const [
    grass,
    road,
    roadBlank,
    river,
    railroad,
    cars,
    logs,
    lilyPad,
    trees,
    boulders,
    trainParts,
    lightInactive,
    lightA,
    lightB,
    chicken,
  ] = await Promise.all([
    load({
      model: "models/environment/grass/model.obj",
      texture: "models/environment/grass/light-grass.png",
      castShadow: false,
      receiveShadow: true,
    }),
    load({
      model: "models/environment/road/model.obj",
      texture: "models/environment/road/stripes-texture.png",
      castShadow: false,
      receiveShadow: true,
    }),
    load({
      model: "models/environment/road/model.obj",
      texture: "models/environment/road/blank-texture.png",
      castShadow: false,
      receiveShadow: true,
    }),
    env("river", "0.png", "0.obj", false, true),
    env("railroad", "0.png", "0.obj", false, true),
    Promise.all(CAR_NAMES.map(vehicle)),
    Promise.all([0, 1, 2, 3].map((i) => env(`log/${i}`, "0.png", "0.obj", true, true))),
    env("lily_pad", "0.png", "0.obj", true, true),
    Promise.all([0, 1, 2, 3].map((i) => env(`tree/${i}`))),
    Promise.all([0, 1].map((i) => env(`boulder/${i}`))),
    Promise.all(["front", "middle", "back"].map((part) => vehicle(`train/${part}`))),
    env("train_light/inactive", "0.png", "0.obj", false, false),
    env("train_light/active/0", "0.png", "0.obj", false, false),
    env("train_light/active/1", "0.png", "0.obj", false, false),
    load({
      model: "models/characters/chicken/0.obj",
      texture: "models/characters/chicken/0.png",
      castShadow: true,
      receiveShadow: true,
    }),
  ]);

  const [front, middle, back] = trainParts as [Group, Group, Group];
  return {
    floors: { grass, road, roadBlank, river, railroad },
    cars,
    logs,
    lilyPad,
    trees,
    boulders,
    train: { front, middle, back },
    trainLight: { inactive: lightInactive, active: [lightA, lightB] },
    chicken: { object: chicken, size: sizeOf(chicken) },
  };
}

function sizeOf(object: Group): { x: number; y: number; z: number } {
  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  return { x: size.x, y: size.y, z: size.z };
}
