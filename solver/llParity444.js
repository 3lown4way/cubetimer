import { puzzles } from "../vendor/cubing/puzzles/index.js";
import { getDefaultPattern } from "./context.js";
import { solve3x3StrictCfopFromPattern } from "./cfop3x3.js";

const EDGE_SLOT_PAIRS_444 = Object.freeze([
  [8, 2], [9, 15], [5, 11], [10, 20], [21, 14], [6, 23],
  [22, 18], [3, 4], [7, 17], [19, 13], [16, 0], [12, 1],
]);
const EDGE_TYPE_BY_WING_444 = (() => {
  const out = new Array(24).fill(-1);
  EDGE_SLOT_PAIRS_444.forEach((pair, type) => pair.forEach((wing) => { out[wing] = type; }));
  return Object.freeze(out);
})();
const EDGE_SLOT_TO_333_444 = Object.freeze([0, 8, 9, 4, 5, 7, 6, 3, 11, 10, 2, 1]);
const CROSS_ROTATION_444 = Object.freeze({ D: "", U: "x2", F: "x", B: "x'", R: "z'", L: "z" });
const ID_FACE_MAP = Object.freeze({ U: "U", R: "R", F: "F", D: "D", L: "L", B: "B" });
const ROT_FACE_MAP = Object.freeze({
  x: Object.freeze({ U: "F", R: "R", F: "D", D: "B", L: "L", B: "U" }),
  y: Object.freeze({ U: "U", R: "B", F: "R", D: "D", L: "F", B: "L" }),
  z: Object.freeze({ U: "L", R: "U", F: "F", D: "R", L: "D", B: "B" }),
});
const SLICE_EXPANSIONS = Object.freeze({
  M: Object.freeze(["L'", "R", "x'"]),
  E: Object.freeze(["D'", "U", "y'"]),
  S: Object.freeze(["F'", "B", "z"]),
});
const WIDE_EXPANSIONS = Object.freeze({
  R: Object.freeze(["R", "M'"]),
  L: Object.freeze(["L", "M"]),
  U: Object.freeze(["U", "E'"]),
  D: Object.freeze(["D", "E"]),
  F: Object.freeze(["F", "S"]),
  B: Object.freeze(["B", "S'"]),
});
const OLL_PARITY_D = "Rw' U2 Rw U2 Rw' F2 Rw2 U2 Rw U2 Rw' U2 F2 Rw2 F2";
const PLL_PARITY_D = "Rw2 R2 U2 Rw2 R2 Uw2 Rw2 R2 Uw2";

const split = (sequence) => String(sequence || "").trim().split(/\s+/).filter(Boolean);

function amount(suffix) {
  const value = String(suffix || "");
  return value.startsWith("2") ? 2 : value === "'" ? 3 : 1;
}

function formatTurn(face, value) {
  const normalized = ((value % 4) + 4) % 4;
  if (!normalized) return "";
  if (normalized === 1) return face;
  if (normalized === 2) return `${face}2`;
  return `${face}'`;
}

function invertToken(token) {
  const match = /^([A-Za-z]+)(2'?|')?$/.exec(String(token || ""));
  return match ? formatTurn(match[1], 4 - amount(match[2])) : null;
}

function power(base, value) {
  const normalized = ((value % 4) + 4) % 4;
  if (!normalized) return [];
  if (normalized === 1) return [...base];
  if (normalized === 2) return [...base, ...base];
  const output = [];
  for (let index = base.length - 1; index >= 0; index -= 1) {
    const token = invertToken(base[index]);
    if (!token) return null;
    output.push(token);
  }
  return output;
}

function compose(left, right) {
  const output = {};
  for (const face of Object.keys(ID_FACE_MAP)) output[face] = left[right[face]];
  return output;
}

function rotationMap(axis, value) {
  let output = { ...ID_FACE_MAP };
  const quarter = ROT_FACE_MAP[axis];
  if (!quarter) return null;
  for (let turn = 0; turn < value; turn += 1) output = compose(output, quarter);
  return output;
}

function inverseMap(map) {
  const output = {};
  for (const face of Object.keys(ID_FACE_MAP)) output[map[face]] = face;
  return output;
}

function frameMap(rotation) {
  let map = { ...ID_FACE_MAP };
  for (const token of split(rotation)) {
    const match = /^([xyz])(2|')?$/.exec(token);
    if (!match) continue;
    map = compose(map, rotationMap(match[1], amount(match[2])));
  }
  return map;
}

function simplifyOuter(moves) {
  const output = [];
  for (const raw of moves) {
    const match = /^([URFDLB])(2|')?$/.exec(raw);
    if (!match) return null;
    const previous = output.at(-1);
    const previousMatch = previous ? /^([URFDLB])(2|')?$/.exec(previous) : null;
    if (!previousMatch || previousMatch[1] !== match[1]) {
      output.push(formatTurn(match[1], amount(match[2])));
      continue;
    }
    output.pop();
    const merged = formatTurn(match[1], (amount(previousMatch[2]) + amount(match[2])) % 4);
    if (merged) output.push(merged);
  }
  return output;
}

function compileCfopSegments(segments) {
  let faceMap = { ...ID_FACE_MAP };
  const output = [];
  const process = (raw, destination) => {
    const token = String(raw || "").trim();
    if (!token) return true;
    let match = /^([xyzXYZ])(2'?|')?$/.exec(token);
    if (match) {
      faceMap = compose(faceMap, rotationMap(match[1].toLowerCase(), amount(match[2])));
      return true;
    }
    match = /^([MESmes])(2'?|')?$/.exec(token);
    if (match) {
      const expanded = power(SLICE_EXPANSIONS[match[1].toUpperCase()], amount(match[2]));
      return !!expanded && expanded.every((expandedToken) => process(expandedToken, destination));
    }
    match = /^([URFDLB])(w)?(2'?|')?$/.exec(token);
    if (match?.[2]) {
      const expanded = power(WIDE_EXPANSIONS[match[1]], amount(match[3]));
      return !!expanded && expanded.every((expandedToken) => process(expandedToken, destination));
    }
    if (!match) {
      const lowerWide = /^([urfdlb])(2'?|')?$/.exec(token);
      if (lowerWide) {
        const expanded = power(WIDE_EXPANSIONS[lowerWide[1].toUpperCase()], amount(lowerWide[2]));
        return !!expanded && expanded.every((expandedToken) => process(expandedToken, destination));
      }
      return false;
    }
    destination.push(formatTurn(faceMap[match[1]], amount(match[3])));
    return true;
  };

  for (const stage of segments || []) {
    const moves = [];
    for (const token of split(stage.solution)) {
      if (!process(token, moves)) return null;
    }
    const simplified = simplifyOuter(moves);
    if (!simplified) return null;
    output.push({ ...stage, solution: simplified.join(" "), moveCount: simplified.length });
  }
  if (!Object.keys(ID_FACE_MAP).every((face) => faceMap[face] === face)) return null;
  return output;
}

function rawCubie(pattern) {
  const patternData = pattern?.patternData;
  const edges = patternData?.EDGES;
  if (!patternData?.CORNERS || !edges) return null;
  const ep = new Array(12).fill(-1);
  const eo = new Array(12).fill(0);
  for (let slot = 0; slot < 12; slot += 1) {
    const [first, second] = EDGE_SLOT_PAIRS_444[slot];
    const firstType = EDGE_TYPE_BY_WING_444[Number(edges.pieces[first])];
    const secondType = EDGE_TYPE_BY_WING_444[Number(edges.pieces[second])];
    if (
      firstType < 0 ||
      firstType !== secondType ||
      Number(edges.orientation[first]) !== Number(edges.orientation[second])
    ) {
      return null;
    }
    ep[EDGE_SLOT_TO_333_444[slot]] = EDGE_SLOT_TO_333_444[firstType];
    eo[EDGE_SLOT_TO_333_444[slot]] = Number(edges.orientation[first]);
  }
  return {
    cp: Array.from(patternData.CORNERS.pieces, Number),
    co: Array.from(patternData.CORNERS.orientation, Number),
    ep,
    eo,
  };
}

function build333(solved, cubie) {
  const patternData = structuredClone(solved.patternData);
  patternData.CORNERS.pieces = [...cubie.cp];
  patternData.CORNERS.orientation = [...cubie.co];
  patternData.EDGES.pieces = [...cubie.ep];
  patternData.EDGES.orientation = [...cubie.eo];
  return new solved.constructor(solved.kpuzzle, patternData);
}

function transformPattern(pattern, solved, rotation) {
  if (!rotation) return pattern;
  try {
    const patternTransform = pattern.experimentalToTransformation();
    const rotationTransform = solved.applyAlg(rotation).experimentalToTransformation();
    return rotationTransform
      .invert()
      .applyTransformation(patternTransform)
      .applyTransformation(rotationTransform)
      .toKPattern();
  } catch (_) {
    return null;
  }
}

function normalizeStageName(name) {
  return /^Cross\b/i.test(String(name || "")) ? "Cross" : String(name || "CFOP").trim();
}

function asSegments(result) {
  return (result?.stages || []).map((stage, index) => ({
    id: `cfop${index + 1}`,
    name: normalizeStageName(stage.name),
    solution: String(stage.solution || "").trim(),
    moveCount: split(stage.solution).length,
    verified: true,
  }));
}

async function solveLogical(cubie, stopAfterStage, deadlineTs) {
  const solved = await getDefaultPattern("333");
  return solve3x3StrictCfopFromPattern(build333(solved, cubie), {
    mode: "strict",
    crossColor: "D",
    solverVersion: "v2",
    deadlineTs,
    enableHumanViewpoint: false,
    enableMixedCfopStages: false,
    ...(stopAfterStage ? { stopAfterStage } : {}),
  });
}

function stageSubset(compiled, name) {
  return compiled.filter((stage) => String(stage.name).toUpperCase() === name.toUpperCase());
}

function mapAlg(sequence, map) {
  return split(sequence).map((token) => {
    const match = /^([URFDLB])(w)?(2|')?$/.exec(token);
    if (!match) throw new Error(`BAD_444_LOGICAL_MOVE:${token}`);
    return `${map[match[1]]}${match[2] || ""}${match[3] || ""}`;
  }).join(" ");
}

function mapSegments(segments, map) {
  return segments.map((stage) => ({
    ...stage,
    solution: mapAlg(stage.solution, map),
    moveCount: split(stage.solution).length,
  }));
}

function isSolved(pattern) {
  return typeof pattern?.experimentalIsSolved === "function"
    ? pattern.experimentalIsSolved({ ignorePuzzleOrientation: false })
    : false;
}

function permutationOdd(values) {
  let odd = false;
  for (let first = 0; first < values.length; first += 1) {
    for (let second = first + 1; second < values.length; second += 1) {
      if (Number(values[first]) > Number(values[second])) odd = !odd;
    }
  }
  return odd;
}

function paritySignature333(pattern) {
  const data = pattern?.patternData;
  const eo = Array.from(data?.EDGES?.orientation || [], Number);
  const ep = Array.from(data?.EDGES?.pieces || [], Number);
  const cp = Array.from(data?.CORNERS?.pieces || [], Number);
  return {
    oll: eo.reduce((sum, value) => sum + value, 0) % 2 !== 0,
    pll: permutationOdd(cp) !== permutationOdd(ep),
  };
}

async function parityTransform444(kind, solved333, kp444) {
  const algorithm = kind === "oll" ? OLL_PARITY_D : PLL_PARITY_D;
  const parityPattern444 = kp444.defaultPattern().applyAlg(algorithm);
  const cubie = rawCubie(parityPattern444);
  if (!cubie) return null;
  return build333(solved333, cubie).experimentalToTransformation();
}

export async function solveLlDeferred444({
  scramble,
  centerSolution = "",
  edgeSolution = "",
  crossColor = "D",
  deadlineTs = 0,
  onProgress = null,
}) {
  const kp444 = await puzzles["4x4x4"].kpuzzle();
  const solved444 = kp444.defaultPattern();
  let physical = solved444;
  if (scramble) physical = physical.applyAlg(scramble);
  if (centerSolution) physical = physical.applyAlg(centerSolution);
  if (edgeSolution) physical = physical.applyAlg(edgeSolution);
  const raw = rawCubie(physical);
  if (!raw) return { ok: false, reason: "RAW_VIRTUAL_333_FAILED" };

  const solved333 = await getDefaultPattern("333");
  const rotation = CROSS_ROTATION_444[crossColor] ?? "";
  let logical = transformPattern(build333(solved333, raw), solved333, rotation);
  if (!logical) return { ok: false, reason: "444_LL_FRAME_FAILED" };

  const logicalSegments = [];
  let nodes = 0;
  const run = async (stopAfterStage) => {
    const cubie = {
      cp: Array.from(logical.patternData.CORNERS.pieces, Number),
      co: Array.from(logical.patternData.CORNERS.orientation, Number),
      ep: Array.from(logical.patternData.EDGES.pieces, Number),
      eo: Array.from(logical.patternData.EDGES.orientation, Number),
    };
    const result = await solveLogical(cubie, stopAfterStage, deadlineTs);
    nodes += Number(result?.nodes) || 0;
    if (!result?.ok) return { ok: false, result };
    const compiled = compileCfopSegments(asSegments(result));
    if (!compiled) return { ok: false, result: { reason: "CFOP_COMPILE_FAILED" } };
    const algorithm = compiled.map((stage) => stage.solution).filter(Boolean).join(" ");
    if (algorithm) logical = logical.applyAlg(algorithm);
    return { ok: true, result, compiled, algorithm };
  };

  let part = await run("F2L");
  if (!part.ok) return { ok: false, reason: part.result?.reason || "F2L_FAILED" };
  logicalSegments.push(...part.compiled.filter(
    (stage) => stage.name === "Cross" || /^F2L(?:\s|$)/.test(stage.name),
  ));
  onProgress?.({ stageName: "F2L" });

  const llEntryParity = paritySignature333(logical);
  const detectedOllParity = llEntryParity.oll;
  if (detectedOllParity) {
    const transform = await parityTransform444("oll", solved333, kp444);
    if (!transform) return { ok: false, reason: "OLL_PARITY_TRANSFORM_FAILED" };
    logical = logical.applyTransformation(transform);
    logicalSegments.push({
      id: "ollParity",
      name: "OLL Parity",
      solution: OLL_PARITY_D,
      moveCount: split(OLL_PARITY_D).length,
      verified: true,
      parity: true,
    });
    onProgress?.({ stageName: "OLL Parity" });
  }

  part = await run("OLL");
  if (!part.ok) return { ok: false, reason: part.result?.reason || "OLL_FAILED" };
  const ollStages = stageSubset(part.compiled, "OLL");
  logicalSegments.push(...(ollStages.length ? ollStages : [{
    id: "cfopOLL",
    name: "OLL",
    solution: "",
    moveCount: 0,
    verified: true,
  }]));
  onProgress?.({ stageName: "OLL" });

  const postOllParity = paritySignature333(logical);
  const detectedPllParity = postOllParity.pll;
  if (detectedPllParity) {
    const transform = await parityTransform444("pll", solved333, kp444);
    if (!transform) return { ok: false, reason: "PLL_PARITY_TRANSFORM_FAILED" };
    logical = logical.applyTransformation(transform);
    logicalSegments.push({
      id: "pllParity",
      name: "PLL Parity",
      solution: PLL_PARITY_D,
      moveCount: split(PLL_PARITY_D).length,
      verified: true,
      parity: true,
    });
    onProgress?.({ stageName: "PLL Parity" });
  }

  const finalCubie = {
    cp: Array.from(logical.patternData.CORNERS.pieces, Number),
    co: Array.from(logical.patternData.CORNERS.orientation, Number),
    ep: Array.from(logical.patternData.EDGES.pieces, Number),
    eo: Array.from(logical.patternData.EDGES.orientation, Number),
  };
  const finalPll = await solveLogical(finalCubie, "", deadlineTs);
  nodes += Number(finalPll?.nodes) || 0;
  if (!finalPll?.ok) return { ok: false, reason: finalPll?.reason || "PLL_FAILED" };
  const pllCompiled = compileCfopSegments([{
    id: "cfopPLL",
    name: "PLL",
    solution: String(finalPll.solution || "").trim(),
    moveCount: split(finalPll.solution).length,
    verified: true,
  }]);
  if (!pllCompiled) return { ok: false, reason: "PLL_COMPILE_FAILED" };
  const pllAlgorithm = pllCompiled.map((stage) => stage.solution).filter(Boolean).join(" ");
  if (pllAlgorithm) logical = logical.applyAlg(pllAlgorithm);
  logicalSegments.push(...pllCompiled);
  onProgress?.({ stageName: "PLL" });

  if (!isSolved(logical)) {
    return {
      ok: false,
      reason: "LL_LOGICAL_FINAL_NOT_SOLVED",
      finalSignature: paritySignature333(logical),
      detectedOllParity,
      detectedPllParity,
    };
  }

  const direct = frameMap(rotation);
  const inverse = inverseMap(direct);
  let physicalSegments = null;
  let frameMapping = null;
  for (const [label, map] of [["direct", direct], ["inverse", inverse]]) {
    const candidate = mapSegments(logicalSegments, map);
    const algorithm = candidate.map((stage) => stage.solution).filter(Boolean).join(" ");
    let candidatePattern = physical;
    try {
      if (algorithm) candidatePattern = candidatePattern.applyAlg(algorithm);
    } catch (_) {
      continue;
    }
    if (isSolved(candidatePattern)) {
      physicalSegments = candidate;
      frameMapping = label;
      break;
    }
  }
  if (!physicalSegments) return { ok: false, reason: "LL_PHYSICAL_FRAME_NOT_SOLVED" };

  const solution = physicalSegments.map((stage) => stage.solution).filter(Boolean).join(" ");
  return {
    ok: true,
    solution,
    moveCount: split(solution).length,
    segments: physicalSegments,
    nodes,
    cfopMoveCount: physicalSegments
      .filter((stage) => !stage.parity)
      .reduce((sum, stage) => sum + stage.moveCount, 0),
    parityMoveCount: physicalSegments
      .filter((stage) => stage.parity)
      .reduce((sum, stage) => sum + stage.moveCount, 0),
    crossRotationAlg: rotation,
    frameMapping,
    ollParityDetected: detectedOllParity,
    pllParityDetected: detectedPllParity,
    llEntryParity,
    postOllParity,
  };
}
