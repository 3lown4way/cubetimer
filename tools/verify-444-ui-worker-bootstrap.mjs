import assert from "node:assert/strict";
import fs from "node:fs";
const ui = fs.readFileSync(new URL("../solver/solver444UiActivation.js", import.meta.url), "utf8");
const preview = fs.readFileSync(new URL("../solver/nxnTwistyPreview.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const methodOptions = /<select id="solver444MethodSelect">([\s\S]*?)<\/select>/.exec(html)?.[1];
const defaultMethod = /<option value="([^"]+)" selected>/.exec(methodOptions)?.[1];
assert.equal(defaultMethod, "yau", "the 4x4 solver should open in Yau mode");
assert.match(ui, /WORKER_BOOT_TIMEOUT_MS = 8_000/);
assert.match(ui, /workerUrl\.searchParams\.set\("v", WORKER_BUILD_TOKEN\)/);
assert.match(ui, /workerUrl\.searchParams\.set\("reload", String\(Date\.now\(\)\)\)/);
assert.match(ui, /client\.worker\.addEventListener\("error", onError\)/);
assert.match(ui, /client\.worker\.addEventListener\("messageerror", onMessageError\)/);
assert.match(ui, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/);
assert.match(ui, /withUiTimeout\(\s*api\.solve\(/);
assert.match(preview, /solver444UiActivation\.js\?v=20261125-yau-default-1/);
console.log("4x4 UI worker bootstrap timeout, retry, and cache-bust contract passed");

const elements = new Map();
const mutationCallbacks = new Map();
const workers = [];

function element(id) {
  if (!elements.has(id)) {
    const attrs = new Map();
    const listeners = new Map();
    elements.set(id, {
      dataset: {},
      disabled: false,
      textContent: "",
      value: "",
      listeners,
      addEventListener: (type, listener) => listeners.set(type, listener),
      closest: () => null,
      querySelectorAll: () => [],
      getAttribute: (name) => attrs.get(name) ?? null,
      setAttribute: (name, value) => attrs.set(name, value),
    });
  }
  return elements.get(id);
}

globalThis.window = { setTimeout, clearTimeout };
globalThis.document = { getElementById: element, querySelector: () => null };
globalThis.MutationObserver = class {
  constructor(callback) { this.callback = callback; }
  observe(target) { mutationCallbacks.set(target, this.callback); }
};
globalThis.Worker = class {
  constructor() {
    workers.push(this);
    this.api = {
      ping: () => new Promise((resolve) => { this.finishBoot = resolve; }),
      solve: (input) => new Promise((resolve, reject) => {
        this.input = input;
        this.finishSolve = resolve;
        this.failSolve = reject;
      }),
    };
  }
  addEventListener() {}
  removeEventListener() {}
  terminate() { this.terminated = true; }
};

const uiUrl = new URL("../solver/solver444UiActivation.js", import.meta.url);
const stubbedUi = ui
  .replace('import { proxy, wrap } from "comlink";', 'const proxy = (fn) => fn; const wrap = (worker) => worker.api;')
  .replace('import { TwistyPlayer } from "cubing/twisty";', "")
  .replaceAll("import.meta.url", JSON.stringify(uiUrl.href));
const { installSolver444UiActivation } = await import(`data:text/javascript,${encodeURIComponent(stubbedUi)}`);
const button = element("findSolutionBtn");
const scrambleText = element("scrambleText");
const previewElement = element("scramblePreview");
const methodSelect = element("solver444MethodSelect");
methodSelect.value = defaultMethod;
element("eventSelect").value = "444";
previewElement.setAttribute("event", "444");
scrambleText.textContent = "스크램블 생성중...";
assert.ok(installSolver444UiActivation());
await Promise.resolve();

const clickSolve = () => button.listeners.get("click")();
assert.match(button.title, /4×4 Yau/);
assert.equal(button.disabled, true);
await clickSolve();
assert.equal(workers.length, 0, "loading text must not reach the worker");

function showScramble(text, algorithm = text) {
  scrambleText.textContent = text;
  previewElement.setAttribute("scramble", algorithm);
  mutationCallbacks.get(scrambleText)();
}

showScramble("Uw2 F Rw");
assert.equal(button.disabled, false);
const pendingBoot = clickSolve();
methodSelect.value = "reduction";
methodSelect.listeners.get("change")();
assert.equal(workers[0].terminated, true);
const pendingSolve = clickSolve();
workers[1].finishBoot({ ok: true });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(workers[1].input.scramble, "Uw2 F Rw");
assert.equal(workers[1].input.method444, "reduction", "explicit Reduction must reach the worker");
await pendingBoot;
assert.equal(workers[1].terminated, undefined, "an old boot cannot terminate its replacement");

showScramble("스크램블 생성 실패", "Uw2 F Rw");
assert.equal(workers[1].terminated, true);
assert.equal(button.disabled, true);
showScramble("U2 Fw Rw");
methodSelect.value = defaultMethod;
methodSelect.listeners.get("change")();
const replacement = clickSolve();
workers[2].finishBoot({ ok: true });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(workers[2].input.scramble, "U2 Fw Rw");
assert.equal(workers[2].input.method444, "yau", "the default Yau mode must reach the worker");
workers[1].failSolve(new Error("stale worker failure"));
await pendingSolve;
assert.equal(workers[2].terminated, undefined, "an old solve cannot terminate its replacement");
workers[2].finishSolve({ ok: false, reason: "444_YAU_EDGE_PAIRING_FAILED" });
await replacement;
assert.equal(button.disabled, false);
assert.match(element("solverStatus").textContent, /엣지 페어링/);
console.log("4x4 scramble readiness and stale worker cancellation passed");
