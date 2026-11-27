import assert from "node:assert/strict";
import fs from "node:fs";
import { Alg } from "../vendor/cubing/alg/index.js";
import { puzzles } from "../vendor/cubing/puzzles/index.js";
import { TreeAlgIndexer } from "../vendor/cubing/twisty/index.js";
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
assert.match(preview, /solver444UiActivation\.js\?v=20261127-yau-working-turns-1/);
console.log("4x4 UI worker bootstrap timeout, retry, and cache-bust contract passed");

const elements = new Map();
const mutationCallbacks = new Map();
const workers = [];
const players = [];
const puzzle = await puzzles["4x4x4"].kpuzzle();

function newElement(tagName) {
  const attrs = new Map();
  const listeners = new Map();
  let textContent = "";
  return {
    tagName, dataset: {}, style: {}, children: [], disabled: false, value: "", listeners,
    get textContent() { return textContent; },
    set textContent(value) { textContent = value; this.children = []; },
    addEventListener: (type, listener) => listeners.set(type, listener),
    closest: () => null,
    querySelectorAll: () => [],
    getAttribute: (name) => attrs.get(name) ?? null,
    setAttribute: (name, value) => attrs.set(name, value),
    appendChild(child) { this.children.push(child); },
    append(...children) { this.children.push(...children); },
  };
}

function element(id) {
  if (!elements.has(id)) elements.set(id, newElement());
  return elements.get(id);
}

globalThis.window = { setTimeout, clearTimeout };
globalThis.document = { getElementById: element, querySelector: () => null, createElement: newElement };
globalThis.PlaybackTestPlayer = class {
  dataset = {};
  style = {};
  experimentalModel = {
    indexer: { get: async () => new TreeAlgIndexer(puzzle, new Alg(this.alg)) },
  };
  constructor(config) { this.config = config; players.push(this); }
  pause() {}
  remove() {}
};
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
  .replace('"./smoothCubeCamera.js"', JSON.stringify(new URL("../solver/smoothCubeCamera.js", import.meta.url).href))
  .replace('import { proxy, wrap } from "comlink";', 'const proxy = (fn) => fn; const wrap = (worker) => worker.api;')
  .replace('import { TwistyPlayer } from "cubing/twisty";', "const TwistyPlayer = globalThis.PlaybackTestPlayer;")
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

const outdated = clickSolve();
await new Promise((resolve) => setImmediate(resolve));
workers[2].finishSolve({ ok: true, verified: true, solution: "R U", meta: { method444: "yau" } });
await outdated;
assert.equal(players.length, 0, "an old worker result without checkpoint verification must stay hidden");
assert.match(element("solverStatus").textContent, /재생 상태/);

const incompatible = clickSolve();
await new Promise((resolve) => setImmediate(resolve));
workers[2].finishSolve({ ok: true, verified: true, solution: "R 3Uw2 2L", meta: { method444: "yau", yauPlaybackVerified: true } });
await incompatible;
assert.equal(players.length, 0, "old Yau layer notation must stay out of playback and copy");
assert.equal(element("solverCopyBtn").disabled, true);
assert.match(element("solverStatus").textContent, /재생 상태/);

const accepted = clickSolve();
await new Promise((resolve) => setImmediate(resolve));
const solution = "x Lw x' U Uw2 F'";
workers[2].finishSolve({
  ok: true, verified: true, solution, moveCount: 4,
  meta: { method444: "yau", yauPlaybackVerified: true },
  stages: [{ id: "centers", method: "Yau", solution, segments: [
    { id: "yauCross3", name: "Cross 3/4", solution: "x Lw x' U", segments: [
      { id: "yauCross3_1", name: "Cross Edge 3/3", solution: "x Lw x' U", viewpointRotations: 2 },
    ] },
    { id: "yauRemainingCenters", name: "Remaining 4 Centers", solution: "Uw2 F'" },
  ] }],
});
await accepted;
assert.equal(players.length, 1);
const [player] = players;
assert.equal(player.config.indexer, "tree");
assert.equal(player.config.cameraLongitude, -30, "Yau playback must show the held left face");
assert.equal(player.experimentalSetupAlg, "U2 Fw Rw");
assert.equal(player.alg, solution);
const cross = element("solverStageList").children.find((item) => item.dataset.solver444Stage === "yauCross3_1");
assert.ok(cross, "individual cross insertions must be displayed and seekable");
const displayed = cross.children.flatMap((item) => {
  if (item.className === "stage-notes") {
    assert.equal(item.textContent, "큐브 방향 전환 · ");
    return [item.children[0].textContent];
  }
  return item.tagName === "code" ? [item.textContent] : [];
});
assert.deepEqual(displayed, ["x", "Lw", "x'", "U"], "grip changes must be identified in execution order");
cross.children.find((item) => item.type === "button").listeners.get("click")();
assert.equal(player.timestamp, 4000, "the checkpoint must include the interleaved regrip");
assert.match(element("solverStepLabel").textContent, /^4\/6 동작 · Cross Edge 3\/3$/);
const event = { preventDefault() {}, stopImmediatePropagation() {} };
element("solverStepNextBtn").listeners.get("click")(event);
assert.equal(player.timestamp, 5500, "Uw2 must advance by one half turn");
element("solverStepPrevBtn").listeners.get("click")(event);
assert.equal(player.timestamp, 4000, "seeking backward must use the same renderer timestamp");
console.log("4x4 verified Yau checkpoint buttons use the renderer's move boundaries");
