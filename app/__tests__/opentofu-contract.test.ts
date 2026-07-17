import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const [moduleSource, outputsSource] = await Promise.all([
  readFile(new URL("../../main.tf", import.meta.url), "utf8"),
  readFile(new URL("../../outputs.tf", import.meta.url), "utf8"),
]);

const declaredOutputs = [
  ...outputsSource.matchAll(/output\s+"([^"]+)"\s*\{/gu),
].map((match) => match[1]);

const INTERFACE_URL_OUTPUTS = [
  "mcp_url",
  "docs_url",
  "slide_url",
  "sheet_url",
  "docs_file_open_url",
  "slide_file_open_url",
  "sheet_file_open_url",
] as const;

describe("OpenTofu Capsule contract", () => {
  test("publishes the exact seven ordinary Interface source URLs", () => {
    expect(
      declaredOutputs.filter((name) =>
        INTERFACE_URL_OUTPUTS.includes(
          name as (typeof INTERFACE_URL_OUTPUTS)[number],
        ),
      ),
    ).toEqual([...INTERFACE_URL_OUTPUTS]);

    for (const name of INTERFACE_URL_OUTPUTS) {
      expect(outputsSource).toContain(`output "${name}"`);
    }
  });

  test("contains no retired runtime declaration Output", () => {
    expect(declaredOutputs).not.toContain("app_deployment");
    expect(declaredOutputs).not.toContain("service_exports");
    expect(declaredOutputs).not.toContain("service_bindings");
  });

  test("accepts first-apply owner context and injects Workspace/Capsule evidence", () => {
    expect(moduleSource).toMatch(
      /variable\s+"object_storage_workspace_id"\s*\{/u,
    );
    expect(moduleSource).toMatch(/variable\s+"app_capsule_id"\s*\{/u);
    expect(moduleSource).toContain('name = "APP_WORKSPACE_ID"');
    expect(moduleSource).toContain('name = "APP_CAPSULE_ID"');

    for (const retiredPin of [
      "interface_id",
      "interface_revision",
      "interface_resolved_revision",
    ]) {
      expect(moduleSource).not.toMatch(
        new RegExp(`variable\\s+"${retiredPin}"\\s*\\{`, "u"),
      );
    }
  });

  test("never generates a standing MCP bearer", () => {
    expect(moduleSource).not.toMatch(
      /resource\s+"random_id"\s+"mcp_auth_token"\s*\{/u,
    );
    expect(moduleSource).not.toContain("effective_mcp_auth_token");
    expect(moduleSource).toContain('local.provided_mcp_auth_token != "" ? [');
    expect(moduleSource).toContain('name = "MCP_AUTH_TOKEN"');
  });

  test("pins every runner provider to the release mirror versions", () => {
    expect(moduleSource).toContain('version = "= 5.19.1"');
    expect(moduleSource).toContain('version = "= 3.6.0"');
    expect(moduleSource).toContain('version = "= 3.9.0"');
  });
});
