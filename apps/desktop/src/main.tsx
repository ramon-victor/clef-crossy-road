import { getCurrentWindow } from "@tauri-apps/api/window";
import { render } from "preact";
import { isTauri } from "./bridge/tauri.ts";
import "./styles.css";

const root = document.getElementById("app");
if (!root) throw new Error("#app is missing");
const desktop = isTauri();
if (desktop && getCurrentWindow().label === "controls") {
  const { ControlsApp } = await import("./ControlsApp.tsx");
  render(<ControlsApp />, root);
} else {
  const { App } = await import("./App.tsx");
  render(<App desktop={desktop} />, root);
}
