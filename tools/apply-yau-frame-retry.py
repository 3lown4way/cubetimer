from pathlib import Path

path = Path('solver/solver444.js')
s = path.read_text()

def replace_once(old, new, label):
    global s
    if old not in s:
        raise SystemExit(f'missing anchor: {label}')
    s = s.replace(old, new, 1)

replace_once(
'''async function preferYauReduction444(
  api,
  reduction,
  publicScramble,
  internalScramble,
  crossColor,
  deadlineTs,
) {''',
'''async function preferYauReduction444(
  api,
  reduction,
  publicScramble,
  internalScramble,
  crossColor,
  deadlineTs,
  options = {},
) {''',
'preferYauReduction signature',
)

replace_once(
'''      maxMacros: 8,
      postSequence: remainingCenters,
    },''',
'''      maxMacros: 8,
      postSequence: remainingCenters,
      enableRescue: options?.__yauFastFrameProbe !== true,
    },''',
'cross3 rescue flag',
)
replace_once(
'''      alignSolved: true,
      deadlineTs,
      maxMacros: 6,
    },''',
'''      alignSolved: true,
      deadlineTs,
      maxMacros: 6,
      enableRescue: options?.__yauFastFrameProbe !== true,
    },''',
'cross4 rescue flag',
)

replace_once(
'''  if (!cross4?.ok) {
    return yauFailure444(reduction, "444_YAU_CROSS4_FAILED", cross4?.reason || cross4?.detail, deadlineTs);
  }

  const yauSetupPublic = [beforeCross4, cross4.solution]''',
'''  if (!cross4?.ok) {
    return yauFailure444(reduction, "444_YAU_CROSS4_FAILED", cross4?.reason || cross4?.detail, deadlineTs);
  }

  if (options?.__yauProbeOnly === true) {
    return {
      ...reduction,
      ok: true,
      status: "yau_probe",
      reason: null,
      detail: null,
      solution: "",
      moveCount: 0,
      verified: false,
      stages: [],
      meta: {
        ...reduction.meta,
        method444: "yau",
        yauAttempted: true,
        yauProbePassed: true,
        yauCross3MoveCount: Number(cross3.moveCount) || 0,
        yauCross4MoveCount: Number(cross4.moveCount) || 0,
        yauCrossAlignmentMoveCount: Number(cross4.alignmentMoveCount) || 0,
      },
    };
  }

  const yauSetupPublic = [beforeCross4, cross4.solution]''',
'Yau probe return',
)

replace_once(
'''        internalScramble,
        crossColor,
        deadlineTs,
      )
    : await preferHumanEdgePairing323(''',
'''        internalScramble,
        crossColor,
        deadlineTs,
        options,
      )
    : await preferHumanEdgePairing323(''',
'preferYauReduction call options',
)

replace_once(
'''      );

  if (result.meta?.stateValid === true) {''',
'''      );

  if (options?.__yauProbeOnly === true) return result;

  if (result.meta?.stateValid === true) {''',
'probe early return in solve444',
)

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

  // Keep the selected cross face fixed and only spin around its axis. This
  // changes which side-center layout the bounded Yau cross search sees.
  const frameSpins = ["y2", "y'", "", "y"];
  const attempts = [];
  const probePassed = [];
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

  // First probe only through Cross 4/4. This is much cheaper than running
  // 3-2-3 + LL/CFOP four times, and prevents a hostile frame from consuming
  // the entire worker deadline before another frame is tried.
  for (const spin of frameSpins) {
    if (deadlineReached(deadlineTs)) break;
    const orientation = buildOrientation(spin);
    if (!orientation) continue;
    const logicalScramble = mapPhysical444SequenceToLogical(publicScramble, orientation);
    if (logicalScramble == null) continue;
    const now = Date.now();
    const hardDeadline = Number.isFinite(Number(deadlineTs)) && Number(deadlineTs) > 0
      ? Number(deadlineTs)
      : now + 60_000;
    const probeDeadline = Math.min(hardDeadline, now + 6_000);
    const started = Date.now();
    const probe = await solve444(logicalScramble, null, {
      ...options,
      method444: "yau",
      crossColor: "D",
      deadlineTs: probeDeadline,
      __yauCanonicalFrame: true,
      __yauProbeOnly: true,
      __yauFastFrameProbe: true,
    });
    const entry = {
      phase: "probe",
      spin: spin || "identity",
      elapsedMs: Math.max(0, Date.now() - started),
      ok: probe?.ok === true && probe?.status === "yau_probe",
      reason: probe?.reason || null,
    };
    attempts.push(entry);
    if (entry.ok) probePassed.push({ spin, orientation, logicalScramble });
    else lastFailure = probe;
  }

  const fullCandidates = probePassed.length
    ? probePassed
    : frameSpins.map((spin) => {
        const orientation = buildOrientation(spin);
        const logicalScramble = orientation
          ? mapPhysical444SequenceToLogical(publicScramble, orientation)
          : null;
        return orientation && logicalScramble ? { spin, orientation, logicalScramble } : null;
      }).filter(Boolean);

  for (const candidate of fullCandidates) {
    if (deadlineReached(deadlineTs)) break;
    const started = Date.now();
    const logicalResult = await solve444(candidate.logicalScramble, onProgress, {
      ...options,
      method444: "yau",
      crossColor: "D",
      deadlineTs,
      __yauCanonicalFrame: true,
      __yauProbeOnly: false,
      __yauFastFrameProbe: false,
    });
    attempts.push({
      phase: "full",
      spin: candidate.spin || "identity",
      elapsedMs: Math.max(0, Date.now() - started),
      ok: logicalResult?.ok === true,
      reason: logicalResult?.reason || null,
    });
    if (!logicalResult?.ok) {
      lastFailure = logicalResult;
      continue;
    }

    const physicalSolution = mapLogical444SequenceToPhysical(logicalResult.solution, candidate.orientation);
    if (physicalSolution == null) {
      lastFailure = emptyFailure("444_YAU_FRAME_SOLUTION_FAILED", "error", candidate.spin || null, {
        method444: "yau",
        crossColor,
      });
      continue;
    }
    const physicalStages = [];
    let mappingFailed = false;
    for (const stage of Array.isArray(logicalResult.stages) ? logicalResult.stages : []) {
      const mappedStage = mapYauStageToPhysical444(stage, candidate.orientation);
      if (!mappedStage) {
        mappingFailed = true;
        lastFailure = emptyFailure("444_YAU_FRAME_STAGE_FAILED", "error", stage?.name || stage?.id || null, {
          method444: "yau",
          crossColor,
        });
        break;
      }
      physicalStages.push(mappedStage);
    }
    if (mappingFailed) continue;

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
        lastFailure = emptyFailure("444_YAU_FRAME_VERIFICATION_FAILED", "error", candidate.spin || "identity", {
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
        yauFrameSpin: candidate.spin || "identity",
        yauFrameAttemptCount: attempts.length,
        yauFrameProbePassCount: probePassed.length,
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
      yauFrameProbePassCount: probePassed.length,
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
      yauFrameProbePassCount: probePassed.length,
      yauFrameAttempts: attempts,
    },
  };
}
'''
s = s[:start] + new_function + s[end:]

replace_once(
'''  if (method444 === "yau" && crossColor !== "D" && options?.__yauCanonicalFrame !== true) {
    return solveYauCanonicalFrame444(publicScramble, onProgress, options, crossColor, deadlineTs);
  }''',
'''  if (method444 === "yau" && options?.__yauCanonicalFrame !== true) {
    return solveYauCanonicalFrame444(publicScramble, onProgress, options, crossColor, deadlineTs);
  }''',
'solve444 all-Yau frame gate',
)

path.write_text(s)
print('patched probe-first four-frame Yau retry')
