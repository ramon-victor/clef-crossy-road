import { render } from "preact";
import { App } from "./App.tsx";
import "./styles.css";

const root = document.getElementById("app");
if (!root) throw new Error("#app is missing");
render(<App />, root);
