/* @refresh reload */
import { render } from "solid-js/web";
import { Route, Router } from "@solidjs/router";
import DocumentListPage from "./pages/DocumentListPage";
import EditorPage from "./pages/EditorPage";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

render(
  () => (
    <Router base="/docs">
      <Route path="/" component={DocumentListPage} />
      <Route path="/:id" component={EditorPage} />
      <Route path="/files/:id" component={EditorPage} />
    </Router>
  ),
  root,
);
