import { render } from "preact";
import { App } from "./App.tsx";
import { initialLanguage, LanguageProvider } from "./i18n/provider.tsx";
import "./styles.css";

const root = document.getElementById("app");
if (!root) throw new Error("#app is missing");
const initial = await initialLanguage();
render(
  <LanguageProvider initial={initial}>
    <App />
  </LanguageProvider>,
  root,
);
