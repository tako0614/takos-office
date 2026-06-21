/* @refresh reload */
import { render } from "solid-js/web";
import { Router } from "@solidjs/router";
import App from "./App";
import "./styles.css";

const root = document.getElementById("app");

if (!root) {
  throw new Error("Root element #app not found");
}

render(
  () => (
    <Router base="/sheet">
      <App />
    </Router>
  ),
  root,
);
