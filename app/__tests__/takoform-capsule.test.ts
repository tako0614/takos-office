import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const moduleUrl = new URL("../../deploy/takoform/", import.meta.url);
const [main, outputs] = await Promise.all([
  readFile(new URL("main.tf", moduleUrl), "utf8"),
  readFile(new URL("outputs.tf", moduleUrl), "utf8"),
]);

describe("Takos Office Takoform Capsule", () => {
  test("owns one portable HTTP service and its app-authored Interfaces", () => {
    expect(main).toContain('resource "takoform_http_service" "worker"');
    expect(main).toContain('resource "takoform_interface" "surface"');
    for (const name of [
      "takos-office.mcp",
      "takos-office.docs",
      "takos-office.slide",
      "takos-office.sheet",
      "takos-office.docs-file",
      "takos-office.slide-file",
      "takos-office.sheet-file",
    ]) {
      expect(main).toContain(`name = "${name}"`);
    }
    expect(main).toContain('resource_kind = "HttpService"');
    expect(main).toContain('originInput = "origin"');
    expect(main).not.toContain("takoform_object_bucket");
    expect(main).toContain(
      'source  = "registry.opentofu.org/tako0614/takoform"',
    );
  });

  test("never uses Cloudflare compatibility as managed desired state", () => {
    expect(main).not.toContain("cloudflare/cloudflare");
    expect(main).not.toContain('resource "cloudflare_');
    expect(main).not.toContain("/compat/cloudflare/");
    expect(main).not.toContain("compatibility_date");
    expect(main).not.toContain("compatibility_flags");
  });

  test("preserves all ordinary Office runtime outputs", () => {
    for (const name of [
      "launch_url",
      "mcp_url",
      "docs_url",
      "slide_url",
      "sheet_url",
      "docs_file_open_url",
      "slide_file_open_url",
      "sheet_file_open_url",
    ]) {
      expect(outputs).toContain(`output "${name}"`);
    }
    expect(outputs).not.toContain("app_deployment");
    expect(outputs).not.toContain("service_exports");
  });
});
