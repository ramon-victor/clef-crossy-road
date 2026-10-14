import {
  createRng,
  type DeathCause,
  DOMAIN_COSMETIC,
  HOP_TICKS,
  type MoverSnapshot,
  type RowSnapshot,
  type Snapshot,
} from "@ccr/core";
import {
  AmbientLight,
  DirectionalLight,
  Group,
  type Object3D,
  OrthographicCamera,
  PCFShadowMap,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { type Assets, loadAssets } from "./assets.ts";
import {
  cameraTargetX,
  DROWNED_Y,
  ENTITY_Y,
  facingFor,
  followFactor,
  heroY,
  hopStretch,
  PLATFORM_TOP,
  ROW_TOP,
  shortestAngle,
  trainLightPhase,
} from "./layout.ts";

export interface GameViewOptions {
  canvas: HTMLCanvasElement;
  /** URL folder that contains `models/` (default "/assets"). */
  assetBase?: string;
  shadows?: boolean;
  /** Visible width in tiles (default 11.5: the playable 9 columns plus the walls). */
  viewWidthTiles?: number;
  /** How many rows below the screen centre the hero stands (default 1.6). */
  heroRowsBelowCentre?: number;
}

interface MoverView {
  object: Object3D;
  speed: number;
  baseX: number;
}

interface RowView {
  z: number;
  kind: RowSnapshot["kind"];
  group: Group;
  movers: MoverView[];
  lights?: { inactive: Object3D; a: Object3D; b: Object3D };
}

export interface ViewStats {
  rows: number;
  drawCalls: number;
  triangles: number;
}

const SKY = 0x87c6ff;

/**
 * Draws a `Snapshot` of the core. It never mutates the game and keeps no game state of its own
 * beyond presentation (camera easing, hop facing, row views), so a replay renders identically.
 */
export class GameView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: OrthographicCamera;
  private readonly world = new Group();
  private readonly hero = new Group();
  private readonly heroBody: Group;
  private readonly rows = new Map<number, RowView>();
  private readonly assets: Assets;
  private readonly heroScale: number;
  private readonly viewWidth: number;
  private readonly heroBelow: number;
  private readonly canvas: HTMLCanvasElement;

  private focusX = 0;
  private focusZ = 8;
  private facing = 0;
  private heroBaseY = ROW_TOP.grass;
  private lastSeed = -1;
  private lastDeath: DeathCause | null = null;
  private deathAnim = 0;
  private width = 1;
  private height = 1;
  private readonly tmp = new Vector3();

  private constructor(options: GameViewOptions, assets: Assets) {
    this.canvas = options.canvas;
    this.assets = assets;
    this.viewWidth = options.viewWidthTiles ?? 11.5;
    this.heroBelow = options.heroRowsBelowCentre ?? 1.6;

    this.renderer = new WebGLRenderer({ canvas: options.canvas, antialias: true });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(SKY);
    this.renderer.shadowMap.enabled = options.shadows ?? true;
    this.renderer.shadowMap.type = PCFShadowMap;

    // Same camera as upstream: orthographic, looking back at the world from behind and above.
    this.camera = new OrthographicCamera(-1, 1, 1, -1, -30, 30);
    this.camera.position.set(-1, 2.8, -2.9);
    this.camera.lookAt(0, 0, 0);

    this.world.add(new AmbientLight(0xffffff, 1.8));
    this.scene.add(this.world);

    const sun = new DirectionalLight(0xffffff, 1.0);
    sun.position.set(20, 30, 0.05);
    sun.castShadow = options.shadows ?? true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -15;
    sun.shadow.camera.right = 9;
    sun.shadow.camera.top = 6;
    sun.shadow.camera.bottom = -6;
    sun.shadow.camera.far = 100;
    sun.shadow.bias = 0.0001;
    this.scene.add(sun);

    // Hero: the chicken scaled so its longest side is 1 (as upstream), origin at its feet.
    const { object, size } = assets.chicken;
    this.heroScale = 1 / Math.max(size.x, size.y, size.z);
    this.heroBody = object.clone();
    this.heroBody.scale.setScalar(this.heroScale);
    this.hero.add(this.heroBody);
    this.world.add(this.hero);
  }

  static async create(options: GameViewOptions): Promise<GameView> {
    const assets = await loadAssets(options.assetBase ?? "/assets");
    return new GameView(options, assets);
  }

  resize(width: number, height: number, pixelRatio = 1): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    const halfW = this.viewWidth / 2;
    const halfH = halfW * (this.height / this.width);
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  /**
   * @param alpha how far we are between the previous and the next simulation tick, in [0, 1)
   * @param dt    seconds since the last call (drives the camera easing)
   */
  update(snap: Snapshot, alpha: number, dt: number): void {
    if (snap.seed !== this.lastSeed) this.resetFor(snap);

    this.syncRows(snap, alpha);
    this.updateHero(snap, alpha);
    this.updateCamera(snap, dt);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** CSS-pixel position of the hero relative to the canvas, for overlays such as the thought bubble. */
  heroScreenPosition(): { x: number; y: number } | null {
    this.hero.updateWorldMatrix(true, false);
    this.tmp.setFromMatrixPosition(this.hero.matrixWorld);
    this.tmp.y += 1.1; // above the head
    this.tmp.project(this.camera);
    if (!Number.isFinite(this.tmp.x) || !Number.isFinite(this.tmp.y)) return null;
    return {
      x: ((this.tmp.x + 1) / 2) * this.width,
      y: ((1 - this.tmp.y) / 2) * this.height,
    };
  }

  /** Renders now and returns the canvas as a PNG data URL scaled to the requested size. */
  captureDataUrl(width: number, height: number): string {
    this.render();
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("2D canvas is unavailable");
    ctx.drawImage(this.canvas, 0, 0, width, height);
    return out.toDataURL("image/png");
  }

  stats(): ViewStats {
    const info = this.renderer.info.render;
    return { rows: this.rows.size, drawCalls: info.calls, triangles: info.triangles };
  }

  dispose(): void {
    this.renderer.dispose();
  }

  // ------------------------------------------------------------------------------------------

  private resetFor(snap: Snapshot): void {
    for (const view of this.rows.values()) this.world.remove(view.group);
    this.rows.clear();
    this.lastSeed = snap.seed;
    this.focusX = cameraTargetX(snap.hero.x);
    this.focusZ = snap.hero.z;
    this.facing = 0;
    this.deathAnim = 0;
    this.lastDeath = null;
    this.hero.scale.set(1, 1, 1);
  }

  private syncRows(snap: Snapshot, alpha: number): void {
    const wanted = new Set<number>();
    for (const row of snap.rows) {
      wanted.add(row.z);
      let view = this.rows.get(row.z);
      if (!view) {
        view = this.buildRow(row, snap.seed);
        this.rows.set(row.z, view);
        this.world.add(view.group);
      }
      this.updateRow(view, row, snap.tick, alpha);
    }
    for (const [z, view] of this.rows) {
      if (!wanted.has(z)) {
        this.world.remove(view.group);
        this.rows.delete(z);
      }
    }
  }

  private buildRow(row: RowSnapshot, seed: number): RowView {
    const group = new Group();
    group.position.z = row.z;
    const view: RowView = { z: row.z, kind: row.kind, group, movers: [] };
    const a = this.assets;

    switch (row.kind) {
      case "grass": {
        group.add(a.floors.grass.clone());
        const rng = createRng(seed, row.z, DOMAIN_COSMETIC);
        for (const x of row.blocked) {
          // Upstream: 40% boulders, otherwise one of four trees.
          const boulder = rng.next() < 0.4;
          const source = boulder
            ? a.boulders[rng.int(a.boulders.length)]
            : a.trees[rng.int(a.trees.length)];
          if (!source) continue;
          const tree = source.clone();
          tree.position.set(x, ENTITY_Y.tree, 0);
          group.add(tree);
        }
        break;
      }
      case "road": {
        const previous = this.rows.get(row.z - 1);
        const first = previous?.kind !== "road";
        group.add((first ? a.floors.roadBlank : a.floors.road).clone());
        for (const m of row.movers) {
          const car = a.cars[m.variant % a.cars.length]?.clone();
          if (!car) continue;
          car.rotation.y = (Math.PI / 2) * Math.sign(m.speed || 1);
          car.position.set(m.x, ENTITY_Y.car, 0);
          group.add(car);
          view.movers.push({ object: car, speed: m.speed, baseX: m.x });
        }
        break;
      }
      case "water": {
        group.add(a.floors.river.clone());
        for (const m of row.movers) {
          const item =
            m.kind === "log" ? a.logs[m.variant % a.logs.length]?.clone() : a.lilyPad.clone();
          if (!item) continue;
          item.position.set(m.x, m.kind === "log" ? ENTITY_Y.log : ENTITY_Y.lilyPad, 0);
          if (m.kind === "lily_pad") item.rotation.y = 0.5 + ((m.x * 7 + row.z) % 10) / 10;
          group.add(item);
          view.movers.push({ object: item, speed: m.speed, baseX: m.x });
        }
        break;
      }
      case "rail": {
        const floor = a.floors.railroad.clone();
        group.add(floor);
        const inactive = a.trainLight.inactive.clone();
        const lightA = a.trainLight.active[0].clone();
        const lightB = a.trainLight.active[1].clone();
        for (const light of [inactive, lightA, lightB]) {
          light.position.z = -0.5;
          light.rotation.y = Math.PI;
          group.add(light);
        }
        view.lights = { inactive, a: lightA, b: lightB };

        const train = new Group();
        const middles = row.movers[0]?.variant ?? 2;
        train.add(a.train.front.clone());
        let offset = 5; // each segment is spaced by round(width) = 5, as Node/Train.ts
        for (let i = 0; i < middles; i++) {
          const mid = a.train.middle.clone();
          mid.position.x = offset;
          train.add(mid);
          offset += 5;
        }
        const back = a.train.back.clone();
        back.position.x = offset;
        train.add(back);
        train.position.set(row.movers[0]?.x ?? 0, ENTITY_Y.train, 0.1);
        group.add(train);
        view.movers.push({ object: train, speed: row.movers[0]?.speed ?? 0, baseX: 0 });
        break;
      }
    }
    return view;
  }

  private updateRow(view: RowView, row: RowSnapshot, tick: number, alpha: number): void {
    if (row.kind === "grass") return;
    const movers: readonly MoverSnapshot[] = row.movers;
    for (let i = 0; i < view.movers.length; i++) {
      const mv = view.movers[i];
      const m = movers[i];
      if (!mv || !m) continue;
      // Between ticks a mover advances by exactly its speed; a wrap shows as a one-frame jump
      // far outside the playable area.
      mv.object.position.x = m.x + m.speed * alpha;
    }
    if (row.kind === "rail" && view.lights) {
      const { inactive, a, b } = view.lights;
      inactive.visible = !row.lightOn;
      const phase = trainLightPhase(tick);
      a.visible = row.lightOn && phase === 0;
      b.visible = row.lightOn && phase === 1;
    }
  }

  private updateHero(snap: Snapshot, alpha: number): void {
    const h = snap.hero;
    const moving = h.moving;
    // Interpolate along the current tick's motion (one tick is the unit of the simulation).
    const x = h.x;
    const z = h.z;

    let hopProgress: number | null = null;
    if (moving) {
      hopProgress = Math.min(1, (h.hopTick + alpha) / HOP_TICKS);
      this.facing = facingFor(h.targetX - h.fromX, h.targetZ - h.fromZ, this.facing);
    }

    // Floor height under the hero, blended across row boundaries.
    const rowBelow = this.rows.get(Math.round(z));
    let base: number = ROW_TOP.grass;
    if (rowBelow) {
      if (rowBelow.kind === "road") base = ROW_TOP.road;
      else if (rowBelow.kind === "rail") base = ROW_TOP.rail;
      else if (rowBelow.kind === "water") {
        base = ROW_TOP.water;
        if (h.ridingOn) {
          const platform = this.rows.get(h.ridingOn.z)?.movers[h.ridingOn.index]?.object;
          base = platform && platform.position.y < 0 ? PLATFORM_TOP.log : PLATFORM_TOP.lilyPad;
        } else if (!moving && !snap.alive && snap.deathCause === "water") {
          base = DROWNED_Y;
        }
      } else base = ROW_TOP.grass;
    }
    this.heroBaseY += (base - this.heroBaseY) * 0.35;

    this.hero.position.set(x + (moving ? 0 : 0), heroY(this.heroBaseY, hopProgress), z);
    const turn = shortestAngle(this.heroBody.rotation.y, this.facing);
    this.heroBody.rotation.y += turn * 0.4;

    const stretch = hopProgress === null ? 1 : hopStretch(hopProgress);
    if (snap.alive) {
      this.hero.scale.set(1, stretch, 1);
      this.deathAnim = 0;
    } else {
      if (this.lastDeath !== snap.deathCause) {
        this.lastDeath = snap.deathCause;
        this.deathAnim = 0;
      }
      this.deathAnim = Math.min(1, this.deathAnim + 0.12);
      if (snap.deathCause === "car" || snap.deathCause === "train") {
        const t = this.deathAnim;
        this.hero.scale.set(1 + 0.7 * t, 1 - 0.95 * t, 1 + 0.7 * t);
      }
    }
  }

  private updateCamera(snap: Snapshot, dt: number): void {
    const k = followFactor(dt);
    this.focusZ += (snap.hero.z - this.focusZ) * k;
    const targetX = cameraTargetX(snap.hero.x);
    this.focusX += (targetX - this.focusX) * k;
    // `focusX` already holds the (negated, clamped) target in upstream's axis.
    this.world.position.set(this.focusX, 0, -this.focusZ - this.heroBelow);
  }
}
