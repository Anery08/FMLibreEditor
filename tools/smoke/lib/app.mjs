// One copy of FMLibreEditor started for a smoke run, driven over the Chrome DevTools Protocol (CDP) of its WebView2.
//
// Each copy gets a WebView2 profile of its own (otherwise it would join a copy that is already open, which has no
// debugging port) and a data folder of its own, so that what it freezes never mixes with the frozen.json of the copy
// you use, and its exports stay in the run's folder.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * In the page: whether an element is on screen. The list views that are not shown stay laid out under
 * `visibility: hidden` (`.workspace.inactive`), so having client rects is not enough.
 */
export const SHOWN = `((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden")`;

/** In the page: the first element for a selector that is on screen. */
export const VIS = `((sel, root = document) => [...root.querySelectorAll(sel)].find(${SHOWN}))`;

/**
 * In the page: a masthead tab's own name, without the number of changes the Changes tab adds in a `<small>`. From its
 * text nodes rather than `innerText`, which follows the style sheet.
 */
const TAB_NAME = `((b) => [...b.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("").trim())`;

/** In the page: whether it has loaded, with Tauri's interface in it. */
const LOADED = `(document.readyState === "complete" && "__TAURI_INTERNALS__" in window)`;

/**
 * In the page: whether the app is done starting. It asks for the connection it may have, then looks for the game; both
 * calls are over once its connect panel (or, connected, its lists) is up with nothing busy in the masthead.
 */
const STARTED = `(!!document.querySelector(".connect, .views") && !document.querySelector(".masthead .busy"))`;

/**
 * In the page: how many calls to the app are out. Tauri 2 keeps their callbacks in `__TAURI_INTERNALS__.callbacks` until
 * the answer comes back; an event listened to would keep one there too, but the app listens to none.
 */
const CALLS_OUT = `(window.__TAURI_INTERNALS__.callbacks?.size ?? 0)`;

const KEYS = { Escape: 27, Tab: 9, Enter: 13 };

/** The CDP address of the app's page, once its WebView2 is up. */
async function pageUrl(port, child) {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`the app exited with code ${child.exitCode}`);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((target) => target.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(500);
  }
  throw new Error(`no WebView2 page on port ${port}`);
}

export class App {
  /**
   * Starts the app at `exe` with its own folders under `folder`, attaches to it, and switches it to English, so that
   * tests can go by the words on screen. `env` adds to the environment, e.g. FMLIBRE_IGNORE_PROFILES.
   */
  static async start({ exe, port, folder, env = {} }) {
    mkdirSync(folder, { recursive: true });
    const child = spawn(exe, [], {
      env: {
        ...process.env,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
        WEBVIEW2_USER_DATA_FOLDER: join(folder, "webview"),
        FMLIBRE_DATA: join(folder, "data"),
        FMLIBRE_EXPORTS: join(folder, "exports"),
        ...env,
      },
      stdio: "ignore",
    });
    const app = new App(child, folder);
    try {
      await app.attach(await pageUrl(port, child));
      await app.waitFor(LOADED, "the page", 60000);
      // The language is read as the page loads, so it is saved and the page loaded again; not before the first page is
      // done starting, though. A reload cuts short the calls the page has out: it logs "IPC custom protocol failed ...
      // Failed to fetch", and the new page "[TAURI] Couldn't find callback id" when the answer comes back to it. Looking
      // for the game (`detect_game`) can take seconds while the machine is busy. Its quick calls (its version, the
      // graphics packs) get five seconds at most, as an event listened to would keep a callback there for good: the
      // console check tells of a call cut short.
      await app.waitFor(STARTED, "the app to look for the game", 90000);
      await app.waitFor(`${CALLS_OUT} === 0`, "the app's calls to come back", 5000).catch(() => {});
      await app.js(`localStorage.setItem("fmlibre.locale", "en"); window.smokeOldPage = true`);
      await app.send("Page.reload");
      await app.waitFor(`!window.smokeOldPage && ${LOADED}`, "the page in English", 60000);
    } catch (err) {
      app.close();
      throw err;
    }
    return app;
  }

  constructor(child, folder) {
    this.child = child;
    this.folder = folder;
    this.nextId = 1;
    this.pending = new Map();
    /** Errors and warnings the page logged, and exceptions it threw. */
    this.consoleProblems = [];
    /** Failed requests, e.g. a missing logo, which is expected where a graphics pack has none. */
    this.networkErrors = [];
  }

  async attach(url) {
    this.ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        this.consoleProblems.push(`exception: ${d.exception?.description ?? d.text}`);
      } else if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning", "assert"].includes(msg.params.type)) {
        this.consoleProblems.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
      } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
        const { source, text, url: where } = msg.params.entry;
        (source === "network" ? this.networkErrors : this.consoleProblems).push(`${source}: ${text} ${where ?? ""}`);
      }
    };
    await this.send("Runtime.enable");
    await this.send("Page.enable");
    await this.send("Log.enable");
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluates `expression` in the page and returns its value. */
  async js(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  /** Waits until `expression` is truthy in the page (an element found counts), and returns its value. */
  async waitFor(expression, what, timeout = 20000) {
    const start = Date.now();
    let last;
    while (Date.now() - start < timeout) {
      try {
        const value = await this.js(`(() => { const v = (${expression}); return v instanceof Node ? true : v; })()`);
        if (value) return value;
      } catch (err) {
        last = err;
      }
      await sleep(150);
    }
    throw new Error(`timed out waiting for ${what}${last ? ` (${last.message})` : ""}`);
  }

  /** Calls one of the app's commands as its own interface does: `{ ok, value }` or `{ ok: false, error }`. */
  invoke(command, args = {}) {
    return this.js(
      `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})` +
        `.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }))`,
    );
  }

  /** Calls one of the app's commands and returns its value; throws what it failed with. */
  async must(command, args = {}) {
    const r = await this.invoke(command, args);
    if (!r.ok) throw new Error(`${command} failed: ${JSON.stringify(r.error)}`);
    return r.value;
  }

  async clickAt(x, y) {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await sleep(150);
  }

  /** Clicks the element `elementExpression` finds as a person would: scrolled to, and at its middle once at rest. */
  async click(elementExpression, what) {
    const found = await this.js(`(() => {
      document.querySelectorAll("[data-smoke-click]").forEach((e) => e.removeAttribute("data-smoke-click"));
      const el = ${elementExpression};
      if (!el) return false;
      el.setAttribute("data-smoke-click", "1");
      const b = el.getBoundingClientRect();
      if (b.top < 0 || b.bottom > innerHeight) el.scrollIntoView({ block: "center", inline: "nearest" });
      return true;
    })()`);
    if (!found) throw new Error(`nothing to click: ${what}`);
    let at = null;
    for (let i = 0; i < 10; i++) {
      await sleep(120);
      const now = await this.js(`(() => {
        const b = document.querySelector("[data-smoke-click]").getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      })()`);
      if (at && now.x === at.x && now.y === at.y) break;
      at = now;
    }
    await this.clickAt(at.x, at.y);
  }

  async press(key, shift = false) {
    const code = KEYS[key];
    const base = { key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: shift ? 8 : 0 };
    await this.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    await sleep(150);
  }

  /** Types `value` into the input `elementExpression` finds, the way React hears it. */
  setInput(elementExpression, value) {
    return this.js(`(() => {
      const el = ${elementExpression};
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, ${JSON.stringify(String(value))});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value;
    })()`);
  }

  /** Saves a screenshot as `<name>.png` in the run's folder and returns its path. */
  async shot(name) {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    const file = join(this.folder, `${name}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    return file;
  }

  /** Connects to the game through the Connect button, and returns what the app knows about the connection. */
  async connect() {
    await this.waitFor(
      `!!document.querySelector(".connect .primary:not([disabled])") || !!document.querySelector(".views")`,
      "the Connect button",
      90000,
    );
    if (await this.js(`!document.querySelector(".views")`)) {
      await this.click(`document.querySelector(".connect .primary")`, "Connect");
    }
    await this.waitFor(`!!document.querySelector(".views") && !document.querySelector(".masthead .busy")`, "the lists", 180000);
    return this.must("current_connection");
  }

  /**
   * Opens one of the masthead's tabs by its English name: "Players", "Staff", "Clubs" or "Changes". By name, as builds
   * differ in their tabs: one with a Scouting tab has it before Changes.
   */
  async openTab(name) {
    const tabs = `[...document.querySelectorAll("nav.tabs button")]`;
    const names = await this.js(`${tabs}.map(${TAB_NAME})`);
    if (!names.includes(name)) throw new Error(`no ${name} tab: the tabs are ${names.join(", ")}`);
    const tab = `${tabs}.find((b) => ${TAB_NAME}(b) === ${JSON.stringify(name)})`;
    await this.click(tab, `the ${name} tab`);
    await this.waitFor(`${tab}.classList.contains("active")`, `the ${name} tab`);
    await sleep(400);
  }

  /** Opens a club's profile from the Clubs tab, by its exact name. */
  async openClub(name) {
    await this.openTab("Clubs");
    await this.waitFor(`${VIS}(".search input")`, "the clubs' search");
    await this.setInput(`${VIS}(".search input")`, name);
    const rows = `[...document.querySelectorAll("table.grid tbody tr")].filter(${SHOWN})`;
    const row = `${rows}.find((tr) => [...tr.querySelectorAll("td, td *")].some((c) => c.textContent.trim() === ${JSON.stringify(name)}))`;
    await this.waitFor(row, `the row of ${name}`);
    await sleep(600);
    await this.click(row, `the row of ${name}`);
    await this.waitFor(`${VIS}(".profile-tabs [role=tab]")`, "the club's tabs", 30000);
  }

  close() {
    try {
      this.ws?.close();
    } catch {}
    this.child.kill();
  }
}
