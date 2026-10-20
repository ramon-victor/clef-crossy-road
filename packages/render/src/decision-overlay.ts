import type { Snapshot } from "@ccr/core";
import {
  DataTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  RingGeometry,
} from "three";
import { PLATFORM_TOP, ROW_TOP } from "./layout.ts";

export interface OverlayPoint {
  x: number;
  z: number;
  wait?: boolean;
}

/** World-space presentation only. The renderer knows nothing about policies or forecasts. */
export interface DecisionOverlay {
  points: readonly OverlayPoint[];
  active: boolean;
  waiting: boolean;
  conditional: boolean;
  pulse: boolean;
}

/** Draw just above the supporting surface; ordinary depth testing keeps obstacles legible. */
export function overlayHeight(snap: Snapshot, z: number): number {
  const row = snap.rows.find((r) => r.z === Math.round(z));
  if (!row) return ROW_TOP.grass + 0.025;
  const surface =
    row.kind === "water"
      ? row.flavor === "logs"
        ? PLATFORM_TOP.log
        : PLATFORM_TOP.lilyPad
      : ROW_TOP[row.kind];
  return surface + 0.025;
}

const material = (color: number, opacity: number) =>
  new MeshBasicMaterial({
    color,
    opacity,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

/** Bounded, reusable meshes. No shadows, textures from the network or post-processing. */
export class DecisionOverlayView {
  readonly group = new Group();
  private readonly square = new RingGeometry(0.33, 0.39, 4).rotateZ(Math.PI / 4);
  private readonly circle = new RingGeometry(0.24, 0.29, 24);
  private readonly ribbon = new PlaneGeometry(1, 1);
  private readonly gold = material(0xffd640, 0.95);
  private readonly next = material(0x8fe3ff, 0.65);
  private readonly future = material(0x8fe3ff, 0.38);
  private readonly dashed = material(0x8fe3ff, 0.32);
  private readonly dashes: DataTexture;
  private readonly markers: Mesh[] = [];
  private readonly links: Mesh[] = [];

  constructor() {
    this.dashes = new DataTexture(
      new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255]),
      4,
      1,
      RGBAFormat,
    );
    this.dashes.wrapS = RepeatWrapping;
    this.dashes.repeat.x = 5;
    this.dashes.needsUpdate = true;
    this.dashed.alphaMap = this.dashes;
    this.group.name = "decision-overlay";
  }

  update(overlay: DecisionOverlay | null, snap: Snapshot, alpha = 0): void {
    this.group.visible = overlay !== null && snap.alive;
    for (const mesh of this.markers) mesh.visible = false;
    for (const mesh of this.links) mesh.visible = false;
    if (!overlay || !snap.alive) return;
    const { points } = overlay;
    // The controller's longest current forecast is 24 steps. Keep even malformed callers bounded.
    const count = Math.min(points.length - 1, 24);
    this.gold.opacity =
      overlay.waiting && overlay.pulse
        ? 0.78 + 0.17 * Math.sin(((snap.tick + alpha) * Math.PI) / 30)
        : 0.95;
    for (let i = 0; i < count; i++) {
      const from = points[i];
      const to = points[i + 1];
      if (!from || !to) continue;
      const row = snap.rows.find((r) => r.z === Math.round(to.z));
      if (!row) continue;
      let marker = this.markers[i];
      let link = this.links[i];
      while (this.markers.length <= i) {
        const addedMarker = new Mesh(this.square, this.future);
        const addedLink = new Mesh(this.ribbon, this.future);
        this.markers.push(addedMarker);
        this.links.push(addedLink);
        this.group.add(addedMarker, addedLink);
      }
      marker = this.markers[i];
      link = this.links[i];
      if (!marker || !link) continue;
      const active = i === 0 && overlay.active;
      const paint = active ? this.gold : i === 0 ? this.next : this.future;
      marker.geometry = to.wait ? this.circle : this.square;
      marker.material = paint;
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(to.x, overlayHeight(snap, to.z), to.z);
      marker.visible = true;

      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const distance = Math.hypot(dx, dz);
      link.visible = distance > 0.04;
      link.material = overlay.conditional && !active ? this.dashed : paint;
      link.position.set(
        (from.x + to.x) / 2,
        Math.max(overlayHeight(snap, from.z), overlayHeight(snap, to.z)),
        (from.z + to.z) / 2,
      );
      link.rotation.set(-Math.PI / 2, 0, -Math.atan2(dz, dx));
      link.scale.set(distance, 0.045, 1);
    }
  }

  get visibleMarkers(): number {
    return this.group.visible ? this.markers.filter((m) => m.visible).length : 0;
  }

  dispose(): void {
    for (const resource of [
      this.square,
      this.circle,
      this.ribbon,
      this.gold,
      this.next,
      this.future,
      this.dashed,
      this.dashes,
    ])
      resource.dispose();
    this.group.clear();
  }
}
