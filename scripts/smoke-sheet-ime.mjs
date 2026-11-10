// Native cadence: actual components and Chrome's trusted IME input protocol.
// Requires Node 24+, installed project dependencies and a local Chrome binary.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import solid from "vite-plugin-solid";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chromePath = process.argv[2];
const surface = process.argv[3] ?? "sheet";
if (
  !chromePath ||
  process.argv.length > 4 ||
  !["sheet", "slide"].includes(surface)
)
  throw new Error(
    "usage: node scripts/smoke-sheet-ime.mjs <chrome-executable> [sheet|slide]",
  );
const scratch = await mkdtemp(join(tmpdir(), "takos-office-sheet-ime-"));
let chrome, socket, server;
let nextId = 0;
const pending = new Map();
const blocked = [],
  errors = [];
const refusedWrites = [];
let stderr = "";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function call(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`sheet-ime ${method} deadline`));
    }, 5_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
function receive(event) {
  const message = JSON.parse(String(event.data));
  if (message.id) {
    const waiter = pending.get(message.id);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  } else if (message.method === "Fetch.requestPaused") {
    const { requestId, request } = message.params;
    const url = new URL(request.url);
    const allowed =
      url.origin === origin ||
      url.protocol === "blob:" ||
      url.protocol === "data:";
    if (!allowed) blocked.push(url.origin);
    void call(
      allowed ? "Fetch.continueRequest" : "Fetch.failRequest",
      allowed ? { requestId } : { requestId, errorReason: "BlockedByClient" },
    ).catch((error) => errors.push(String(error)));
  } else if (message.method === "Runtime.exceptionThrown") {
    errors.push(message.params.exceptionDetails.text);
  }
}
async function evaluate(expression) {
  const result = await call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  assert.equal(result.exceptionDetails, undefined, "browser evaluation failed");
  return result.result.value;
}
let origin;
try {
  await build({
    configFile: false,
    root,
    logLevel: "silent",
    plugins: [solid()],
    resolve: { dedupe: ["solid-js", "@solidjs/router"] },
    worker: { format: "es" },
    build: {
      outDir: join(scratch, "bundle"),
      minify: false,
      lib: {
        entry: join(root, "scripts/fixtures/sheet-ime-client.tsx"),
        formats: ["iife"],
        name: "OfficeSheetIme",
        fileName: () => "client.js",
      },
    },
  });
  const bundle = await readFile(join(scratch, "bundle/client.js"));
  server = createServer((request, response) => {
    if (
      request.method === "GET" &&
      /\/api\/(?:spreadsheets|presentations)(?:\?|$)/.test(request.url)
    ) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("[]");
    } else if (
      request.method === "PUT" &&
      /\/api\/(?:spreadsheets|presentations)\//.test(request.url)
    ) {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        refusedWrites.push({
          path: request.url,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
          createOnly: request.headers["if-none-match"] === "*",
        });
        response.writeHead(503, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({ error: "intentional component-fixture refusal" }),
        );
      });
    } else if (request.url === "/client.js") {
      response.writeHead(200, { "Content-Type": "application/javascript" });
      response.end(bundle);
    } else if (request.url === "/" || request.url.startsWith("/?")) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        '<html lang="ja"><div id="root"></div><script src="/client.js"></script></html>',
      );
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
  chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--disable-component-update",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${join(scratch, "profile")}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  chrome.stderr.on("data", (data) => {
    stderr = (stderr + String(data)).slice(-16_000);
  });
  let port;
  const startupDeadline = Date.now() + 10_000;
  while (!port) {
    assert.ok(
      chrome.exitCode === null && chrome.signalCode === null,
      `owned Chrome exited: ${stderr}`,
    );
    assert.ok(
      Date.now() < startupDeadline,
      `owned Chrome startup deadline: ${stderr}`,
    );
    try {
      port = Number(
        (
          await readFile(join(scratch, "profile/DevToolsActivePort"), "utf8")
        ).split("\n")[0],
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await sleep(25);
    }
  }
  const pages = await (
    await fetch(`http://127.0.0.1:${port}/json/list`)
  ).json();
  const page = pages.find(
    (page) => page.type === "page" && page.url === "about:blank",
  );
  assert.ok(page?.webSocketDebuggerUrl, "owned Chrome page missing");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  socket.addEventListener("message", receive);
  await once(socket, "open");
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await call("Page.navigate", { url: `${origin}/?surface=${surface}` });
  const readyDeadline = Date.now() + 10_000;
  while (!(await evaluate("Boolean(window.sheetImeFixture)"))) {
    assert.ok(
      Date.now() < readyDeadline,
      `components did not render: ${JSON.stringify(errors)}`,
    );
    await sleep(25);
  }
  const checks = [];
  const key = async (kind, name, code, composing, expected, shift = false) => {
    await evaluate(`document.querySelector('#${kind} input').focus()`);
    if (composing)
      await call("Input.imeSetComposition", {
        text: "にほん",
        selectionStart: 3,
        selectionEnd: 3,
      });
    await evaluate("window.sheetImeFixture.clear()");
    await call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: name,
      code: name,
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
      modifiers: shift ? 8 : 0,
    });
    const result = await evaluate(
      `({ actions:[...window.sheetImeFixture.actions.${kind}], events:[...window.sheetImeFixture.events] })`,
    );
    assert.equal(result.events.length, 1, `${kind}/${name} missing key event`);
    assert.equal(
      result.events[0].isTrusted,
      true,
      "input must come from the native browser protocol",
    );
    assert.equal(
      result.events[0].isComposing,
      composing,
      "IME state did not match the case",
    );
    assert.equal(
      result.events[0].keyCode,
      code,
      "browser key code did not match the case",
    );
    assert.deepEqual(
      result.actions,
      expected,
      `${kind}/${name}/${code}/composing=${composing} changed the draft during conversion or lost its explicit action`,
    );
    assert.equal(
      result.events[0].prevented,
      expected.length > 0,
      "IME/default key behavior changed",
    );
    checks.push({ kind, name, code, composing, expected, trusted: true });
    await call("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: name,
      code: name,
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
    });
    if (composing)
      await call("Input.imeSetComposition", {
        text: "",
        selectionStart: 0,
        selectionEnd: 0,
      });
  };
  for (const kind of surface === "sheet" ? ["formula", "cell"] : []) {
    await key(kind, "Enter", 13, true, []);
    await key(kind, "Escape", 27, true, []);
    await key(kind, "Enter", 229, false, []);
    await key(kind, "Enter", 13, false, ["submit"]);
    await key(kind, "Escape", 27, false, ["cancel"]);
    if (kind === "cell") {
      await key(kind, "Tab", 9, false, ["tab"]);
      await key(kind, "Tab", 9, false, ["shift-tab"], true);
    }
  }
  const waitFor = async (expression, label) => {
    const deadline = Date.now() + 5_000;
    while (!(await evaluate(expression))) {
      assert.ok(Date.now() < deadline, label);
      await sleep(25);
    }
  };
  const dispatch = async (name, code, type = "keyDown", modifiers = 0) =>
    call("Input.dispatchKeyEvent", {
      type,
      key: name,
      code: name === "Process" ? "KeyN" : name,
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
      modifiers,
    });
  if (surface === "sheet") {
    await evaluate(
      "document.querySelector('#grid').focus();window.sheetImeFixture.clear()",
    );
    await dispatch("Process", 229, "rawKeyDown");
    await dispatch("Process", 229, "keyUp");
    const started = await evaluate(
      "({starts:[...window.sheetImeFixture.grid.starts],active:document.activeElement?.matches('#grid input'),events:[...window.sheetImeFixture.events]})",
    );
    assert.deepEqual(
      started.starts,
      [{ address: "A1", value: "" }],
      "grid ignored the first IME key",
    );
    assert.equal(
      started.active,
      true,
      "grid did not focus its actual CellEditor",
    );
    assert.equal(started.events[0].isTrusted, true);
    checks.push({
      kind: "grid",
      name: "Process starts and focuses real editor",
    });
    await call("Input.imeSetComposition", {
      text: "にほん",
      selectionStart: 3,
      selectionEnd: 3,
    });
    await dispatch("Enter", 13);
    await dispatch("Enter", 13, "keyUp");
    assert.deepEqual(
      await evaluate("window.sheetImeFixture.grid.actions"),
      [],
      "grid submitted unconverted input",
    );
    checks.push({
      kind: "grid",
      name: "composition confirmation retains draft",
    });
    await call("Input.insertText", { text: "日本語" });
    await dispatch("Enter", 13);
    await dispatch("Enter", 13, "keyUp");
    assert.deepEqual(await evaluate("window.sheetImeFixture.grid.actions"), [
      { action: "submit", value: "日本語" },
    ]);
    checks.push({
      kind: "grid",
      name: "explicit confirmation submits final Japanese once",
    });
  }

  await evaluate(
    `[...document.querySelectorAll('#library button')].find(e=>e.textContent.includes(${JSON.stringify(surface === "slide" ? "New Presentation" : "New Spreadsheet")})).click()`,
  );
  await waitFor(
    "Boolean(document.querySelector('#library .fixed input'))",
    "create dialog did not open",
  );
  await evaluate(
    "const title = document.querySelector('#library .fixed input'); title.focus(); title.select()",
  );
  await waitFor(
    "document.activeElement?.matches('#library .fixed input')",
    "create input did not receive focus",
  );
  await call("Input.imeSetComposition", {
    text: "にほん",
    selectionStart: 3,
    selectionEnd: 3,
  });
  await dispatch("Enter", 13);
  await dispatch("Enter", 13, "keyUp");
  assert.equal(
    await evaluate("Boolean(document.querySelector('#library .fixed input'))"),
    true,
    "IME Enter closed the create dialog",
  );
  assert.equal(refusedWrites.length, 0, "IME confirmation attempted a create");
  checks.push({
    kind: "create",
    name: "composition confirmation has zero create requests",
  });
  await dispatch("Escape", 27);
  await dispatch("Escape", 27, "keyUp");
  assert.equal(
    await evaluate("Boolean(document.querySelector('#library .fixed input'))"),
    true,
    "IME Escape closed the create dialog",
  );
  checks.push({
    kind: "create",
    name: "composition cancellation retains dialog",
  });
  if (surface === "slide") {
    await call("Input.imeSetComposition", {
      text: "",
      selectionStart: 0,
      selectionEnd: 0,
    });
    await dispatch("Enter", 229);
    await dispatch("Enter", 229, "keyUp");
    assert.equal(refusedWrites.length, 0, "legacy IME key attempted a create");
    assert.equal(
      await evaluate(
        "Boolean(document.querySelector('#library .fixed input'))",
      ),
      true,
      "legacy IME key closed the create dialog",
    );
    checks.push({
      kind: "create",
      name: "legacy keyCode229 waits for explicit action",
    });
  }
  const title = surface === "slide" ? "日本語の発表" : "日本語の表";
  await call("Input.imeSetComposition", {
    text: title,
    selectionStart: title.length,
    selectionEnd: title.length,
  });
  await call("Input.insertText", { text: title });
  await dispatch("Enter", 13);
  await dispatch("Enter", 13, "keyUp");
  const writeDeadline = Date.now() + 5_000;
  while (refusedWrites.length === 0) {
    assert.ok(Date.now() < writeDeadline, "explicit create request missing");
    await sleep(25);
  }
  assert.equal(refusedWrites.length, 1);
  assert.equal(refusedWrites[0].createOnly, true);
  assert.equal(refusedWrites[0].body.title, title);
  checks.push({
    kind: "create",
    name: "explicit final Japanese title reaches one create-only request",
  });
  assert.deepEqual(blocked, []);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      status: "PASSED",
      kind: `office.${surface}-ime@v1`,
      checks,
      refusedCreateRequests: refusedWrites.length,
      blocked,
      errors,
      scope:
        "actual components/Solid/Chrome trusted CDP IME and keyboard input; callback/request boundary only; local API writes deliberately refused, no storage or OS-device qualification",
    }),
  );
} finally {
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
    const exited = once(chrome, "exit");
    if (socket?.readyState === WebSocket.OPEN)
      await call("Browser.close").catch(() => {});
    await Promise.race([exited, sleep(2_000)]);
    if (chrome.exitCode === null && chrome.signalCode === null)
      chrome.kill("SIGTERM");
    await exited;
  }
  socket?.close();
  for (const waiter of pending.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error("owned browser closed"));
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
