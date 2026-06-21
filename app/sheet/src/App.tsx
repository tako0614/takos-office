import { Route } from "@solidjs/router";
import { SpreadsheetListPage } from "./pages/SpreadsheetListPage";
import { EditorPage } from "./pages/EditorPage";

export default function App() {
  return (
    <>
      <Route path="/" component={SpreadsheetListPage} />
      <Route path="/:id" component={EditorPage} />
      <Route path="/files/:id" component={EditorPage} />
    </>
  );
}
