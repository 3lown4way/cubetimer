import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { cube3x3x3 } from "../vendor/cubing/puzzles/index.js";
import * as solver444 from "../public/solver444-wasm/solver444_wasm.js";

if (typeof solver444.initSync === "function") {
  const wasmPath = fileURLToPath(new URL("../public/solver444-wasm/solver444_wasm_bg.wasm", import.meta.url));
  solver444.initSync({ module: fs.readFileSync(wasmPath) });
}

const loader = typeof cube3x3x3 === "function" ? await cube3x3x3() : cube3x3x3;
const kpuzzle = await loader.kpuzzle();

function findOrbit(patternData, count) {
  const matches = Object.values(patternData || {}).filter((orbit) => {
    const pieces = orbit?.pieces ?? orbit?.permutation;
    return pieces?.length === count && orbit?.orientation?.length === count;
  });
  assert.equal(matches.length, 1, `orbit ${count} must be unique`);
  const orbit = matches[0];
  return {
    pieces: Array.from(orbit.pieces ?? orbit.permutation, Number),
    orientation: Array.from(orbit.orientation, Number),
  };
}

function cubieFor333(move) {
  const pattern = kpuzzle.defaultPattern().applyAlg(move).patternData;
  const corners = findOrbit(pattern, 8);
  const edges = findOrbit(pattern, 12);
  return {
    cp: corners.pieces,
    co: corners.orientation,
    ep: edges.pieces,
    eo: edges.orientation,
  };
}

const bridgeCases = [
  ["U", "U'"], ["U2", "U2"], ["U'", "U"],
  ["R", "R'"], ["R2", "R2"], ["R'", "R"],
  ["F", "F"], ["F2", "F2"], ["F'", "F'"],
  ["D", "D'"], ["D2", "D2"], ["D'", "D"],
  ["L", "L'"], ["L2", "L2"], ["L'", "L"],
  ["B", "B"], ["B2", "B2"], ["B'", "B'"],
];

for (const [physical444Move, equivalent333Move] of bridgeCases) {
  const response = JSON.parse(solver444.solve_444_json(JSON.stringify({
    scramble: physical444Move,
    deadlineTs: 0,
  })));
  assert.equal(response.meta.virtual333Ready, true, physical444Move);
  assert.equal(response.stages[1].moveCount, 0, `${physical444Move} must preserve pairing`);
  assert.deepEqual(
    response.meta.virtual333,
    cubieFor333(equivalent333Move),
    `${physical444Move} must project as ${equivalent333Move}`,
  );
}

console.log("4x4 projection and 3x3 cubie convention contract passed");
