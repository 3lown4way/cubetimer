import fs from "node:fs";
import { cube3x3x3 } from "./vendor/cubing/puzzles/index.js";
import { solve3x3StrictCfopFromPattern } from "./solver/cfop3x3.js";
import { ZB_FORMULAS } from "./solver/zbDataset.js";

const SCRAMBLES = [
  "R B' R2 U2 F' R2 B2 L' B' L' F R' D2 L' U' F L2 B2 U F' L",
  "F R2 D' B R2 F' D' L' F' U' F' L' F2 R U2 L2 F' R' B' D2 R2",
  "F L2 D' R' F' U B' D2 R2 B' R' U2 B2 L' B2 D' R' D R2 B2 U2",
];

const FORMULA_ROTATIONS = ["", "y", "y2", "y'"];
const FORMULA_AUF = ["", "U", "U2", "U'"];
const MAX_ZBLL_DEPTH = 22;
const RUNTIME_ATTEMPT_LIMIT = 50000;

const kpuzzle = await cube3x3x3.kpuzzle();
const solved = kpuzzle.defaultPattern();

function splitMoves(alg) {
  return String(alg || "").trim().split(/\s+/).filter(Boolean);
}

function normalizeMoveToken(token) {
  const match = /^([A-Za-z]+)(2'?|')?$/.exec(String(token || "").trim());
  if (!match) return "";
  const face = match[1];
  const suffix = match[2] || "";
  if (suffix === "2'" || suffix === "2") return `${face}2`;
  if (suffix === "'") return `${face}'`;
  return face;
}

function sanitizeFormulaAlg(rawAlg) {
  let text = String(rawAlg || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  text = text.replace(/^\((U2|U'|U)\)\s*/i, "");
  text = text.replace(/^\((U2|U'|U)\)\s*/i, "");
  text = text.replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  if (!text || !/^[URFDLBMESXYZurfdlbmesxyzw'2\s]+$/.test(text)) return "";
  return splitMoves(text).map(normalizeMoveToken).filter(Boolean).join(" ");
}

function joinMoves(parts) {
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function yTurns(token) {
  if (!token) return 0;
  if (token === "y") return 1;
  if (token === "y2") return 2;
  if (token === "y'") return 3;
  throw new Error(`Unsupported y rotation: ${token}`);
}

function yToken(turns) {
  const normalized = ((turns % 4) + 4) % 4;
  return normalized === 0 ? "" : normalized === 1 ? "y" : normalized === 2 ? "y2" : "y'";
}

function composeYRot(a, b) {
  return yToken(yTurns(a) + yTurns(b));
}

function invertRotation(rotation) {
  return yToken(-yTurns(rotation));
}

function extractLeadingYRot(alg) {
  const tokens = splitMoves(alg);
  const first = tokens[0] || "";
  if (first === "y" || first === "y2" || first === "y'") {
    return { leadingRot: first, rest: tokens.slice(1).join(" ") };
  }
  return { leadingRot: "", rest: alg };
}

function buildFormulaCandidate(rot, preAuf, alg, postAuf = "") {
  const { leadingRot, rest } = extractLeadingYRot(alg);
  const combinedRot = composeYRot(rot, leadingRot);
  return joinMoves([combinedRot, preAuf, rest, invertRotation(combinedRot), postAuf]);
}

function buildKey(pattern) {
  const data = pattern.patternData;
  const orbitKey = (orbit) => {
    const parts = [];
    for (let index = 0; index < orbit.pieces.length; index += 1) {
      parts.push(`p${orbit.pieces[index]}`, `o${orbit.orientation[index]}`);
    }
    return parts.join(",");
  };
  return `ZC:${orbitKey(data.CORNERS)}|ZE:${orbitKey(data.EDGES)}`;
}

function uniqueSanitizedFormulas(keys) {
  const seen = new Set();
  const formulas = [];
  const familyCounts = {};
  for (const key of keys) {
    const source = Array.isArray(ZB_FORMULAS[key]) ? ZB_FORMULAS[key] : [];
    let accepted = 0;
    for (const raw of source) {
      const alg = sanitizeFormulaAlg(raw);
      if (!alg || seen.has(alg)) continue;
      seen.add(alg);
      formulas.push({ family: key, alg });
      accepted += 1;
    }
    familyCounts[key] = { raw: source.length, uniqueAccepted: accepted };
  }
  return { formulas, familyCounts };
}

function scanZbll(startPattern) {
  const { formulas, familyCounts } = uniqueSanitizedFormulas(["ZBLL", "PLL"]);
  let ordinal = 0;
  let parserErrors = 0;
  let overDepth = 0;
  let firstSolved = null;
  let solvedWithinRuntimeLimit = null;
  const solutions = [];

  outer:
  for (const rot of FORMULA_ROTATIONS) {
    for (const preAuf of FORMULA_AUF) {
      for (const entry of formulas) {
        for (const postAuf of FORMULA_AUF) {
          const candidate = buildFormulaCandidate(rot, preAuf, entry.alg, postAuf);
          const moves = splitMoves(candidate);
          if (moves.length > MAX_ZBLL_DEPTH) {
            overDepth += 1;
            continue;
          }
          ordinal += 1;
          let next;
          try {
            next = startPattern.applyAlg(candidate);
          } catch {
            parserErrors += 1;
            continue;
          }
          const isSolved = next.experimentalIsSolved({ ignorePuzzleOrientation: false });
          if (!isSolved) continue;
          const hit = {
            ordinal,
            withinRuntimeAttemptLimit: ordinal <= RUNTIME_ATTEMPT_LIMIT,
            family: entry.family,
            formula: entry.alg,
            candidate,
            moveCount: moves.length,
            rotation: rot,
            preAuf,
            postAuf,
          };
          if (!firstSolved) firstSolved = hit;
          if (!solvedWithinRuntimeLimit && hit.withinRuntimeAttemptLimit) solvedWithinRuntimeLimit = hit;
          solutions.push(hit);
          if (solutions.length >= 12) break outer;
        }
      }
    }
  }

  return {
    familyCounts,
    uniqueFormulaCount: formulas.length,
    theoreticalCandidateCount: formulas.length * FORMULA_ROTATIONS.length * FORMULA_AUF.length * FORMULA_AUF.length,
    testedCandidateCount: ordinal,
    overDepth,
    parserErrors,
    firstSolved,
    solvedWithinRuntimeLimit,
    solutions,
  };
}

const rows = [];
for (let index = 0; index < SCRAMBLES.length; index += 1) {
  const scramble = SCRAMBLES[index];
  const pattern = solved.applyAlg(scramble);
  const result = await solve3x3StrictCfopFromPattern(pattern, {
    mode: "zb",
    solverVersion: "v2",
    crossColor: "D",
    scramble,
    enableOllPllPrediction: false,
    allowRelaxedSearch: false,
    deadlineTs: Date.now() + 15000,
  });

  const partialSolution = String(result?.partialSolution || "").trim();
  const zbllStart = partialSolution ? pattern.applyAlg(partialSolution) : null;
  const recordedKey = result?.failureState?.key || null;
  const derivedKey = zbllStart ? buildKey(zbllStart) : null;
  const scan = zbllStart ? scanZbll(zbllStart) : null;

  rows.push({
    index: index + 1,
    scramble,
    resultSummary: {
      ok: result?.ok === true,
      reason: result?.reason || null,
      stage: result?.stage || null,
      nodes: result?.nodes || 0,
      stages: result?.stages || [],
      partialSolution,
      stageDiagnostics: result?.stageDiagnostics || [],
      zbXCrossProbe: result?.zbXCrossProbe || null,
    },
    failureState: result?.failureState || null,
    keyCheck: {
      recordedKey,
      derivedKey,
      equal: recordedKey === derivedKey,
    },
    preconditions: zbllStart
      ? {
          strictSolved: zbllStart.experimentalIsSolved({ ignorePuzzleOrientation: false }),
          cornerOrientation: Array.from(zbllStart.patternData.CORNERS.orientation),
          edgeOrientation: Array.from(zbllStart.patternData.EDGES.orientation),
          cornerPieces: Array.from(zbllStart.patternData.CORNERS.pieces),
          edgePieces: Array.from(zbllStart.patternData.EDGES.pieces),
        }
      : null,
    exhaustiveFormulaScan: scan,
  });
  console.log(`[missing ZBLL debug] ${index + 1}/${SCRAMBLES.length} ${result?.reason || "OK"}`);
}

const report = {
  generatedAt: new Date().toISOString(),
  rows,
};
fs.mkdirSync("benchmark-results", { recursive: true });
fs.writeFileSync(
  "benchmark-results/zb-missing-zbll-debug.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
