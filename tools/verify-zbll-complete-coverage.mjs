import { KPattern } from "../vendor/cubing/kpuzzle/index.js";
import { cube3x3x3 } from "../vendor/cubing/puzzles/index.js";
import { buildZbllCaseIndexData } from "../solver/cfop3x3.js";
import { ZBLL_SUPPLEMENTAL_CASES } from "../solver/zbllSupplementalCases.js";

const kpuzzle = await cube3x3x3.kpuzzle();
const solved = kpuzzle.defaultPattern();
const baseLibrary = await buildZbllCaseIndexData();
const supplemental = new Map(ZBLL_SUPPLEMENTAL_CASES);

function permutations(values) {
  const out = [];
  const used = new Array(values.length).fill(false);
  const path = [];
  function visit() {
    if (path.length === values.length) {
      out.push(path.slice());
      return;
    }
    for (let index = 0; index < values.length; index += 1) {
      if (used[index]) continue;
      used[index] = true;
      path.push(values[index]);
      visit();
      path.pop();
      used[index] = false;
    }
  }
  visit();
  return out;
}

function parity(values) {
  let result = 0;
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      if (values[i] > values[j]) result ^= 1;
    }
  }
  return result;
}

function orbitKey(orbit, positions) {
  const parts = [];
  for (const position of positions) {
    parts.push(`p${orbit.pieces[position]}`, `o${orbit.orientation[position]}`);
  }
  return parts.join(",");
}

function keyFor(data) {
  return `ZC:${orbitKey(data.CORNERS, [0, 1, 2, 3])}|ZE:${orbitKey(data.EDGES, [0, 1, 2, 3])}`;
}

function isSolved(pattern) {
  return pattern.experimentalIsSolved({ ignorePuzzleOrientation: false });
}

function applyMoves(pattern, moves) {
  try {
    let next = pattern;
    for (const move of moves) next = next.applyMove(move);
    return next;
  } catch {
    return null;
  }
}

const perms = permutations([0, 1, 2, 3]);
let legalStates = 0;
let requiredStates = 0;
let baseCovered = 0;
let supplementalCovered = 0;
const uncovered = [];
const invalidSupplements = [];

for (const cp of perms) {
  const cpParity = parity(cp);
  for (const ep of perms) {
    if (parity(ep) !== cpParity) continue;
    for (let o0 = 0; o0 < 3; o0 += 1) {
      for (let o1 = 0; o1 < 3; o1 += 1) {
        for (let o2 = 0; o2 < 3; o2 += 1) {
          const orientations = [o0, o1, o2, (3 - ((o0 + o1 + o2) % 3)) % 3];
          const data = structuredClone(solved.patternData);
          for (let position = 0; position < 4; position += 1) {
            data.CORNERS.pieces[position] = cp[position];
            data.CORNERS.orientation[position] = orientations[position];
            data.EDGES.pieces[position] = ep[position];
            data.EDGES.orientation[position] = 0;
          }
          const pattern = new KPattern(kpuzzle, data);
          legalStates += 1;
          if (isSolved(pattern)) continue;
          requiredStates += 1;
          const key = keyFor(data);
          const baseCandidates = Array.isArray(baseLibrary.index?.[key])
            ? baseLibrary.index[key]
                .map((entry) => (Array.isArray(entry?.[2]) ? entry[2] : null))
                .filter((moves) => Array.isArray(moves) && moves.length)
            : [];
          const baseValid = baseCandidates.some((moves) => {
            const result = applyMoves(pattern, moves);
            return result && isSolved(result);
          });
          if (baseValid) {
            baseCovered += 1;
            continue;
          }
          const supplementalAlgorithm = supplemental.get(key);
          if (supplementalAlgorithm) {
            let result = null;
            try {
              result = pattern.applyAlg(supplementalAlgorithm);
            } catch {
              result = null;
            }
            if (result && isSolved(result)) {
              supplementalCovered += 1;
              continue;
            }
            invalidSupplements.push(key);
          }
          uncovered.push(key);
        }
      }
    }
  }
}

const summary = {
  legalStates,
  requiredStates,
  baseCovered,
  supplementalCovered,
  coveredStates: baseCovered + supplementalCovered,
  uncoveredCount: uncovered.length,
  invalidSupplementCount: invalidSupplements.length,
  supplementalEntries: ZBLL_SUPPLEMENTAL_CASES.length,
};
console.log(JSON.stringify(summary, null, 2));
if (uncovered.length || invalidSupplements.length || baseCovered + supplementalCovered !== requiredStates) {
  if (uncovered.length) console.error("Uncovered ZBLL keys:", uncovered.slice(0, 20));
  if (invalidSupplements.length) console.error("Invalid supplements:", invalidSupplements.slice(0, 20));
  process.exit(1);
}
