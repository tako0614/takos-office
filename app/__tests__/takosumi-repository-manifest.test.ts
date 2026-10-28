import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const text = await readFile(
  new URL(".well-known/takosumi.json", root),
  "utf8",
);
const manifest = JSON.parse(text) as RepositoryManifest;
const options = JSON.parse(
  await readFile(new URL("install-options.json", root), "utf8"),
) as { options: Array<{ source: { path: string } }> };
const moduleSources: Record<string, string> = {
  ".": await readFile(new URL("main.tf", root), "utf8"),
  "deploy/takoform": await readFile(
    new URL("deploy/takoform/main.tf", root),
    "utf8",
  ),
};
const moduleOutputs: Record<string, string> = {
  ".": await readFile(new URL("outputs.tf", root), "utf8"),
  "deploy/takoform": await readFile(
    new URL("deploy/takoform/outputs.tf", root),
    "utf8",
  ),
};

test("Takos Office publishes a closed Repository manifest", () => {
  expect(Object.keys(manifest).sort()).toEqual([
    "apiVersion",
    "install",
    "kind",
  ]);
  expect(manifest.apiVersion).toBe("takosumi.com/v2.1");
  expect(manifest.kind).toBe("Repository");
  expect(Object.keys(manifest.install)).toEqual(["defaultModule", "modules"]);
  expect(manifest.install.defaultModule).toBe(".");
  expect(Object.keys(manifest.install.modules)).toEqual([
    ".",
    "deploy/takoform",
  ]);
  for (const option of options.options) {
    expect(manifest.install.modules[option.source.path]).toBeDefined();
  }
});

test("the advertised root delivers all four public OIDC registration fields", () => {
  const requirement = manifest.install.modules["."]?.requires?.find(
    (entry) => entry.kind === "identity.oidc",
  );
  const variables = requirement?.deliver?.variables ?? {};
  expect(Object.keys(variables).sort()).toEqual([
    "accountsUrl",
    "clientId",
    "issuerUrl",
    "redirectUri",
  ]);
  expect(new Set(Object.values(variables)).size).toBe(4);
  for (const name of Object.values(variables)) {
    expect(manifest.install.modules["."]?.inputs).toContainEqual(
      expect.objectContaining({
        name,
        source: { kind: "module_default" },
      }),
    );
  }
});

test("the Cloudflare root exposes deployment opt-ins for reviewed user choice", () => {
  const module = manifest.install.modules["."]!;
  for (const name of [
    "enable_cloudflare_resources",
    "enable_cloudflare_worker_script",
  ]) {
    expect(module.inputs).toContainEqual(expect.objectContaining({
      name,
      source: { kind: "user" },
      type: "boolean",
      advanced: true,
    }));
    expect(variableBlock(moduleSources["."]!, name)).toMatch(
      /\n\s+default\s+=\s+false\b/,
    );
  }
});

test("the root requests one Suite launcher and the unified MCP for the installer", () => {
  const interfaces = manifest.install.modules["."]!.interfaces ?? [];
  const launchers = interfaces.filter((entry) =>
    entry.spec.type === "interface.ui.surface" && entry.spec.document.launcher
  );
  const mcps = interfaces.filter((entry) => entry.spec.type === "mcp.server");
  expect(launchers).toHaveLength(1);
  expect(mcps).toHaveLength(1);
  expect(launchers[0]?.spec.inputs?.url).toEqual({
    source: "output",
    outputName: "launch_url",
    outputType: "url",
  });
  expect(launchers[0]?.bindingRequests).toEqual([{
    key: "installer",
    subject: { source: "installing_principal" },
    permissions: ["ui.open"],
    delivery: { type: "none" },
  }]);
  expect(mcps[0]?.spec.inputs?.endpoint).toEqual({
    source: "output",
    outputName: "mcp_url",
    outputType: "url",
  });
  expect(mcps[0]?.bindingRequests).toEqual([{
    key: "installer",
    subject: { source: "installing_principal" },
    permissions: ["mcp.invoke"],
    delivery: { type: "oauth2" },
  }]);
});

test("Interface requests resolve ordinary outputs from their selected module", () => {
  for (const [path, module] of Object.entries(manifest.install.modules)) {
    const outputs = new Set(Array.from(
      moduleOutputs[path]!.matchAll(/output\s+"([^"]+)"\s*\{/g),
      (match) => match[1],
    ));
    for (const entry of module.interfaces ?? []) {
      for (const input of Object.values(entry.spec.inputs ?? {})) {
        if (input.source === "output") expect(outputs.has(input.outputName)).toBe(true);
      }
    }
  }
});

test("declared modules reference real variables without credential or identity selectors", () => {
  for (const [path, module] of Object.entries(manifest.install.modules)) {
    const source = moduleSources[path];
    expect(source).toBeDefined();
    const variables = new Set(
      Array.from(
        source.matchAll(/variable\s+"([^"]+)"\s*\{/g),
        (match) => match[1],
      ),
    );
    for (const name of referencedVariables(module)) {
      expect(variables.has(name)).toBe(true);
    }
    for (const input of module.inputs) {
      expect(input.secret).toBeUndefined();
      if (input.source.kind === "module_default") {
        expect(variableBlock(source, input.name)).toMatch(/\n\s+default\s+=/);
      }
    }
  }
  for (const forbidden of [
    "cloudflare_account_id",
    "object_storage_access_token",
    "mcp_auth_token",
    "object_storage_workspace_id",
    "app_capsule_id",
    '"env"',
    "credential",
  ]) {
    expect(text).not.toContain(forbidden);
  }
});

function variableBlock(source: string, name: string): string {
  const start = source.indexOf(`variable "${name}" {`);
  const next = source.indexOf("\nvariable ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

function referencedVariables(module: RepositoryModule): Set<string> {
  const names = new Set(module.inputs.map((input) => input.name));
  for (const requirement of module.requires ?? []) {
    for (const value of Object.values(requirement.deliver?.variables ?? {})) {
      names.add(value);
    }
  }
  return names;
}

interface RepositoryManifest {
  apiVersion: string;
  kind: string;
  install: {
    defaultModule: string;
    modules: Record<string, RepositoryModule>;
  };
}

interface RepositoryModule {
  inputs: Array<{
    name: string;
    source: { kind: string };
    type?: string;
    advanced?: boolean;
    secret?: boolean;
  }>;
  requires?: Array<{
    kind: string;
    deliver?: { variables?: Record<string, string> };
  }>;
  interfaces?: Array<{
    spec: {
      type: string;
      document: { launcher?: boolean };
      inputs?: Record<string, {
        source: string;
        outputName: string;
        outputType: string;
      }>;
    };
    bindingRequests?: Array<{
      key: string;
      subject: { source: string };
      permissions: string[];
      delivery: { type: string };
    }>;
  }>;
}
