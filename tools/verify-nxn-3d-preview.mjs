import assert from "node:assert/strict";
import fs from "node:fs";

import {
  NXN_EVENT_TO_PUZZLE,
  NXN_PREVIEW_MODE_KEY,
  createNxNPreviewController,
  resolveNxNPuzzle,
} from "../preview/nxn3dPreview.js";

class FakeClassList {
  constructor() {
    this.values = new Set();
  }
  add(value) {
    this.values.add(value);
  }
  toggle(value, enabled) {
    if (enabled) this.values.add(value);
    else this.values.delete(value);
  }
  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement {
  constructor(mode = "") {
    this.dataset = mode ? { previewMode: mode } : {};
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.children = [];
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.listeners = new Map();
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  addEventListener(type, callback) {
    this.listeners.set(type, callback);
  }
  click() {
    this.listeners.get("click")?.();
  }
  append(child) {
    this.children.push(child);
  }
  replaceChildren() {
    this.children = [];
  }
}

class FakeTwistyPlayer extends FakeElement {
  static instances = [];
  constructor(options) {
    super();
    this.options = options;
    this.paused = false;
    FakeTwistyPlayer.instances.push(this);
  }
  pause() {
    this.paused = true;
  }
}

const expectedMapping = {
  "222": "2x2x2",
  "333": "3x3x3",
  "333oh": "3x3x3",
  "333bf": "3x3x3",
  "333fm": "3x3x3",
  "333mbf": "3x3x3",
  "444": "4x4x4",
  "444bf": "4x4x4",
  "555": "5x5x5",
  "555bf": "5x5x5",
  "666": "6x6x6",
  "777": "7x7x7",
};
assert.deepEqual({ ...NXN_EVENT_TO_PUZZLE }, expectedMapping);
assert.equal(resolveNxNPuzzle("444"), "4x4x4");
assert.equal(resolveNxNPuzzle("clock"), null);

const storageValues = new Map();
const storage = {
  getItem: (key) => storageValues.get(key) ?? null,
  setItem: (key, value) => storageValues.set(key, String(value)),
};
const twoDPreview = new FakeElement();
const threeDHost = new FakeElement();
const twoDButton = new FakeElement("2D");
const threeDButton = new FakeElement("3D");
const puzzleLabel = new FakeElement();
const modeStatus = new FakeElement();

const controller = createNxNPreviewController({
  TwistyPlayer: FakeTwistyPlayer,
  twoDPreview,
  threeDHost,
  modeButtons: [twoDButton, threeDButton],
  puzzleLabel,
  modeStatus,
  storage,
});

controller.setScramble("Rw U2 Rw'", "444");
assert.equal(twoDPreview.attributes.get("event"), "444");
assert.equal(twoDPreview.attributes.get("scramble"), "Rw U2 Rw'");
assert.equal(twoDPreview.hidden, true);
assert.equal(threeDHost.hidden, false);
assert.equal(FakeTwistyPlayer.instances.length, 1);
assert.equal(FakeTwistyPlayer.instances[0].options.puzzle, "4x4x4");
assert.equal(FakeTwistyPlayer.instances[0].experimentalSetupAlg, "Rw U2 Rw'");
assert.equal(FakeTwistyPlayer.instances[0].alg, "");
assert.equal(FakeTwistyPlayer.instances[0].timestamp, "end");
assert.equal(puzzleLabel.textContent, "4×4×4");
assert.equal(threeDButton.classList.contains("active"), true);

// Reusing the same puzzle must not rebuild the player.
controller.setScramble("Uw2 Fw", "444bf");
assert.equal(FakeTwistyPlayer.instances.length, 1);
assert.equal(FakeTwistyPlayer.instances[0].experimentalSetupAlg, "Uw2 Fw");

// Changing NxN size rebuilds the player with the matching puzzle geometry.
controller.setScramble("3Rw U 3Rw'", "777");
assert.equal(FakeTwistyPlayer.instances.length, 2);
assert.equal(FakeTwistyPlayer.instances[1].options.puzzle, "7x7x7");

// User-selected 2D mode is persisted.
twoDButton.click();
assert.equal(controller.getMode(), "2D");
assert.equal(storageValues.get(NXN_PREVIEW_MODE_KEY), "2D");
assert.equal(twoDPreview.hidden, false);
assert.equal(threeDHost.hidden, true);

// Unsupported events always use the existing 2D preview and disable 3D.
controller.setMode("3D");
controller.setScramble("UR3+ DR2+", "clock");
assert.equal(twoDPreview.hidden, false);
assert.equal(threeDHost.hidden, true);
assert.equal(threeDButton.disabled, true);
assert.match(modeStatus.textContent, /2D/);

const mainSource = fs.readFileSync(new URL("../main.js", import.meta.url), "utf8");
const indexSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const previewSource = fs.readFileSync(new URL("../preview/nxn3dPreview.js", import.meta.url), "utf8");
assert.match(mainSource, /nxnPreviewController.setScramble(currentScramble, eventId)/);
assert.match(indexSource, /id="scramblePreview3DHost"/);
assert.match(indexSource, /data-preview-mode="3D"/);
assert.match(indexSource, /preview\/nxn3dPreview\.css/);
assert.doesNotMatch(previewSource, /window.open|twizzle.net|alg.cubing.net/);

console.log("NxNxN 3D preview contract passed");
