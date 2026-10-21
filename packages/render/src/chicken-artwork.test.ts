import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector4,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureChickenArtwork } from "./chicken-artwork.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture(fail = false) {
  const object = new Group();
  object.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
  const before = object.toJSON();
  const target = new WebGLRenderTarget(12, 12);
  const color = new Color(0x123456);
  const viewport = new Vector4(2, 3, 100, 200);
  const scissor = new Vector4(4, 5, 60, 70);
  const angles: number[] = [];
  const putImageData = vi.fn();
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => ({
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData,
      }),
      toDataURL: () => `data:image/png;base64,${angles.length}`,
    }),
  });
  const renderer = {
    getRenderTarget: () => target,
    getClearColor: (out: Color) => out.copy(color),
    getClearAlpha: () => 0.5,
    getViewport: (out: Vector4) => out.copy(viewport),
    getScissor: (out: Vector4) => out.copy(scissor),
    getScissorTest: () => true,
    setRenderTarget: vi.fn(),
    setClearColor: vi.fn(),
    setViewport: vi.fn(),
    setScissor: vi.fn(),
    setScissorTest: vi.fn(),
    render: vi.fn((scene) => {
      if (fail) throw new Error("Capture failed");
      angles.push(scene.children.find((child: Group) => child.isGroup).rotation.y);
    }),
    readRenderTargetPixels: vi.fn((_target, _x, _y, _w, _h, bytes: Uint8Array) => {
      bytes[0] = 255;
      bytes[3] = 255;
    }),
  };
  const dispose = vi.spyOn(WebGLRenderTarget.prototype, "dispose");
  return {
    object,
    before,
    renderer,
    target,
    color,
    viewport,
    scissor,
    angles,
    dispose,
    putImageData,
  };
}

describe("game character capture", () => {
  it("captures four facings with transparency, flips readback rows and preserves the game assets and renderer", () => {
    const f = fixture();
    const art = captureChickenArtwork(f.renderer as unknown as WebGLRenderer, {
      object: f.object,
      size: { x: 1, y: 1, z: 1 },
    });
    expect(Object.keys(art)).toEqual(["hop_forward", "hop_back", "hop_left", "hop_right"]);
    expect(f.angles).toEqual([0, Math.PI, -Math.PI / 2, Math.PI / 2]);
    expect(f.putImageData.mock.calls[0]?.[0].data[(256 - 1) * 256 * 4]).toBe(255);
    expect(f.object.toJSON()).toEqual(f.before);
    expect(f.renderer.setRenderTarget).toHaveBeenLastCalledWith(f.target);
    expect(f.renderer.setClearColor).toHaveBeenLastCalledWith(f.color, 0.5);
    expect(f.renderer.setViewport).toHaveBeenLastCalledWith(f.viewport);
    expect(f.renderer.setScissor).toHaveBeenLastCalledWith(f.scissor);
    expect(f.renderer.setScissorTest).toHaveBeenLastCalledWith(true);
    expect(f.dispose).toHaveBeenCalledOnce();
  });

  it("restores the render target, clear color, viewport and scissor when capture fails", () => {
    const f = fixture(true);
    expect(() =>
      captureChickenArtwork(f.renderer as unknown as WebGLRenderer, {
        object: f.object,
        size: { x: 1, y: 1, z: 1 },
      }),
    ).toThrow("Capture failed");
    expect(f.renderer.setRenderTarget).toHaveBeenLastCalledWith(f.target);
    expect(f.renderer.setClearColor).toHaveBeenLastCalledWith(f.color, 0.5);
    expect(f.renderer.setViewport).toHaveBeenLastCalledWith(f.viewport);
    expect(f.renderer.setScissor).toHaveBeenLastCalledWith(f.scissor);
    expect(f.renderer.setScissorTest).toHaveBeenLastCalledWith(true);
    expect(f.dispose).toHaveBeenCalledOnce();
  });
});
