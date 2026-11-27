import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  acquireModalScrollLock,
  getArrowNudgeDelta,
  isValidHttpUrl,
  restoreFocus,
} from "../shared/lib/dialog-a11y.ts";
import { createI18n } from "../shared/i18n.ts";
import { renderShellPage } from "../shell-page.ts";

const ROOT = join(import.meta.dir, "..");

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules" || entry === "dist") {
      continue;
    }
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkTsFiles(full));
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("Wave 2 dialog-a11y helpers", () => {
  test("acquireModalScrollLock is ref-counted and idempotent on double release", () => {
    const prevDocument = globalThis.document;
    const body = { style: { overflow: "auto" } };
    globalThis.document = { body } as unknown as Document;
    try {
      const release1 = acquireModalScrollLock();
      expect(body.style.overflow).toBe("hidden");
      const release2 = acquireModalScrollLock();
      expect(body.style.overflow).toBe("hidden");

      // Double-releasing the first lock must not decrement below 1.
      release1();
      release1();
      expect(body.style.overflow).toBe("hidden");

      release2();
      expect(body.style.overflow).toBe("auto");
    } finally {
      globalThis.document = prevDocument;
    }
  });

  test("restoreFocus focuses connected opener and falls back to #main when opener is detached", () => {
    const prevDocument = globalThis.document;
    let focusedTarget = "";
    const mainEl = {
      isConnected: true,
      focus: () => {
        focusedTarget = "main";
      },
    } as unknown as HTMLElement;
    const connectedOpener = {
      isConnected: true,
      focus: () => {
        focusedTarget = "opener";
      },
    } as unknown as HTMLElement;
    const detachedOpener = {
      isConnected: false,
      focus: () => {
        focusedTarget = "detached";
      },
    } as unknown as HTMLElement;

    globalThis.document = {
      querySelector: (sel: string) => (sel === "#main" ? mainEl : null),
    } as unknown as Document;

    try {
      restoreFocus(connectedOpener);
      expect(focusedTarget).toBe("opener");

      focusedTarget = "";
      restoreFocus(detachedOpener);
      expect(focusedTarget).toBe("main");

      focusedTarget = "";
      restoreFocus(null);
      expect(focusedTarget).toBe("main");
    } finally {
      globalThis.document = prevDocument;
    }
  });

  test("isValidHttpUrl accepts http/https URLs and rejects dangerous or malformed values", () => {
    expect(isValidHttpUrl("https://example.com/pic.png")).toBe(true);
    expect(isValidHttpUrl("http://localhost:8080/a.jpg")).toBe(true);
    expect(isValidHttpUrl("  https://example.com/a?x=1  ")).toBe(true);
    expect(isValidHttpUrl("")).toBe(false);
    expect(isValidHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isValidHttpUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isValidHttpUrl("ftp://example.com/file.png")).toBe(false);
    expect(isValidHttpUrl("not a url")).toBe(false);
    expect(isValidHttpUrl("https://example.com/\nfoo")).toBe(false);
  });

  test("getArrowNudgeDelta moves 1px on Arrow and 10px on Shift+Arrow, ignores modifiers and IME", () => {
    expect(getArrowNudgeDelta({ key: "ArrowLeft", shiftKey: false })).toEqual({
      dx: -1,
      dy: 0,
    });
    expect(getArrowNudgeDelta({ key: "ArrowRight", shiftKey: true })).toEqual({
      dx: 10,
      dy: 0,
    });
    expect(getArrowNudgeDelta({ key: "ArrowUp", shiftKey: false })).toEqual({
      dx: 0,
      dy: -1,
    });
    expect(getArrowNudgeDelta({ key: "ArrowDown", shiftKey: true })).toEqual({
      dx: 0,
      dy: 10,
    });
    expect(
      getArrowNudgeDelta({ key: "ArrowUp", shiftKey: false, altKey: true }),
    ).toBeNull();
    expect(
      getArrowNudgeDelta({ key: "ArrowDown", shiftKey: false, ctrlKey: true }),
    ).toBeNull();
    expect(
      getArrowNudgeDelta({ key: "ArrowLeft", shiftKey: false, metaKey: true }),
    ).toBeNull();
    expect(
      getArrowNudgeDelta({
        key: "ArrowRight",
        shiftKey: false,
        isComposing: true,
      }),
    ).toBeNull();
    expect(
      getArrowNudgeDelta({ key: "ArrowUp", shiftKey: false, keyCode: 229 }),
    ).toBeNull();
    expect(getArrowNudgeDelta({ key: "Enter", shiftKey: false })).toBeNull();
  });
});

describe("Wave 2 takos-language synchronization and Shell i18n", () => {
  test("createI18n reads takos-language first, falls back to takos-lang, and persists both keys", () => {
    const store = new Map<string, string>();
    const prevStorage = globalThis.localStorage;
    const prevDocument = globalThis.document;
    const docEl = { lang: "en" };
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    } as unknown as Storage;
    globalThis.document = { documentElement: docEl } as unknown as Document;

    try {
      store.set("takos-language", "ja");
      store.set("takos-lang", "en");
      const i18n = createI18n({
        en: { hello: "Hello" },
        ja: { hello: "こんにちは" },
      });
      expect(i18n.language()).toBe("ja");
      expect(i18n.t("hello")).toBe("こんにちは");
      expect(docEl.lang).toBe("ja");

      i18n.setLanguage("en");
      expect(store.get("takos-language")).toBe("en");
      expect(store.get("takos-lang")).toBe("en");
      expect(docEl.lang).toBe("en");
    } finally {
      globalThis.localStorage = prevStorage;
      globalThis.document = prevDocument;
    }
  });

  test("Office Shell exposes skip link, #main landmark, language toggle, and takos-language sync", () => {
    const html = renderShellPage();
    expect(html).toContain('class="skip-link" href="#main"');
    expect(html).toContain('<main id="main" tabindex="-1">');
    expect(html).toContain('id="lang-toggle"');
    expect(html).toContain('"takos-language"');
    expect(html).toContain("ワークスペース");
  });
});

describe("Wave 2 suite-wide UI/UX contracts", () => {
  test("no native window.confirm() or window.prompt() calls remain in app runtime code", () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(ROOT)) {
      const src = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      if (/\b(?:window\.|globalThis\.)?(?:confirm|prompt)\(/.test(src)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("all three SPA entry HTML files synchronize takos-language and data-theme pre-hydration", () => {
    for (const rel of ["docs/index.html", "slide/index.html", "sheet/index.html"]) {
      const html = readFileSync(join(ROOT, rel), "utf8");
      expect(html).toContain("takos-language");
      expect(html).toContain("data-theme");
    }
  });

  test("Slides editor supports Alt+Arrow slide reorder, Arrow element nudge, and accessible slide reorder buttons", () => {
    const editorSrc = readFileSync(join(ROOT, "slide/src/pages/EditorPage.tsx"), "utf8");
    const panelSrc = readFileSync(join(ROOT, "slide/src/components/SlidePanel.tsx"), "utf8");
    expect(editorSrc).toContain("getArrowNudgeDelta");
    expect(editorSrc).toContain('e.key === "ArrowUp" || e.key === "ArrowDown"');
    expect(editorSrc).toContain("PromptDialog");
    expect(editorSrc).toContain("ConfirmDialog");
    expect(panelSrc).toContain("moveSlideUp");
    expect(panelSrc).toContain("moveSlideDown");
  });
});
