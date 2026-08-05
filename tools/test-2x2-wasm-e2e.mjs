import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cube2x2x2 } from "../vendor/cubing/puzzles/index.js";
import { solve2x2Scramble } from "../solver/solver2x2.js";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const wasm = require(path.join(ROOT_DIR, "target/wasm-node/solver_wasm.js"));

if (typeof wasm.solve_json !== "function") {
  throw new Error("WASM_SOLVE_JSON_EXPORT_MISSING");
}

const loader = typeof cube2x2x2 === "function" ? await cube2x2x2() : cube2x2x2;
const puzzle = await loader.kpuzzle();
const solvedPattern = puzzle.defaultPattern();

const WASM_CASES = readPositiveInteger("WASM_CASES", 10_000);
const JS_CASES = readPositiveInteger("JS_CASES", 300);
const SCRAMBLE_LENGTH = readPositiveInteger("SCRAMBLE_LENGTH", 11);
const SUFFIXES = ["", "2", "'"];

function readPositiveInteger(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function createScramble(rng, faces, length) {
  const moves = [];
  let previousFace = "";
  for (let index = 0; index < length; index += 1) {
    let face = faces[Math.floor(rng() * faces.length)];
    while (face === previousFace) {
      face = faces[Math.floor(rng() * faces.length)];
    }
    previousFace = face;
    moves.push(face + SUFFIXES[Math.floor(rng() * SUFFIXES.length)]);
  }
  return moves.join(" ");
}

function isSolved(pattern) {
  return typeof pattern.experimentalIsSolved === "function"
    ? !!pattern.experimentalIsSolved({ ignorePuzzleOrientation: false })
    : JSON.stringify(pattern.patternData) === JSON.stringify(solvedPattern.patternData);
}

function verifySolution(scramble, solution) {
  const scrambled = scramble ? solvedPattern.applyAlg(scramble) : solvedPattern;
  const finalPattern = solution ? scrambled.applyAlg(solution) : scrambled;
  return isSolved(finalPattern);
}

function parseWasmResponse(scramble) {
  const raw = wasm.solve_json(JSON.stringify({ scramble, event_id: "222" }));
  let parsed;
  try {
    parsed = JSON.parse(String(raw || ""));
  } catch (error) {
    throw new Error(`WASM_BAD_JSON scramble=${JSON.stringify(scramble)} raw=${JSON.stringify(raw)} cause=${error}`);
  }
  return parsed;
}

const wasmStart = performance.now();
const wasmRng = createRng(0x2f2f_2026);
for (let index = 0; index < WASM_CASES; index += 1) {
  const scramble = createScramble(wasmRng, ["U", "F", "R"], SCRAMBLE_LENGTH);
  const result = parseWasmResponse(scramble);
  if (!result?.ok) {
    throw new Error(
      `WASM_SOLVE_FAILED case=${index} scramble=${JSON.stringify(scramble)} reason=${result?.reason || "UNKNOWN"}`,
    );
  }
  const solution = String(result.solution || "").trim();
  if (!verifySolution(scramble, solution)) {
    throw new Error(
      `WASM_INVALID_SOLUTION case=${index} scramble=${JSON.stringify(scramble)} solution=${JSON.stringify(solution)}`,
    );
  }
  const countedMoves = solution ? solution.split(/\s+/).filter(Boolean).length : 0;
  if (Number(result.move_count ?? result.moveCount) !== countedMoves) {
    throw new Error(
      `WASM_MOVE_COUNT_MISMATCH case=${index} expected=${countedMoves} actual=${result.move_count ?? result.moveCount}`,
    );
  }
  if ((index + 1) % 1_000 === 0) {
    console.log(`WASM verified ${index + 1}/${WASM_CASES}`);
  }
}
const wasmElapsed = performance.now() - wasmStart;

for (const scramble of ["D", "L2", "B'", "U D R", "F2 B2 U'"]) {
  const result = parseWasmResponse(scramble);
  if (result?.ok) {
    throw new Error(`WASM_ACCEPTED_UNSUPPORTED_MOVE scramble=${JSON.stringify(scramble)}`);
  }
}

const jsStart = performance.now();
const jsRng = createRng(0x18fa_11ba);
for (let index = 0; index < JS_CASES; index += 1) {
  const scramble = createScramble(jsRng, ["U", "R", "F", "D", "L", "B"], SCRAMBLE_LENGTH);
  const result = await solve2x2Scramble(scramble);
  if (!result) {
    throw new Error(`JS_FALLBACK_NO_SOLUTION case=${index} scramble=${JSON.stringify(scramble)}`);
  }
  const solution = String(result.solution || "").trim();
  if (!verifySolution(scramble, solution)) {
    throw new Error(
      `JS_FALLBACK_INVALID_SOLUTION case=${index} scramble=${JSON.stringify(scramble)} solution=${JSON.stringify(solution)}`,
    );
  }
  if ((index + 1) % 100 === 0) {
    console.log(`JS fallback verified ${index + 1}/${JS_CASES}`);
  }
}
const jsElapsed = performance.now() - jsStart;

console.log(
  JSON.stringify(
    {
      ok: true,
      wasmCases: WASM_CASES,
      jsFallbackCases: JS_CASES,
      scrambleLength: SCRAMBLE_LENGTH,
      wasmElapsedMs: Math.round(wasmElapsed),
      jsElapsedMs: Math.round(jsElapsed),
    },
    null,
    2,
  ),
);
