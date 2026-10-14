import preact from "@preact/preset-vite";
import { defineConfig } from "vite";
import { devBridge } from "./dev-bridge.ts";

// Tauri expects a fixed port and no screen clearing so Rust errors stay visible.
export default defineConfig({
  plugins: [preact(), devBridge()],
  clearScreen: false,
  server: { port: 5173, strictPort: true, host: "localhost" },
  build: { target: "es2022", chunkSizeWarningLimit: 1200 },
});
