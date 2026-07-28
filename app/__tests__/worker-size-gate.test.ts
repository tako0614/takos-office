import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const [packageJson, workflow] = await Promise.all([
  readFile(new URL("../../package.json", import.meta.url), "utf8"),
  readFile(
    new URL("../../.github/workflows/check.yml", import.meta.url),
    "utf8",
  ),
]);

test("the portable product gate rejects an oversized Worker", () => {
  const scripts = JSON.parse(packageJson).scripts as Record<string, string>;
  expect(scripts["check:dist"]).toBe(
    "bun run scripts/check-worker-size.ts",
  );
  const build = scripts.check.indexOf("bun run build");
  const sizeGate = scripts.check.indexOf("bun run check:dist");
  expect(build).toBeGreaterThan(-1);
  expect(sizeGate).toBeGreaterThan(build);
});

test("GitHub Actions runs the portable gate without publication authority", () => {
  expect(workflow).toContain("pull_request:");
  expect(workflow).toContain("push:");
  expect(workflow).toContain("permissions:\n  contents: read");
  expect(workflow).toContain("persist-credentials: false");
  expect(workflow).toContain("- run: bun run check");
  expect(workflow).not.toMatch(
    /contents:\s*write|GH_TOKEN|gh release|upload-artifact|wrangler|workflow_dispatch|tags:/,
  );
});
