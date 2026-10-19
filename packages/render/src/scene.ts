import { type DeathCause, HOP_TICKS, type Snapshot } from "@ccr/core";
import {
  AmbientLight,
  DirectionalLight,
  Group,
  OrthographicCamera,
  PCFShadowMap,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { type Assets, loadAssets } from "./assets.ts";
import { type DecisionOverlay, DecisionOverlayView } from "./decision-overlay.ts";
import {
  cameraTargetX,
  facingFor,
  followFactor,
  heroY,
  hopStretch,
  ROW_TOP,
  shortestAngle,
  standingHeight,
} from "./layout.ts";
import { buildRowView, type RowView, updateRowView } from "./row-view.ts";

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

export interface ViewStats {
  rows: number;
  drawCalls: number;
  triangles: number;
  decisionMarkers: number;
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
  private readonly decisionOverlay = new DecisionOverlayView();
  private overlay: DecisionOverlay | null = null;
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
    this.world.add(this.decisionOverlay.group);
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
    this.decisionOverlay.update(this.overlay, snap, alpha);
  }

  setDecisionOverlay(overlay: DecisionOverlay | null): void {
    this.overlay = overlay;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * CSS-pixel position of the hero relative to the canvas, for overlays. `lift` is how far above its feet,
   * in world units: the default is above the head (the thought bubble), about 0.5 is its middle.
   */
  heroScreenPosition(lift = 1.1): { x: number; y: number } | null {
    this.hero.updateWorldMatrix(true, false);
    this.tmp.setFromMatrixPosition(this.hero.matrixWorld);
    this.tmp.y += lift;
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
    return {
      rows: this.rows.size,
      drawCalls: info.calls,
      triangles: info.triangles,
      decisionMarkers: this.decisionOverlay.visibleMarkers,
    };
  }

  dispose(): void {
    this.decisionOverlay.dispose();
    this.renderer.dispose();
  }

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
        view = buildRowView(this.assets, row, snap.seed, this.rows.get(row.z - 1)?.kind);
        this.rows.set(row.z, view);
        this.world.add(view.group);
      }
      updateRowView(view, row, snap.tick, alpha);
    }
    for (const [z, view] of this.rows) {
      if (!wanted.has(z)) {
        this.world.remove(view.group);
        this.rows.delete(z);
      }
    }
  }

  /** What carries the hero over water, read from the snapshot's own movers. */
  private ride(snap: Snapshot): "log" | "lily_pad" | null {
    const riding = snap.hero.ridingOn;
    if (!riding) return null;
    const row = snap.rows.find((r) => r.z === riding.z);
    const mover = row && row.kind !== "grass" ? row.movers[riding.index] : undefined;
    return mover?.kind === "log" ? "log" : "lily_pad";
  }

  private updateHero(snap: Snapshot, alpha: number): void {
    const h = snap.hero;
    const moving = h.moving;
    const { x, z } = h;

    let hopProgress: number | null = null;
    if (moving) {
      hopProgress = Math.min(1, (h.hopTick + alpha) / HOP_TICKS);
      this.facing = facingFor(h.targetX - h.fromX, h.targetZ - h.fromZ, this.facing);
    }

    // Floor height under the hero, blended across row boundaries.
    const drowned = !moving && !snap.alive && snap.deathCause === "water";
    const floor = this.rows.get(Math.round(z))?.kind;
    const base = standingHeight(floor, this.ride(snap), drowned);
    this.heroBaseY += (base - this.heroBaseY) * 0.35;

    this.hero.position.set(x, heroY(this.heroBaseY, hopProgress), z);
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
