/**
 * Roux v2: exact FB → exact SB → indexed CMLL → exact LSE.
 *
 * This implementation does not call a phase solver, CFOP solver, external
 * solver, or any other complete-cube fallback.
 */

import { Alg } from "../vendor/cubing/alg/index.js";
import {
  ALL_MOVES,
  SB_MOVES,
  LSE_MOVES,
  encodeFBCornerState,
  encodeFBEdgeState,
  encodeSBCornerState,
  encodeSBEdgeState,
  encodeLSEState,
  getMCenterState,
  applyMoveToCornerEnc,
  applyMoveToEdgeEnc,
  applyMoveToLSEEnc,
} from "./rouxPruneTables.js";
import { ROUX_FORMULAS } from "./rouxDataset.js";
import { ensureRouxExactTablesV2 } from "./rouxExactTablesV2.js";

const FB_CORNERS = [5, 6];
const FB_EDGES = [7, 9, 11];
const SB_CORNERS = [4, 7];
const SB_EDGES = [5, 8, 10];
const CMLL_CORNERS = [0, 1, 2, 3];
const AUF = ["", "U", "U2", "U'"];

const ROUX_FACE_ROTATION = Object.freeze({
  D: "",
  U: "x2",
  F: "x",
  B: "x'",
  R: "z'",
  L: "z",
});
const ROTATION_INVERSE = Object.freeze({
  x: "x'",
  "x'": "x",
  x2: "x2",
  z: "z'",
  "z'": "z",
  z2: "z2",
  y: "y'",
  "y'": "y",
  y2: "y2",
});
const ROUX_COLOR_SEQUENCE = Object.freeze(["D", "U", "F", "B", "R", "L"]);

function isRouxColorNeutral(value) {
  const normalized = String(value || "D").toUpperCase();
  return normalized === "CN" || normalized === "COLOR_NEUTRAL"
    || normalized === "COLOR-NEUTRAL" || normalized === "AUTO";
}

function compareRouxColorResults(a, b) {
  if (a.ok !== b.ok) return a.ok ? -1 : 1;
  if (a.coreMoveCount !== b.coreMoveCount) return a.coreMoveCount - b.coreMoveCount;
  if (a.moveCount !== b.moveCount) return a.moveCount - b.moveCount;
  if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
  return ROUX_COLOR_SEQUENCE.indexOf(a.color) - ROUX_COLOR_SEQUENCE.indexOf(b.color);
}

let cmllIndexPromise = null;

function isPiecesSolved(pattern, solved, cornerPositions, edgePositions) {
  const data = pattern.patternData;
  const solvedData = solved.patternData;
  for (const position of cornerPositions) {
    if (
      data.CORNERS.pieces[position] !== solvedData.CORNERS.pieces[position]
      || data.CORNERS.orientation[position] !== solvedData.CORNERS.orientation[position]
    ) return false;
  }
  for (const position of edgePositions) {
    if (
      data.EDGES.pieces[position] !== solvedData.EDGES.pieces[position]
      || data.EDGES.orientation[position] !== solvedData.EDGES.orientation[position]
    ) return false;
  }
  return true;
}

function isFBSolved(pattern, solved) {
  return isPiecesSolved(pattern, solved, FB_CORNERS, FB_EDGES);
}

function isSBSolved(pattern, solved) {
  return isPiecesSolved(
    pattern,
    solved,
    [...FB_CORNERS, ...SB_CORNERS],
    [...FB_EDGES, ...SB_EDGES],
  );
}

function isCMLLSolved(pattern, solved) {
  return isSBSolved(pattern, solved)
    && isPiecesSolved(pattern, solved, CMLL_CORNERS, []);
}

function cmllCornerKey(data) {
  return CMLL_CORNERS
    .map((position) => `${data.CORNERS.pieces[position]}:${data.CORNERS.orientation[position]}`)
    .join("|");
}

async function ensureCmllIndex(solvedPattern) {
  if (cmllIndexPromise) return cmllIndexPromise;
  cmllIndexPromise = (async () => {
    const index = new Map();
    let rejectedCandidates = 0;

    for (const algorithm of ROUX_FORMULAS.CMLL) {
      for (const preAuf of AUF) {
        for (const postAuf of AUF) {
          const text = [preAuf, algorithm, postAuf].filter(Boolean).join(" ");
          let casePattern;
          try {
            casePattern = solvedPattern.applyAlg(new Alg(text).invert());
          } catch {
            rejectedCandidates += 1;
            continue;
          }
          if (!isSBSolved(casePattern, solvedPattern)) {
            rejectedCandidates += 1;
            continue;
          }
          let result;
          try {
            result = casePattern.applyAlg(text);
          } catch {
            rejectedCandidates += 1;
            continue;
          }
          if (!isCMLLSolved(result, solvedPattern)) {
            rejectedCandidates += 1;
            continue;
          }
          const key = cmllCornerKey(casePattern.patternData);
          const moves = text.split(/\s+/).filter(Boolean);
          const previous = index.get(key);
          if (!previous || moves.length < previous.moves.length) {
            index.set(key, Object.freeze({ text, moves: Object.freeze(moves) }));
          }
        }
      }
    }

    // Four exact AUF states are not represented by a non-trivial CMLL case.
    for (const algorithm of AUF) {
      const casePattern = algorithm
        ? solvedPattern.applyAlg(new Alg(algorithm).invert())
        : solvedPattern;
      const key = cmllCornerKey(casePattern.patternData);
      const moves = algorithm ? [algorithm] : [];
      const previous = index.get(key);
      if (!previous || moves.length < previous.moves.length) {
        index.set(key, Object.freeze({
          text: algorithm,
          moves: Object.freeze(moves),
        }));
      }
    }

    if (index.size !== 648) {
      throw new Error(`Incomplete CMLL index: ${index.size}/648`);
    }
    return Object.freeze({ index, rejectedCandidates });
  })().catch((error) => {
    cmllIndexPromise = null;
    throw error;
  });
  return cmllIndexPromise;
}

function pairStateKey(cornerEnc, edgeEnc, factor) {
  return cornerEnc * factor + edgeEnc;
}

function descendExactPairState({
  pattern,
  distances,
  transitions,
  moves,
  encodeCorner,
  encodeEdge,
  factor,
  unvisited,
}) {
  let cornerEnc = encodeCorner(pattern.patternData);
  let edgeEnc = encodeEdge(pattern.patternData);
  let key = pairStateKey(cornerEnc, edgeEnc, factor);
  let distance = distances[key];
  if (distance === unvisited) {
    return { ok: false, reason: "STATE_NOT_INDEXED", moves: [], pattern };
  }

  const output = [];
  const { cornerPerm, cornerTwist, edgePerm, edgeFlip } = transitions;
  while (distance > 0) {
    let selected = -1;
    let nextCornerEnc = cornerEnc;
    let nextEdgeEnc = edgeEnc;
    let nextKey = key;
    for (let moveIndex = 0; moveIndex < moves.length; moveIndex++) {
      const candidateCornerEnc = applyMoveToCornerEnc(
        cornerEnc,
        moveIndex,
        cornerPerm,
        cornerTwist,
      );
      const candidateEdgeEnc = applyMoveToEdgeEnc(
        edgeEnc,
        moveIndex,
        edgePerm,
        edgeFlip,
      );
      const candidateKey = pairStateKey(candidateCornerEnc, candidateEdgeEnc, factor);
      if (distances[candidateKey] !== distance - 1) continue;
      selected = moveIndex;
      nextCornerEnc = candidateCornerEnc;
      nextEdgeEnc = candidateEdgeEnc;
      nextKey = candidateKey;
      break;
    }
    if (selected < 0) {
      return { ok: false, reason: "NO_DESCENDING_MOVE", moves: output, pattern };
    }
    output.push(moves[selected]);
    cornerEnc = nextCornerEnc;
    edgeEnc = nextEdgeEnc;
    key = nextKey;
    distance -= 1;
  }

  let resultPattern;
  try {
    resultPattern = output.length ? pattern.applyAlg(output.join(" ")) : pattern;
  } catch {
    return { ok: false, reason: "MOVE_APPLICATION_FAILED", moves: output, pattern };
  }
  return { ok: true, moves: output, pattern: resultPattern };
}

function descendExactLseState(pattern, tables) {
  const edgeEnc = encodeLSEState(pattern.patternData);
  const mCenter = getMCenterState(pattern.patternData);
  let enc = (edgeEnc << 4) | (mCenter << 2);
  let distance = tables.lseExactDistances.get(enc);
  if (!Number.isInteger(distance)) {
    return { ok: false, reason: "LSE_STATE_NOT_INDEXED", moves: [], pattern };
  }

  const output = [];
  const { lsePerm, lseFlip, uDelta, mDelta } = tables.lseMovesTrans;
  while (distance > 0) {
    let selected = -1;
    let nextEnc = enc;
    for (let moveIndex = 0; moveIndex < LSE_MOVES.length; moveIndex++) {
      const candidateEnc = applyMoveToLSEEnc(
        enc,
        moveIndex,
        lsePerm,
        lseFlip,
        uDelta,
        mDelta,
      );
      if (tables.lseExactDistances.get(candidateEnc) !== distance - 1) continue;
      selected = moveIndex;
      nextEnc = candidateEnc;
      break;
    }
    if (selected < 0) {
      return { ok: false, reason: "LSE_NO_DESCENDING_MOVE", moves: output, pattern };
    }
    output.push(LSE_MOVES[selected]);
    enc = nextEnc;
    distance -= 1;
  }

  let resultPattern;
  try {
    resultPattern = output.length ? pattern.applyAlg(output.join(" ")) : pattern;
  } catch {
    return { ok: false, reason: "LSE_MOVE_APPLICATION_FAILED", moves: output, pattern };
  }
  return { ok: true, moves: output, pattern: resultPattern };
}

function transformPatternForRouxFace(pattern, solvedPattern, rotationAlg) {
  if (!rotationAlg) return pattern;
  try {
    const patternTransform = pattern.experimentalToTransformation();
    const rotationTransform = solvedPattern.applyAlg(rotationAlg).experimentalToTransformation();
    return rotationTransform.invert()
      .applyTransformation(patternTransform)
      .applyTransformation(rotationTransform)
      .toKPattern();
  } catch {
    return null;
  }
}

function parseMove(move) {
  const match = String(move).trim().match(/^([UDLRFBMESxyzudlrfb])(2'|2|')?$/);
  if (!match) return null;
  return {
    face: match[1],
    amount: match[2] === "'" ? 3 : (match[2] === "2" || match[2] === "2'") ? 2 : 1,
  };
}

function formatMove(face, amount) {
  if (amount === 1) return face;
  if (amount === 2) return `${face}2`;
  if (amount === 3) return `${face}'`;
  return "";
}

function simplifyMoves(moves) {
  const stack = [];
  for (const rawMove of moves) {
    const text = String(rawMove || "").trim();
    if (!text) continue;
    const parsed = parseMove(text);
    if (!parsed) {
      stack.push({ raw: text });
      continue;
    }
    const previous = stack[stack.length - 1];
    if (!previous || previous.raw || previous.face !== parsed.face) {
      stack.push(parsed);
      continue;
    }
    const combined = (previous.amount + parsed.amount) & 3;
    if (combined === 0) stack.pop();
    else previous.amount = combined;
  }
  return stack
    .map((entry) => entry.raw || formatMove(entry.face, entry.amount))
    .filter(Boolean);
}

function applyAndVerify(pattern, solvedPattern, moves) {
  try {
    return pattern.applyAlg(moves.join(" ")).isIdentical(solvedPattern);
  } catch {
    return false;
  }
}

function stageRecord(name, moves, elapsedMs) {
  return Object.freeze({
    name,
    solution: moves.join(" ") || "(skip)",
    moveCount: moves.length,
    elapsedMs,
  });
}

export async function solve3x3RouxV2FromPattern(pattern, options = {}) {
  const startedAt = performance.now();
  const { getDefaultPattern } = await import("./context.js");
  const solvedPattern = await getDefaultPattern("333");
  const [tables, cmllLibrary] = await Promise.all([
    ensureRouxExactTablesV2(getDefaultPattern),
    ensureCmllIndex(solvedPattern),
  ]);

  const rawCrossColor = String(options.crossColor || "D").toUpperCase();
  if (isRouxColorNeutral(rawCrossColor) && !options.__colorNeutralApplied) {
    const colorNeutralCandidates = [];
    let bestResult = null;
    let bestDiagnostic = null;
    for (const color of ROUX_COLOR_SEQUENCE) {
      const candidateResult = await solve3x3RouxV2FromPattern(pattern, {
        ...options,
        crossColor: color,
        __colorNeutralApplied: true,
      });
      const diagnostic = {
        color,
        ok: candidateResult?.ok === true,
        coreMoveCount: Number.isFinite(candidateResult?.coreMoveCount)
          ? candidateResult.coreMoveCount
          : Number.MAX_SAFE_INTEGER,
        moveCount: Number.isFinite(candidateResult?.moveCount)
          ? candidateResult.moveCount
          : Number.MAX_SAFE_INTEGER,
        elapsedMs: Number.isFinite(candidateResult?.elapsedMs)
          ? candidateResult.elapsedMs
          : Number.MAX_SAFE_INTEGER,
        reason: String(candidateResult?.reason || ""),
      };
      colorNeutralCandidates.push(diagnostic);
      if (!bestDiagnostic || compareRouxColorResults(diagnostic, bestDiagnostic) < 0) {
        bestDiagnostic = diagnostic;
        bestResult = candidateResult;
      }
    }
    if (bestResult?.ok && bestDiagnostic?.ok) {
      return {
        ...bestResult,
        selectedCrossColor: bestDiagnostic.color,
        colorNeutralCandidates,
        colorNeutralSelectionMetric: "coreMoveCount",
      };
    }
    return {
      ok: false,
      reason: "ROUX_COLOR_NEUTRAL_NO_SOLUTION",
      source: "INTERNAL_3X3_ROUX_V2",
      solverVersion: "v2",
      selectedCrossColor: bestDiagnostic?.color || null,
      colorNeutralCandidates,
    };
  }
  const colorKey = Object.prototype.hasOwnProperty.call(ROUX_FACE_ROTATION, rawCrossColor)
    ? rawCrossColor
    : "D";
  const preRotation = ROUX_FACE_ROTATION[colorKey] ?? "";
  const workingPattern = preRotation
    ? transformPatternForRouxFace(pattern, solvedPattern, preRotation)
    : pattern;
  if (!workingPattern) {
    return {
      ok: false,
      reason: "CROSS_COLOR_TRANSFORM_FAILED",
      source: "INTERNAL_3X3_ROUX_V2",
      solverVersion: "v2",
    };
  }

  let currentPattern = workingPattern;
  const stages = [];
  const allMoves = [];

  let stageStartedAt = performance.now();
  const fbResult = descendExactPairState({
    pattern: currentPattern,
    distances: tables.fbExactDistances,
    transitions: tables.allMovesTrans,
    moves: ALL_MOVES,
    encodeCorner: encodeFBCornerState,
    encodeEdge: encodeFBEdgeState,
    factor: tables.pairEdgeFactor,
    unvisited: tables.unvisited,
  });
  if (!fbResult.ok || !isFBSolved(fbResult.pattern, solvedPattern)) {
    return {
      ok: false,
      reason: fbResult.reason || "FB_VERIFY_FAILED",
      stage: "FB",
      source: "INTERNAL_3X3_ROUX_V2",
      solverVersion: "v2",
    };
  }
  currentPattern = fbResult.pattern;
  allMoves.push(...fbResult.moves);
  stages.push(stageRecord("FB", fbResult.moves, performance.now() - stageStartedAt));

  stageStartedAt = performance.now();
  const sbResult = descendExactPairState({
    pattern: currentPattern,
    distances: tables.sbExactDistances,
    transitions: tables.sbMovesTrans,
    moves: SB_MOVES,
    encodeCorner: encodeSBCornerState,
    encodeEdge: encodeSBEdgeState,
    factor: tables.pairEdgeFactor,
    unvisited: tables.unvisited,
  });
  if (!sbResult.ok || !isSBSolved(sbResult.pattern, solvedPattern)) {
    return {
      ok: false,
      reason: sbResult.reason || "SB_VERIFY_FAILED",
      stage: "SB",
      stages,
      source: "INTERNAL_3X3_ROUX_V2",
      solverVersion: "v2",
    };
  }
  currentPattern = sbResult.pattern;
  allMoves.push(...sbResult.moves);
  stages.push(stageRecord("SB", sbResult.moves, performance.now() - stageStartedAt));

  stageStartedAt = performance.now();
  const cmllKey = cmllCornerKey(currentPattern.patternData);
  const cmllCandidate = cmllLibrary.index.get(cmllKey);
  if (!cmllCandidate) {
    return {
      ok: false,
      reason: "CMLL_NOT_INDEXED",
      stage: "CMLL",
      stages,
      source: "INTERNAL_3X3_ROUX_V2",
      solverVersion: "v2",
    };
  }
  let cmllPattern;
  try {
    cmllPattern = cmllCandidate.moves.length
      ? currentPattern.applyAlg(cmllCandidate.text)
      : currentPattern;
  } catch {
    cmllPattern = null;
  }
  if (!cmllPattern || !isCMLLSolved(cmllPattern, solvedPattern)) {
    return {
      ok: false,
      reason: "CMLL_CANDIDATE_INVALID",
      stage: "CMLL",
      stages,
      source: "INTERNAL_3X3_ROUX_V2",
      solverVersion: "v2",
    };
  }
  currentPattern = cmllPattern;
  allMoves.push(...cmllCandidate.moves);
  stages.push(stageRecord("CMLL", cmllCandidate.moves, performance.now() - stageStartedAt));

  stageStartedAt = performance.now();
  const lseResult = descendExactLseState(currentPattern, tables);
  if (!lseResult.ok || !lseResult.pattern.isIdentical(solvedPattern)) {
    return {
      ok: false,
      reason: lseResult.reason || "LSE_VERIFY_FAILED",
      stage: "LSE",
      stages,
      source: "INTERNAL_3X3_ROUX_V2",
      solverVersion: "v2",
    };
  }
  currentPattern = lseResult.pattern;
  allMoves.push(...lseResult.moves);
  stages.push(stageRecord("LSE", lseResult.moves, performance.now() - stageStartedAt));

  const coreMoves = simplifyMoves(allMoves);
  const inverseRotation = preRotation ? ROTATION_INVERSE[preRotation] || "" : "";
  const unsimplifiedMoves = [
    ...(preRotation ? preRotation.split(/\s+/).filter(Boolean) : []),
    ...allMoves,
    ...(inverseRotation ? inverseRotation.split(/\s+/).filter(Boolean) : []),
  ];
  const simplifiedMoves = simplifyMoves(unsimplifiedMoves);
  const finalMoves = applyAndVerify(pattern, solvedPattern, simplifiedMoves)
    ? simplifiedMoves
    : unsimplifiedMoves;

  if (!applyAndVerify(pattern, solvedPattern, finalMoves)) {
    return {
      ok: false,
      reason: "FINAL_SOLUTION_INVALID",
      stage: "VERIFY",
      stages,
      source: "INTERNAL_3X3_ROUX_V2",
      solverVersion: "v2",
    };
  }

  return {
    ok: true,
    solution: finalMoves.join(" "),
    moveCount: finalMoves.length,
    coreMoveCount: coreMoves.length,
    selectedCrossColor: colorKey,
    stages,
    source: "INTERNAL_3X3_ROUX_V2",
    solverVersion: "v2",
    elapsedMs: performance.now() - startedAt,
    tableBuildMetrics: tables.buildMetrics,
    cmllIndexSize: cmllLibrary.index.size,
    cmllRejectedCandidates: cmllLibrary.rejectedCandidates,
  };
}

export async function prewarm3x3RouxV2() {
  const { getDefaultPattern } = await import("./context.js");
  const solvedPattern = await getDefaultPattern("333");
  await Promise.all([
    ensureRouxExactTablesV2(getDefaultPattern),
    ensureCmllIndex(solvedPattern),
  ]);
}
