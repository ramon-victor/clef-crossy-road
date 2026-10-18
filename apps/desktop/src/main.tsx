import { getCurrentWindow } from "@tauri-apps/api/window";
import { render } from "preact";
import { isTauri } from "./bridge/tauri.ts";
import { initialLanguage } from "./i18n/environment.ts";
import { LanguageProvider } from "./i18n/provider.tsx";
import "./styles.css";

const root = document.getElementById("app");
if (!root) throw new Error("#app is missing");
const desktop = isTauri();
const initial = await initialLanguage();
if (desktop && getCurrentWindow().label === "decisions") {
  const { DecisionsApp } = await import("./DecisionsApp.tsx");
  render(
    <LanguageProvider initial={initial}>
      <DecisionsApp />
    </LanguageProvider>,
    root,
  );
} else if (desktop && getCurrentWindow().label === "controls") {
  const { ControlsApp } = await import("./ControlsApp.tsx");
  render(
    <LanguageProvider initial={initial}>
      <ControlsApp />
    </LanguageProvider>,
    root,
  );
} else {
  const { App } = await import("./App.tsx");
  render(
    <LanguageProvider initial={initial}>
      <App desktop={desktop} />
    </LanguageProvider>,
    root,
  );
}
