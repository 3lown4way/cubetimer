from pathlib import Path

path = Path('solver/solver444.js')
s = path.read_text()

start = s.index('async function solveYauCanonicalFrame444(')
end = s.index('\nexport async function solve444', start)
new_function = r'''async function solveYauCanonicalFrame444(
  publicScramble,
  onProgress,
  options,
  crossColor,
  deadlineTs,
) {
  const baseOrientation = yauCanonicalOrientation444(crossColor);
  if (!baseOrientation) {
    return emptyFailure("444_YAU_FRAME_INVALID", "error", crossColor, { method444: "yau", crossColor });
  }

  // Keep the chosen cross face fixed, but allow the four rotations around that
  // axis. Yau quality depends strongly on which side-center/cross-edge layout
  // the center solver happens to expose. A single fixed front/right frame can
  // make a perfectly valid Yau state look unsolvable to the bounded 3/4-cross
  // and 3-2-3 planners.
  const frameSpins = ["", "y2", "y'", "y"];
  const attempts = [];
  let lastFailure = null;

  for (let frameIndex = 0; frameIndex < frameSpins.length; frameIndex += 1) {
    if (deadlineReached(deadlineTs)) break;
    const spin = frameSpins[frameIndex];
    let map = { ...baseOrientation.map };
    if (spin) {
      const parsed = rotationTokenAmount444(spin);
      const rotation = parsed ? cfop444RotationMap(parsed.axis, parsed.amount) : null;
      if (!rotation) continue;
      map = cfop444ComposeFaceMaps(baseOrientation.map, rotation);
    }
    const orientation = {
      token: baseOrientation.token,
      map,
      key: viewMapKey444(map),
    };
    const logicalScramble = mapPhysical444SequenceToLogical(publicScramble, orientation);
    if (logicalScramble == null) {
      lastFailure = emptyFailure("444_YAU_FRAME_SCRAMBLE_FAILED", "invalid", publicScramble, {
        method444: "yau",
        crossColor,
      });
      continue;
    }

    const framesLeft = frameSpins.length - frameIndex;
    const now = Date.now();
    const remaining = Number.isFinite(Number(deadlineTs)) && Number(deadlineTs) > now
      ? Number(deadlineTs) - now
      : 60_000;
    // Do not let a hostile frame consume the whole 4x4 worker budget. A good
    // Yau frame normally completes in a few seconds; a bad frame can spend
    // tens of seconds exhausting an impossible cross constraint.
    const perFrameBudget = Math.max(5_000, Math.min(14_000, Math.floor(remaining / Math.max(1, framesLeft))));
    const attemptDeadline = Number.isFinite(Number(deadlineTs)) && Number(deadlineTs) > 0
      ? Math.min(Number(deadlineTs), now + perFrameBudget)
      : now + perFrameBudget;
    const started = Date.now();
    const logicalResult = await solve444(logicalScramble, onProgress, {
      ...options,
      method444: "yau",
      crossColor: "D",
      deadlineTs: attemptDeadline,
      __yauCanonicalFrame: true,
    });
    attempts.push({
      spin: spin || "identity",
      elapsedMs: Math.max(0, Date.now() - started),
      ok: logicalResult?.ok === true,
      reason: logicalResult?.reason || null,
    });
    if (!logicalResult?.ok) {
      lastFailure = logicalResult;
      continue;
    }

    const physicalSolution = mapLogical444SequenceToPhysical(logicalResult.solution, orientation);
    if (physicalSolution == null) {
      lastFailure = emptyFailure("444_YAU_FRAME_SOLUTION_FAILED", "error", spin || null, {
        method444: "yau",
        crossColor,
      });
      continue;
    }
    const physicalStages = [];
    let stageMappingFailed = false;
    for (const stage of Array.isArray(logicalResult.stages) ? logicalResult.stages : []) {
      const mappedStage = mapYauStageToPhysical444(stage, orientation);
      if (!mappedStage) {
        stageMappingFailed = true;
        lastFailure = emptyFailure("444_YAU_FRAME_STAGE_FAILED", "error", stage?.name || stage?.id || null, {
          method444: "yau",
          crossColor,
        });
        break;
      }
      physicalStages.push(mappedStage);
    }
    if (stageMappingFailed) continue;

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
        lastFailure = emptyFailure("444_YAU_FRAME_VERIFICATION_FAILED", "error", spin || "identity", {
          method444: "yau",
          crossColor,
        });
        continue;
      }
    } catch (error) {
      lastFailure = emptyFailure("444_YAU_FRAME_VERIFICATION_FAILED", "error", error?.message || error, {
        method444: "yau",
        crossColor,
      });
      continue;
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
        yauFrameRotation: baseOrientation.token,
        yauFrameSpin: spin || "identity",
        yauFrameAttemptCount: attempts.length,
        yauFrameAttempts: attempts,
        fullVerificationSolved: true,
      },
    };
  }

  if (deadlineReached(deadlineTs)) {
    return emptyFailure("444_DEADLINE_REACHED", "timeout", lastFailure?.reason || null, {
      method444: "yau",
      crossColor,
      yauCanonicalCrossColor: "D",
      yauFrameRotation: baseOrientation.token,
      yauFrameAttemptCount: attempts.length,
      yauFrameAttempts: attempts,
    });
  }
  return {
    ...(lastFailure || emptyFailure("444_YAU_ALL_FRAMES_FAILED", "partial", null)),
    meta: {
      ...(lastFailure?.meta || {}),
      method444: "yau",
      crossColor,
      yauCanonicalCrossColor: "D",
      yauFrameRotation: baseOrientation.token,
      yauFrameAttemptCount: attempts.length,
      yauFrameAttempts: attempts,
    },
  };
}
'''
s = s[:start] + new_function + s[end:]

old = '''  if (method444 === "yau" && crossColor !== "D" && options?.__yauCanonicalFrame !== true) {
    return solveYauCanonicalFrame444(publicScramble, onProgress, options, crossColor, deadlineTs);
  }'''
new = '''  if (method444 === "yau" && options?.__yauCanonicalFrame !== true) {
    return solveYauCanonicalFrame444(publicScramble, onProgress, options, crossColor, deadlineTs);
  }'''
if old not in s:
    raise SystemExit('missing solve444 Yau frame gate')
s = s.replace(old, new, 1)
path.write_text(s)
print('patched four-frame Yau retry')
