from pathlib import Path

p = Path("solver/solver444.js")
s = p.read_text()

anchor = '''export async function solve444(scramble, onProgress = null, options = {}) {'''
assert anchor in s, "missing solve444 entry"
helper = r'''const YAU_CANONICAL_FRAME_ROTATION_444 = Object.freeze({
  U: "x2",
  R: "z",
  F: "x'",
  D: "",
  L: "z'",
  B: "x",
});

function inverseFaceMap444(faceMap) {
  const inverse = {};
  for (const face of VIEW_FACE_ORDER_444) inverse[faceMap[face]] = face;
  return inverse;
}

function yauCanonicalOrientation444(crossColor) {
  const token = YAU_CANONICAL_FRAME_ROTATION_444[crossColor] || "";
  let map = { ...CFOP_444_IDENTITY_FACE_MAP };
  if (token) {
    const parsed = rotationTokenAmount444(token);
    const rotation = parsed ? cfop444RotationMap(parsed.axis, parsed.amount) : null;
    if (!rotation) return null;
    map = rotation;
  }
  return {
    token,
    map,
    key: viewMapKey444(map),
  };
}

function rotationTokenForFaceMap444(faceMap) {
  for (const token of VIEW_ROTATION_TOKENS_444) {
    const parsed = rotationTokenAmount444(token);
    if (!parsed) continue;
    const candidate = cfop444RotationMap(parsed.axis, parsed.amount);
    if (candidate && viewMapKey444(candidate) === viewMapKey444(faceMap)) return token;
  }
  if (viewMapKey444(faceMap) === viewMapKey444(CFOP_444_IDENTITY_FACE_MAP)) return "";
  return null;
}

function mapLogical444MoveToPhysical(token, orientation) {
  const raw = String(token || "").trim();
  if (!raw) return "";
  let match = /^([URFDLB])(w)?(2|')?$/.exec(raw);
  if (match) {
    const face = orientation.map[match[1]];
    if (!face) return null;
    return `${face}${match[2] || ""}${match[3] || ""}`;
  }
  match = /^([xyz])(2|')?$/.exec(raw);
  if (match) {
    const logicalRotation = cfop444RotationMap(match[1], cfop444TurnAmount(match[2]));
    if (!logicalRotation) return null;
    const inverseFrame = inverseFaceMap444(orientation.map);
    const physicalRotation = cfop444ComposeFaceMaps(
      orientation.map,
      cfop444ComposeFaceMaps(logicalRotation, inverseFrame),
    );
    return rotationTokenForFaceMap444(physicalRotation);
  }
  return null;
}

function mapLogical444SequenceToPhysical(sequence, orientation) {
  const output = [];
  for (const token of splitAlgorithm(sequence)) {
    const mapped = mapLogical444MoveToPhysical(token, orientation);
    if (mapped == null) return null;
    if (mapped) output.push(mapped);
  }
  return output.join(" ");
}

function mapPhysical444SequenceToLogical(sequence, orientation) {
  const output = [];
  for (const raw of splitAlgorithm(sequence)) {
    let token = raw;
    const lowerWide = /^([urfdlb])(2|')?$/.exec(token);
    if (lowerWide) token = `${lowerWide[1].toUpperCase()}w${lowerWide[2] || ""}`;
    const mapped = remapPhysical444MoveForView(token, orientation);
    if (!mapped) return null;
    output.push(mapped);
  }
  return output.join(" ");
}

function mapYauStageToPhysical444(stage, orientation) {
  const solution = mapLogical444SequenceToPhysical(stage?.solution || "", orientation);
  if (solution == null) return null;
  const mapped = {
    ...stage,
    solution,
    moveCount: countMetric444Moves(solution),
  };
  if (Array.isArray(stage?.segments)) {
    mapped.segments = [];
    for (const segment of stage.segments) {
      const mappedSegment = mapYauStageToPhysical444(segment, orientation);
      if (!mappedSegment) return null;
      mapped.segments.push(mappedSegment);
    }
  }
  return mapped;
}

async function solveYauCanonicalFrame444(
  publicScramble,
  onProgress,
  options,
  crossColor,
  deadlineTs,
) {
  const orientation = yauCanonicalOrientation444(crossColor);
  if (!orientation) {
    return emptyFailure("444_YAU_FRAME_INVALID", "error", crossColor, { method444: "yau", crossColor });
  }
  const logicalScramble = mapPhysical444SequenceToLogical(publicScramble, orientation);
  if (logicalScramble == null) {
    return emptyFailure("444_YAU_FRAME_SCRAMBLE_FAILED", "invalid", publicScramble, {
      method444: "yau",
      crossColor,
    });
  }

  const logicalResult = await solve444(logicalScramble, onProgress, {
    ...options,
    method444: "yau",
    crossColor: "D",
    deadlineTs,
    __yauCanonicalFrame: true,
  });
  if (!logicalResult?.ok) {
    return {
      ...logicalResult,
      meta: {
        ...(logicalResult?.meta || {}),
        method444: "yau",
        crossColor,
        yauCanonicalCrossColor: "D",
        yauFrameRotation: orientation.token,
      },
    };
  }

  const physicalSolution = mapLogical444SequenceToPhysical(logicalResult.solution, orientation);
  if (physicalSolution == null) {
    return emptyFailure("444_YAU_FRAME_SOLUTION_FAILED", "error", null, {
      method444: "yau",
      crossColor,
    });
  }
  const physicalStages = [];
  for (const stage of Array.isArray(logicalResult.stages) ? logicalResult.stages : []) {
    const mappedStage = mapYauStageToPhysical444(stage, orientation);
    if (!mappedStage) {
      return emptyFailure("444_YAU_FRAME_STAGE_FAILED", "error", stage?.name || stage?.id || null, {
        method444: "yau",
        crossColor,
      });
    }
    physicalStages.push(mappedStage);
  }

  try {
    const { puzzles } = await import("../vendor/cubing/puzzles/index.js");
    const kpuzzle = await puzzles["4x4x4"].kpuzzle();
    let pattern = kpuzzle.defaultPattern();
    if (publicScramble) pattern = pattern.applyAlg(publicScramble);
    if (physicalSolution) pattern = pattern.applyAlg(physicalSolution);
    const solved = typeof pattern.experimentalIsSolved === "function"
      ? pattern.experimentalIsSolved({ ignorePuzzleOrientation: false })
      : JSON.stringify(pattern.patternData) === JSON.stringify(kpuzzle.defaultPattern().patternData);
    if (!solved) {
      return emptyFailure("444_YAU_FRAME_VERIFICATION_FAILED", "error", orientation.token, {
        method444: "yau",
        crossColor,
      });
    }
  } catch (error) {
    return emptyFailure("444_YAU_FRAME_VERIFICATION_FAILED", "error", error?.message || error, {
      method444: "yau",
      crossColor,
    });
  }

  return {
    ...logicalResult,
    solution: physicalSolution,
    moveCount: countMetric444Moves(physicalSolution),
    stages: physicalStages,
    meta: {
      ...logicalResult.meta,
      method444: "yau",
      crossColor,
      yauCanonicalCrossColor: "D",
      yauFrameRotation: orientation.token,
      fullVerificationSolved: true,
    },
  };
}

'''
s = s.replace(anchor, helper + anchor, 1)

old = '''  const method444 = String(options?.method444 || "reduction").trim().toLowerCase() === "yau"
    ? "yau"
    : "reduction";
  const publicScramble = String(scramble || "").trim();
  const internalScramble = translate444MoveConvention(publicScramble);'''
new = '''  const method444 = String(options?.method444 || "reduction").trim().toLowerCase() === "yau"
    ? "yau"
    : "reduction";
  const publicScramble = String(scramble || "").trim();
  if (method444 === "yau" && crossColor !== "D" && options?.__yauCanonicalFrame !== true) {
    return solveYauCanonicalFrame444(publicScramble, onProgress, options, crossColor, deadlineTs);
  }
  const internalScramble = translate444MoveConvention(publicScramble);'''
assert old in s, "missing solve444 canonical-frame insertion point"
s = s.replace(old, new, 1)

p.write_text(s)
print("Yau non-D cross colors now reuse canonical D-frame implementation by cube conjugation")
