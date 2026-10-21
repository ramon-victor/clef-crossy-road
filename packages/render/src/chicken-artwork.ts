import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Group,
  OrthographicCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  Vector4,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import type { ModelTemplate } from "./assets.ts";
import { facingFor } from "./layout.ts";

export type ChickenArtwork = Readonly<
  Record<"hop_forward" | "hop_back" | "hop_left" | "hop_right", string>
>;

/** Capture the game's own model once, on the existing renderer. No second WebGL context or loop. */
export function captureChickenArtwork(
  renderer: WebGLRenderer,
  template: ModelTemplate,
): ChickenArtwork {
  const size = 256;
  // The 256 px capture is downsampled by the UI. A single-sample target also keeps repeated
  // readback independent of the renderer's multisample framebuffer bindings.
  const target = new WebGLRenderTarget(size, size);
  target.texture.colorSpace = SRGBColorSpace;
  const previous = {
    target: renderer.getRenderTarget(),
    color: renderer.getClearColor(new Color()),
    alpha: renderer.getClearAlpha(),
    viewport: renderer.getViewport(new Vector4()),
    scissor: renderer.getScissor(new Vector4()),
    scissorTest: renderer.getScissorTest(),
  };
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 1.8));
  const sun = new DirectionalLight(0xffffff, 1);
  sun.position.set(20, 30, 0.05);
  scene.add(sun);
  const hero = new Group();
  const body = template.object.clone();
  body.scale.setScalar(1 / Math.max(template.size.x, template.size.y, template.size.z));
  hero.add(body);
  const center = new Box3().setFromObject(hero).getCenter(new Vector3());
  body.position.sub(center);
  scene.add(hero);
  const camera = new OrthographicCamera(-0.76, 0.76, 0.76, -0.76, 0.1, 20);
  // Match the isometric explanation board; the mesh, texture and light are the game's.
  camera.position.set(-3, 3.6, -3);
  camera.lookAt(0, 0, 0);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const pixels = new Uint8Array(size * size * 4);
  const result = {} as Record<keyof ChickenArtwork, string>;
  try {
    if (!ctx) throw new Error("Character capture requires a 2D canvas");
    renderer.setRenderTarget(target);
    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000, 0);
    for (const [action, dx, dz] of [
      ["hop_forward", 0, 1],
      ["hop_back", 0, -1],
      ["hop_left", -1, 0],
      ["hop_right", 1, 0],
    ] as const) {
      hero.rotation.y = facingFor(dx, dz, 0);
      renderer.render(scene, camera);
      pixels.fill(0);
      renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
      if (!pixels.some((value, index) => index % 4 === 3 && value > 0))
        throw new Error("Character capture is empty");
      const bitmap = ctx.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        bitmap.data.set(
          pixels.subarray(y * size * 4, (y + 1) * size * 4),
          (size - y - 1) * size * 4,
        );
      }
      ctx.putImageData(bitmap, 0, 0);
      result[action] = canvas.toDataURL("image/png");
    }
    return result;
  } finally {
    renderer.setRenderTarget(previous.target);
    renderer.setClearColor(previous.color, previous.alpha);
    renderer.setViewport(previous.viewport);
    renderer.setScissor(previous.scissor);
    renderer.setScissorTest(previous.scissorTest);
    target.dispose();
  }
}
