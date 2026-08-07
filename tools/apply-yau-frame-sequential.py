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

  const frameSpins = ["y2", "y'", "", "y"];
  const attempts = [];
  let lastFailure = null;

  const buildOrientation = (spin) => {
    let map = { ...baseOrientation.map };
    if (spin) {
      const parsed = rotationTokenAmount444(spin);
      const rotation = parsed ? cfop444RotationMap(parsed.axis, parsed.amount) : null;
      if (!rotation) return null;
      map = cfop444ComposeFaceMaps(baseOrientation.map, rotation);
    }
    return { token: baseOrientation.token, map, key: viewMapKey444(map) };
  };

  const mapVerifiedSuccess = async (logicalResult, candidate) => {
    const physicalSolution = mapLogical444SequenceToPhysical(logicalResult.solution, candidate.orientation);
    if (physicalSolution == null) return null;
    const physicalStages = [];
    for (const stage of Array.isArray(logicalResult.stages) ? logicalResult.stages : []) {
      const mappedStage = mapYauStageToPhysical444(stage, candidate.orientation);
      if (!mappedStage) return null;
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
      if (!solved) return null;
    } catch (_) {
      return null;
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
        yauFrameSpin: candidate.spin || "identity",
        yauFrameAttemptCount: attempts.length,
        yauFrameAttempts: attempts,
        fullVerificationSolved: true,
      },
    };
  };

  // Probe a frame and, once it demonstrates a valid Cross 4/4 setup, solve it
  // immediately. This avoids paying for the other three probes when the first
  // useful frame already works.
  for (let frameIndex = 0; frameIndex < frameSpins.length; frameIndex += 1) {
    if (deadlineReached(deadlineTs)) break;
    const spin = frameSpins[frameIndex];
    const orientation = buildOrientation(spin);
    if (!orientation) continue;
    const logicalScramble = mapPhysical444SequenceToLogical(publicScramble, orientation);
    if (logicalScramble == null) continue;
    const candidate = { spin, orientation, logicalScramble };

    const probeStarted = Date.now();
    const hardDeadline = Number.isFinite(Number(deadlineTs)) && Number(deadlineTs) > 0
      ? Number(deadlineTs)
      : probeStarted + 60_000;
    const probe = await solve444(logicalScramble, null, {
      ...options,
      method444: "yau",
      crossColor: "D",
      deadlineTs: Math.min(hardDeadline, probeStarted + 6_000),
      __yauCanonicalFrame: true,
      __yauProbeOnly: true,
      __yauFastFrameProbe: true,
    });
    const probeOk = probe?.ok === true && probe?.status === "yau_probe";
    attempts.push({
      phase: "probe",
      spin: spin || "identity",
      elapsedMs: Math.max(0, Date.now() - probeStarted),
      ok: probeOk,
      reason: probe?.reason || null,
    });
    if (!probeOk) {
      lastFailure = probe;
      continue;
    }

    const fullStarted = Date.now();
    const remaining = Math.max(0, hardDeadline - fullStarted);
    const framesLeft = Math.max(1, frameSpins.length - frameIndex);
    const fullBudget = Math.max(6_000, Math.min(14_000, Math.floor(remaining / framesLeft)));
    const logicalResult = await solve444(logicalScramble, onProgress, {
      ...options,
      method444: "yau",
      crossColor: "D",
      deadlineTs: Math.min(hardDeadline, fullStarted + fullBudget),
      __yauCanonicalFrame: true,
      __yauProbeOnly: false,
      __yauFastFrameProbe: false,
    });
    attempts.push({
      phase: "full",
      spin: spin || "identity",
      elapsedMs: Math.max(0, Date.now() - fullStarted),
      ok: logicalResult?.ok === true,
      reason: logicalResult?.reason || null,
    });
    if (!logicalResult?.ok) {
      lastFailure = logicalResult;
      continue;
    }
    const mapped = await mapVerifiedSuccess(logicalResult, candidate);
    if (mapped) return mapped;
    lastFailure = emptyFailure("444_YAU_FRAME_VERIFICATION_FAILED", "error", spin || "identity", {
      method444: "yau",
      crossColor,
    });
  }

  // If no cheap probe succeeds, spend the remaining budget on bounded deep
  // rescue attempts. Every frame gets a chance; no single hostile frame may
  // consume the whole worker deadline.
  for (let frameIndex = 0; frameIndex < frameSpins.length; frameIndex += 1) {
    if (deadlineReached(deadlineTs)) break;
    const spin = frameSpins[frameIndex];
    const orientation = buildOrientation(spin);
    if (!orientation) continue;
    const logicalScramble = mapPhysical444SequenceToLogical(publicScramble, orientation);
    if (logicalScramble == null) continue;
    const candidate = { spin, orientation, logicalScramble };
    const started = Date.now();
    const hardDeadline = Number.isFinite(Number(deadlineTs)) && Number(deadlineTs) > 0
      ? Number(deadlineTs)
      : started + 60_000;
    const remaining = Math.max(0, hardDeadline - started);
    const framesLeft = Math.max(1, frameSpins.length - frameIndex);
    const rescueBudget = Math.max(4_000, Math.min(10_000, Math.floor(remaining / framesLeft)));
    const logicalResult = await solve444(logicalScramble, onProgress, {
      ...options,
      method444: "yau",
      crossColor: "D",
      deadlineTs: Math.min(hardDeadline, started + rescueBudget),
      __yauCanonicalFrame: true,
      __yauProbeOnly: false,
      __yauFastFrameProbe: false,
    });
    attempts.push({
      phase: "rescue",
      spin: spin || "identity",
      elapsedMs: Math.max(0, Date.now() - started),
      ok: logicalResult?.ok === true,
      reason: logicalResult?.reason || null,
    });
    if (!logicalResult?.ok) {
      lastFailure = logicalResult;
      continue;
    }
    const mapped = await mapVerifiedSuccess(logicalResult, candidate);
    if (mapped) return mapped;
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
path.write_text(s)
print('patched sequential bounded Yau frame retry')
