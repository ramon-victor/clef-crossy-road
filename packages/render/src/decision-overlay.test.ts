import { Game } from "@ccr/core";
import type { Mesh, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";
import { type DecisionOverlay, DecisionOverlayView, overlayHeight } from "./decision-overlay.ts";
import { PLATFORM_TOP, ROW_TOP } from "./layout.ts";

const overlay: DecisionOverlay = {
  points: [
    { x: 0, z: 8 },
    { x: 0, z: 9 },
    { x: -1, z: 9 },
  ],
  active: true,
  waiting: false,
  conditional: false,
  pulse: false,
};

describe("decision path rendering without a GPU", () => {
  it("uses terrain and platform support heights", () => {
    const snap = new Game({ seed: 1 }).snapshot();
    expect(overlayHeight(snap, 8)).toBe(ROW_TOP.grass + 0.025);
    for (const flavor of ["logs", "lily_pads"] as const) {
      const river = { ...snap, rows: [{ kind: "water" as const, z: 8, flavor, movers: [] }] };
      expect(overlayHeight(river, 8)).toBe(
        (flavor === "logs" ? PLATFORM_TOP.log : PLATFORM_TOP.lilyPad) + 0.025,
      );
    }
  });

  it("keeps one gold destination, reuses meshes, and removes completed or hidden segments", () => {
    const view = new DecisionOverlayView();
    const snap = new Game({ seed: 1 }).snapshot();
    view.update(overlay, snap);
    const children = [...view.group.children];
    expect(view.visibleMarkers).toBe(2);
    const markers = children.filter((_, i) => i % 2 === 0) as Mesh[];
    if (!markers[0] || !markers[1]) throw new Error("missing path markers");
    expect(markers[0]?.position.z).toBe(9);
    expect(markers[1]?.position.x).toBe(-1);
    expect((markers[0].material as MeshBasicMaterial).color.getHex()).toBe(0xffd640);
    expect((markers[1].material as MeshBasicMaterial).color.getHex()).toBe(0x8fe3ff);
    view.update({ ...overlay, points: overlay.points.slice(0, 2) }, snap);
    expect(view.visibleMarkers).toBe(1);
    expect(view.group.children).toEqual(children);
    view.update(null, snap);
    expect(view.visibleMarkers).toBe(0);
    view.update(overlay, { ...snap, alive: false });
    expect(view.visibleMarkers).toBe(0);
    view.dispose();
  });

  it("has no executing target for a held answer and dashes conditional continuation", () => {
    const view = new DecisionOverlayView();
    view.update({ ...overlay, active: false, conditional: true }, new Game({ seed: 1 }).snapshot());
    const marker = view.group.children[0] as Mesh;
    const link = view.group.children[1] as Mesh;
    expect((marker.material as MeshBasicMaterial).color.getHex()).toBe(0x8fe3ff);
    expect((link.material as MeshBasicMaterial).alphaMap).not.toBeNull();
    expect((link.material as MeshBasicMaterial).depthWrite).toBe(false);
    expect((link.material as MeshBasicMaterial).depthTest).toBe(true);
    view.dispose();
  });
});
