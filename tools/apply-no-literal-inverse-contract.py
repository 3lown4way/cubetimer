from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one {label} match, found {count}")
    return text.replace(old, new, 1)


policy_path = Path("solver/inverseSolutionPolicy.js")
policy_path.write_text(r'''function splitOuterMoves(sequence) {
  return String(sequence || "")
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.endsWith("2'") ? `${token[0]}2` : token);
}

function invertOuterMove(token) {
  const normalized = String(token || "").trim();
  if (!/^[URFDLB](2|'|2')?$/.test(normalized)) return "";
  if (normalized.endsWith("2") || normalized.endsWith("2'")) return `${normalized[0]}2`;
  if (normalized.endsWith("'")) return normalized.slice(0, -1);
  return `${normalized}'`;
}

export function normalizeOuterAlgorithm(sequence) {
  const moves = splitOuterMoves(sequence);
  if (moves.some((token) => !/^[URFDLB](2|'|2')?$/.test(token))) return "";
  return moves.join(" ");
}

export function invertOuterAlgorithm(sequence) {
  const moves = splitOuterMoves(sequence);
  if (!moves.length) return "";
  const inverse = [];
  for (let index = moves.length - 1; index >= 0; index -= 1) {
    const inverted = invertOuterMove(moves[index]);
    if (!inverted) return "";
    inverse.push(inverted);
  }
  return inverse.join(" ");
}

export function isSameOuterAlgorithm(left, right) {
  const normalizedLeft = normalizeOuterAlgorithm(left);
  const normalizedRight = normalizeOuterAlgorithm(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function isLiteralInverseSolution(scramble, solution) {
  const inverse = invertOuterAlgorithm(scramble);
  return Boolean(inverse && isSameOuterAlgorithm(solution, inverse));
}
''')

minmove_path = Path("solver/minmoveExactV2.js")
minmove = minmove_path.read_text()
minmove = replace_once(
    minmove,
    'import {\n  dropTwophase333Search,',
    'import { isLiteralInverseSolution, normalizeOuterAlgorithm } from "./inverseSolutionPolicy.js";\n\nimport {\n  dropTwophase333Search,',
    "minmove policy import",
)
minmove = replace_once(
    minmove,
    '''const DEFAULT_SEED_CONFIGS = [
  { maxPhase1Solutions: 96, phase1MaxDepth: 15, phase1NodeLimit: 2_000_000, phase2NodeLimit: 12_000_000 },
  { maxPhase1Solutions: 384, phase1MaxDepth: 18, phase1NodeLimit: 8_000_000, phase2NodeLimit: 40_000_000 },
];''',
    '''const DEFAULT_SEED_CONFIGS = [
  { maxPhase1Solutions: 96, phase1MaxDepth: 15, phase1NodeLimit: 2_000_000, phase2NodeLimit: 12_000_000 },
  { maxPhase1Solutions: 384, phase1MaxDepth: 18, phase1NodeLimit: 8_000_000, phase2NodeLimit: 40_000_000 },
  { maxPhase1Solutions: 768, phase1MaxDepth: 18, phase1NodeLimit: 16_000_000, phase2NodeLimit: 80_000_000 },
];''',
    "expanded minmove seed configs",
)
minmove = replace_once(
    minmove,
    '''async function findTwoPhaseSeed(scramble, incumbentLength, seedConfigs) {
  for (const config of seedConfigs) {''',
    '''async function findTwoPhaseSeed(scramble, incumbentLength, seedConfigs, excludedSolution = "") {
  const normalizedExcluded = normalizeOuterAlgorithm(excludedSolution);
  for (const config of seedConfigs) {''',
    "findTwoPhaseSeed signature",
)
minmove = replace_once(
    minmove,
    '''      const searched = await searchTwophase333(searchId, {
        incumbentLength,
        phase2MaxDepth: 20,
        phase2NodeLimit: config.phase2NodeLimit,
      });
      if (searched?.ok && typeof searched.solution === "string") {
        return searched;
      }''',
    '''      const searched = await searchTwophase333(searchId, {
        incumbentLength,
        excludedSolution: normalizedExcluded || undefined,
        strictIncumbent: false,
        phase2MaxDepth: 20,
        phase2NodeLimit: config.phase2NodeLimit,
      });
      if (searched?.ok && typeof searched.solution === "string") {
        const normalizedSolution = normalizeOuterAlgorithm(searched.solution);
        const candidateLength = splitMoves(normalizedSolution).length;
        if (!normalizedSolution) continue;
        if (normalizedExcluded && normalizedSolution === normalizedExcluded) continue;
        if (incumbentLength > 0 && candidateLength > incumbentLength) continue;
        return {
          ...searched,
          solution: normalizedSolution,
          moveCount: candidateLength,
        };
      }''',
    "seed excluded solution search",
)
minmove = replace_once(
    minmove,
    '''  let incumbentSolution = inverseScramble;
  let incumbentLength = splitMoves(incumbentSolution).length;
  let incumbentSource = "inverse_scramble";''',
    '''  const inverseUpperBoundLength = splitMoves(inverseScramble).length;
  let incumbentSolution = "";
  let incumbentLength = inverseUpperBoundLength;
  let incumbentSource = "inverse_upper_bound_only";''',
    "inverse incumbent initialization",
)
minmove = replace_once(
    minmove,
    '''  for (const direction of [
    { scramble: normalizedScramble, invert: false, source: "twophase_seed" },
    { scramble: inverseScramble, invert: true, source: "inverse_twophase_seed" },
  ]) {
    if (Date.now() >= deadlineTs) break;
    const seed = await findTwoPhaseSeed(direction.scramble, incumbentLength, seedConfigs);''',
    '''  for (const direction of [
    {
      scramble: normalizedScramble,
      invert: false,
      source: "twophase_seed",
      excludedSolution: inverseScramble,
    },
    {
      scramble: inverseScramble,
      invert: true,
      source: "inverse_twophase_seed",
      excludedSolution: normalizedScramble,
    },
  ]) {
    if (Date.now() >= deadlineTs) break;
    const seed = await findTwoPhaseSeed(
      direction.scramble,
      incumbentLength,
      seedConfigs,
      direction.excludedSolution,
    );''',
    "direction-specific excluded seed",
)
minmove = replace_once(
    minmove,
    '''    if (!candidateSolution || candidateLength >= incumbentLength) continue;
    if (!(await verifySolution(normalizedScramble, candidateSolution))) continue;
    incumbentSolution = candidateSolution;''',
    '''    if (!candidateSolution || candidateLength > incumbentLength) continue;
    if (isLiteralInverseSolution(normalizedScramble, candidateSolution)) continue;
    if (!(await verifySolution(normalizedScramble, candidateSolution))) continue;
    incumbentSolution = candidateSolution;''',
    "equal-length nontrivial seed acceptance",
)
minmove = replace_once(
    minmove,
    '''  if (!(await verifySolution(normalizedScramble, incumbentSolution))) {
    return { ok: false, reason: "MINMOVE_SEED_INVALID" };
  }''',
    '''  if (!incumbentSolution) {
    return {
      ok: false,
      reason: "MINMOVE_NONTRIVIAL_SEED_NOT_FOUND",
      solution: "",
      moveCount: 0,
      inverseUpperBoundLength,
      optimalityProven: false,
      fallbackReason: null,
      elapsedMs: Date.now() - startedAt,
    };
  }
  if (
    isLiteralInverseSolution(normalizedScramble, incumbentSolution)
    || !(await verifySolution(normalizedScramble, incumbentSolution))
  ) {
    return { ok: false, reason: "MINMOVE_SEED_INVALID" };
  }''',
    "nontrivial seed requirement",
)
minmove = replace_once(
    minmove,
    '''          && candidateLength < incumbentLength
          && await verifySolution(normalizedScramble, candidateSolution)
        ) {''',
    '''          && candidateLength < incumbentLength
          && !isLiteralInverseSolution(normalizedScramble, candidateSolution)
          && await verifySolution(normalizedScramble, candidateSolution)
        ) {''',
    "exact candidate inverse guard",
)
minmove = replace_once(
    minmove,
    '''      return {
        ok: true,
        solution: incumbentSolution,''',
    '''      if (isLiteralInverseSolution(normalizedScramble, incumbentSolution)) {
        return { ok: false, reason: "MINMOVE_LITERAL_INVERSE_REJECTED" };
      }
      return {
        ok: true,
        solution: incumbentSolution,''',
    "proven result inverse guard",
)
minmove_path.write_text(minmove)

worker_path = Path("solver/solverWorker.js")
worker = worker_path.read_text()
worker = replace_once(
    worker,
    'import { expose } from "../vendor/comlink/index.js";',
    'import { expose } from "../vendor/comlink/index.js";\nimport { isLiteralInverseSolution } from "./inverseSolutionPolicy.js";',
    "worker policy import",
)
worker = replace_once(
    worker,
    '''      const v2Strict = noFallback && normalizeSolverVersion(solverVersion) === "v2";
      const frontierLimits = v2Strict''',
    '''      const v2Adaptive = normalizeSolverVersion(solverVersion) === "v2";
      const frontierLimits = v2Adaptive''',
    "v2 adaptive frontiers",
)
worker = replace_once(
    worker,
    '''            excludedSolution: noFallback ? inverseSolution : undefined,''',
    '''            excludedSolution: inverseSolution || undefined,''',
    "always-on twophase exclusion",
)
worker = replace_once(
    worker,
    '''      if (searched) {
        phaseResult = searched;
        if (searched.ok) phaseSource = "WASM_3X3_TWOPHASE";
      }''',
    '''      if (searched) {
        if (searched.ok && isLiteralInverseSolution(scramble, searched.solution)) {
          phaseResult = {
            ...searched,
            ok: false,
            solution: "",
            moveCount: 0,
            reason: "TWOPHASE_TRIVIAL_INVERSE_REJECTED",
          };
        } else {
          phaseResult = searched;
          if (searched.ok) phaseSource = "WASM_3X3_TWOPHASE";
        }
      }''',
    "stale wasm inverse rejection",
)
worker = replace_once(
    worker,
    '''  if (noFallback && inverseSolution && solution === inverseSolution) {
    return { ok: false, reason: "TWOPHASE_STRICT_EXCLUSION_VIOLATION", source: phaseSource };
  }''',
    '''  if (inverseSolution && isLiteralInverseSolution(scramble, solution)) {
    return { ok: false, reason: "TWOPHASE_TRIVIAL_INVERSE_REJECTED", source: phaseSource };
  }''',
    "final twophase inverse guard",
)
worker_path.write_text(worker)

benchmark_path = Path("benchmark-inverse-output-contract.mjs")
benchmark_path.write_text(r'''import assert from "node:assert/strict";
import fs from "node:fs";

import {
  invertOuterAlgorithm,
  isLiteralInverseSolution,
} from "./solver/inverseSolutionPolicy.js";
import { solveMinmoveExactV2 } from "./solver/minmoveExactV2.js";
import {
  solveTwophaseAdaptive333,
  verifyFmcSolutionWasm,
} from "./solver/wasmSolver.js";

const SCRAMBLE = "F2 D U2 B2 L2 R2 U2 B' L2 F D2 B' F' U L' U' F U2 R' B";
const REPORTED_INVERSE = "B' R U2 F' U L U' F B D2 F' L2 B U2 R2 L2 B2 U2 D' F2";
const inverse = invertOuterAlgorithm(SCRAMBLE);
assert.equal(inverse, REPORTED_INVERSE, "regression fixture must be the literal inverse");
assert.equal(isLiteralInverseSolution(SCRAMBLE, REPORTED_INVERSE), true);

const workerSource = fs.readFileSync(new URL("./solver/solverWorker.js", import.meta.url), "utf8");
assert.match(workerSource, /excludedSolution:\s*inverseSolution\s*\|\|\s*undefined/);
assert.match(workerSource, /isLiteralInverseSolution\(scramble,\s*searched\.solution\)/);
assert.match(workerSource, /isLiteralInverseSolution\(scramble,\s*solution\)/);
assert.doesNotMatch(workerSource, /excludedSolution:\s*noFallback\s*\?/);

const twophase = await solveTwophaseAdaptive333(SCRAMBLE, {
  frontierLimits: [2, 12, 48, 192, 768],
  prepareOptions: {
    phase1MaxDepth: 13,
    phase1NodeLimit: 0,
  },
  searchOptions: {
    incumbentLength: inverse.split(/\s+/).length,
    excludedSolution: inverse,
    strictIncumbent: false,
    phase2MaxDepth: 20,
    phase2NodeLimit: 0,
  },
});
assert.equal(twophase?.ok, true, `two-phase failed: ${twophase?.reason || "unknown"}`);
assert.equal(isLiteralInverseSolution(SCRAMBLE, twophase.solution), false, "two-phase returned literal inverse");
const twophaseVerification = await verifyFmcSolutionWasm(SCRAMBLE, twophase.solution);
assert.equal(twophaseVerification?.solved, true, "two-phase regression solution is invalid");

const minmove = await solveMinmoveExactV2(SCRAMBLE, null, {
  timeBudgetMs: 120_000,
});
assert.equal(minmove?.ok, true, `minmove failed: ${minmove?.reason || "unknown"}`);
assert.equal(minmove?.optimalityProven, true, "minmove result is not proven");
assert.equal(isLiteralInverseSolution(SCRAMBLE, minmove.solution), false, "minmove returned literal inverse");
const minmoveVerification = await verifyFmcSolutionWasm(SCRAMBLE, minmove.solution);
assert.equal(minmoveVerification?.solved, true, "minmove regression solution is invalid");

console.log(JSON.stringify({
  scramble: SCRAMBLE,
  inverse,
  twophase: {
    solution: twophase.solution,
    moveCount: twophase.moveCount,
    frontierLimit: twophase.frontierLimit,
  },
  minmove: {
    solution: minmove.solution,
    moveCount: minmove.moveCount,
    proofSource: minmove.proofSource,
    elapsedMs: minmove.elapsedMs,
  },
}));
console.log("inverse output contract passed");
''')

persistent_workflow = Path(".github/workflows/inverse-output-contract.yml")
persistent_workflow.write_text(r'''name: Verify inverse output contract

on:
  pull_request:
    paths:
      - "solver/inverseSolutionPolicy.js"
      - "solver/minmoveExactV2.js"
      - "solver/solverWorker.js"
      - "solver/wasmSolver.js"
      - "solver-wasm/src/twophase_search.rs"
      - "public/solver-wasm/solver_wasm_bg.wasm"
      - "benchmark-inverse-output-contract.mjs"
      - ".github/workflows/inverse-output-contract.yml"
  push:
    branches:
      - main
    paths:
      - "solver/inverseSolutionPolicy.js"
      - "solver/minmoveExactV2.js"
      - "solver/solverWorker.js"
      - "solver/wasmSolver.js"
      - "solver-wasm/src/twophase_search.rs"
      - "public/solver-wasm/solver_wasm_bg.wasm"
      - "benchmark-inverse-output-contract.mjs"
      - ".github/workflows/inverse-output-contract.yml"

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Check source syntax
        run: |
          node --check solver/inverseSolutionPolicy.js
          node --check solver/minmoveExactV2.js
          node --check solver/solverWorker.js
          node --check benchmark-inverse-output-contract.mjs
      - name: Run reported inverse regressions
        run: node benchmark-inverse-output-contract.mjs
''')

# The one-shot workflow and patcher are removed before the final commit.
Path(".github/workflows/apply-no-literal-inverse-contract-once.yml").unlink(missing_ok=True)
Path("tools/apply-no-literal-inverse-contract.py").unlink(missing_ok=True)
