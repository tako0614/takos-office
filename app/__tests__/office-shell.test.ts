import { expect, test } from "bun:test";
import { Script } from "node:vm";
import { renderShellPage } from "../shell-page.ts";

class Element {
  hidden = true;
  innerHTML = "";
  textContent = "";
  value = "";
  children: Element[] = [];
  handlers = new Map<string, () => void>();
  addEventListener(name: string, handler: () => void) {
    this.handlers.set(name, handler);
  }
  appendChild(child: Element) {
    this.children.push(child);
  }
  fire(name: string) {
    this.handlers.get(name)?.();
  }
}

function shell() {
  const nodes = new Map<string, Element>();
  for (const id of ["items", "loading", "empty", "load-error", "partial", "retry", "list-heading", "q", "theme-toggle"]) {
    nodes.set(id, new Element());
  }
  const requests: { url: string; resolve: (response: Response) => void; reject: (error: Error) => void }[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const location = { pathname: "/", search: "?space_id=workspace-a", href: "" };
  const scripts = [...renderShellPage().matchAll(/<script>([\s\S]*?)<\/script>/g)];
  new Script(scripts.at(-1)![1]!).runInNewContext({
    document: {
      documentElement: { dataset: { theme: "light" } },
      getElementById: (id: string) => nodes.get(id),
      querySelectorAll: () => [],
      createElement: () => new Element(),
    },
    location,
    localStorage: { setItem() {} },
    URLSearchParams,
    fetch: (url: string) => new Promise<Response>((resolve, reject) => requests.push({ url, resolve, reject })),
    setTimeout: (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: (id: number) => timers.delete(id),
  });
  const node = (id: string) => nodes.get(id)!;
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  return {
    node, requests, location, flush,
    async respond(index: number, status: number, body: unknown) {
      requests[index]!.resolve(Response.json(body, { status }));
      await flush();
    },
    async reject(index: number) {
      requests[index]!.reject(new Error("private network detail"));
      await flush();
    },
    type(query: string) {
      node("q").value = query;
      node("q").fire("input");
    },
    runTimers() {
      for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
    },
    search(query: string) {
      node("q").value = query;
      node("q").fire("input");
      for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
    },
  };
}

test("shell shows load failure and explicit retry instead of an empty library", async () => {
  const page = shell();
  await page.respond(0, 503, { error: "private upstream detail" });
  expect(page.node("loading").hidden).toBe(true);
  expect(page.node("empty").hidden).toBe(true);
  expect(page.node("load-error").hidden).toBe(false);
  expect(page.node("retry").hidden).toBe(false);
  expect(page.requests).toHaveLength(1);
  page.node("retry").fire("click");
  expect(page.requests[1]!.url).toBe("/api/office/items?space_id=workspace-a");
  await page.respond(1, 200, { items: [], unavailableApps: [] });
  expect(page.node("load-error").hidden).toBe(true);
  expect(page.node("empty").hidden).toBe(false);
  expect(page.node("retry").hidden).toBe(true);
});

test("shell marks partial empty results incomplete, retaining healthy rows", async () => {
  const page = shell();
  await page.respond(0, 200, { items: [], unavailableApps: ["docs"] });
  expect(page.node("empty").hidden).toBe(true);
  expect(page.node("partial").hidden).toBe(false);
  expect(page.node("retry").hidden).toBe(false);
  page.node("retry").fire("click");
  await page.respond(1, 200, { items: [{ app: "slide", id: "p1", title: "Report", updatedAt: "2026-06-03T00:00:00Z" }], unavailableApps: ["docs"] });
  expect(page.node("items").children).toHaveLength(1);
  expect(page.node("partial").hidden).toBe(false);
});

test("shell search retries the current query and ignores stale failure or auth responses", async () => {
  const page = shell();
  page.search("report");
  expect(page.requests[1]!.url).toBe("/api/office/search?q=report&space_id=workspace-a");
  await page.respond(1, 503, {});
  page.node("retry").fire("click");
  expect(page.requests[2]!.url).toBe(page.requests[1]!.url);
  await page.respond(2, 200, { items: [], unavailableApps: [] });
  await page.respond(0, 401, {});
  expect(page.location.href).toBe("");
  expect(page.node("empty").hidden).toBe(false);
  page.search("old");
  page.search("new");
  await page.respond(4, 200, { items: [], unavailableApps: [] });
  await page.reject(3);
  expect(page.node("load-error").hidden).toBe(true);
  expect(page.node("empty").hidden).toBe(false);
});

test("network and malformed-response failures are errors; current 401 retains normal login", async () => {
  const page = shell();
  await page.reject(0);
  expect(page.node("empty").hidden).toBe(true);
  expect(page.node("load-error").hidden).toBe(false);
  page.node("retry").fire("click");
  await page.respond(1, 200, {});
  expect(page.node("load-error").hidden).toBe(false);
  page.node("retry").fire("click");
  await page.respond(2, 401, {});
  expect(page.location.href).toBe("/docs/api/auth/login?return_to=%2F%3Fspace_id%3Dworkspace-a");
});


test("typing retires old rows and login responses before the debounce fires", async () => {
  for (const status of [200, 401]) {
    const page = shell();
    page.type("new query");
    expect(page.requests).toHaveLength(1);
    await page.respond(0, status, { items: [{ app: "docs", id: "old", title: "Old", updatedAt: "2026-06-03T00:00:00Z" }] });
    expect(page.node("items").children).toHaveLength(0);
    expect(page.location.href).toBe("");
    expect(page.node("loading").hidden).toBe(false);
    page.runTimers();
    expect(page.requests[1]!.url).toBe("/api/office/search?q=new%20query&space_id=workspace-a");
    await page.respond(1, 200, { items: [] });
    expect(page.node("empty").hidden).toBe(false);
  }
});
