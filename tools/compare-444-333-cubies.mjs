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
  const matches = Object.entries(patternData || {}).filter(([, orbit]) => {
    const pieces = orbit?.pieces ?? orbit?.permutation;
    return pieces?.length === count && orbit?.orientation?.length === count;
  });
  if (matches.length !== 1) throw new Error(`orbit ${count} ambiguous: ${matches.map(([name]) => name).join(",")}`);
  const [name, orbit] = matches[0];
  return {
    name,
    pieces: Array.from(orbit.pieces ?? orbit.permutation, Number),
    orientation: Array.from(orbit.orientation, Number),
  };
}

function inverseCubie(state) {
  const cp = Array(8).fill(0);
  const co = Array(8).fill(0);
  const ep = Array(12).fill(0);
  const eo = Array(12).fill(0);
  for (let pos = 0; pos < 8; pos += 1) {
    const piece = state.cp[pos];
    cp[piece] = pos;
    co[piece] = (3 - state.co[pos]) % 3;
  }
  for (let pos = 0; pos < 12; pos += 1) {
    const piece = state.ep[pos];
    ep[piece] = pos;
    eo[piece] = state.eo[pos];
  }
  return { cp, co, ep, eo };
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

for (const move of ["U", "U'", "R", "R'", "F", "F'", "D", "L", "B"]) {
  const response = JSON.parse(solver444.solve_444_json(JSON.stringify({ scramble: move, deadlineTs: 0 })));
  const projected = response.meta.virtual333;
  const pattern = kpuzzle.defaultPattern().applyAlg(move).patternData;
  const corners = findOrbit(pattern, 8);
  const edges = findOrbit(pattern, 12);
  const expected = {
    cp: corners.pieces,
    co: corners.orientation,
    ep: edges.pieces,
    eo: edges.orientation,
  };
  const inverse = inverseCubie(projected);
  console.log(JSON.stringify({
    move,
    projected,
    expected,
    exact: same(projected, expected),
    inverseExact: same(inverse, expected),
  }));
}
