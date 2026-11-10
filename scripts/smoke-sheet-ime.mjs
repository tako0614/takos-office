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
if (!chromePath || process.argv.length !== 3)
  throw new Error(
    "usage: node scripts/smoke-sheet-ime.mjs <chrome-executable>",
  );
const scratch = await mkdtemp(join(tmpdir(), "takos-office-sheet-ime-"));
let chrome, socket, server;
let nextId = 0;
const pending = new Map();
const blocked = [],
  errors = [];
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
    if (request.url === "/client.js") {
      response.writeHead(200, { "Content-Type": "application/javascript" });
      response.end(bundle);
    } else if (request.url === "/") {
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
  await call("Page.navigate", { url: origin });
  const readyDeadline = Date.now() + 10_000;
  while (!(await evaluate("Boolean(window.sheetImeFixture)"))) {
    assert.ok(Date.now() < readyDeadline, "components did not render");
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
  for (const kind of ["formula", "cell"]) {
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
  assert.deepEqual(blocked, []);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      status: "PASSED",
      kind: "office.sheet-ime@v1",
      checks,
      blocked,
      errors,
      scope:
        "actual components/Solid/Chrome trusted CDP IME and keyboard input; callback-only, no server/storage/OS-device qualification",
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
