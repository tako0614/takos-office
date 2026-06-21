import { Route } from "@solidjs/router";
import PresentationListPage from "./pages/PresentationListPage";
import EditorPage from "./pages/EditorPage";
import PresentPage from "./pages/PresentPage";

export default function App() {
  return (
    <>
      <Route path="/" component={PresentationListPage} />
      <Route path="/:id" component={EditorPage} />
      <Route path="/:id/present" component={PresentPage} />
      <Route path="/files/:id" component={EditorPage} />
    </>
  );
}
