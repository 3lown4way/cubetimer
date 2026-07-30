const PREWARM_SCRAMBLE = "U2 L' F' R U' F2 L D L2 F' B R2 F' U2 R2 F' U2 F U'";

let residentWarmupPromise = null;

function errorText(error, fallback) {
  return String(error?.message || error || fallback);
}

async function prewarmCfopAndZb(getDefaultPattern) {
  const startedAt = performance.now();
  try {
    const {
      prewarm3x3StrictCfopLibraries,
      solve3x3StrictCfopFromPattern,
    } = await import("./cfop3x3.js");

    await Promise.all([
      prewarm3x3StrictCfopLibraries({
        solverVersion: "v1",
        includeF2L: true,
        includeSingleStage: true,
      }),
      prewarm3x3StrictCfopLibraries({
        solverVersion: "v2",
        includeF2L: true,
        includeSingleStage: true,
      }),
    ]);

    const solved = await getDefaultPattern("333");
    const pattern = solved.applyAlg(PREWARM_SCRAMBLE);
    const warmed = [];

    for (const entry of [
      { mode: "strict", solverVersion: "v2" },
      { mode: "zb", solverVersion: "v2" },
      { mode: "strict", solverVersion: "v1" },
      { mode: "zb", solverVersion: "v1" },
    ]) {
      const solveStartedAt = performance.now();
      const result = await solve3x3StrictCfopFromPattern(pattern, {
        mode: entry.mode,
        solverVersion: entry.solverVersion,
        scramble: PREWARM_SCRAMBLE,
        crossColor: "D",
        f2lMethod: "legacy",
        enableMixedCfopStages: false,
        enableOllPllPrediction: false,
        allowRelaxedSearch: false,
      }).catch((error) => ({
        ok: false,
        reason: errorText(error, "PREWARM_SOLVE_FAILED"),
      }));

      let valid = false;
      try {
        valid = result?.ok === true
          && pattern.applyAlg(result.solution).isIdentical(solved);
      } catch {
        valid = false;
      }

      warmed.push(Object.freeze({
        ...entry,
        ok: valid,
        elapsedMs: performance.now() - solveStartedAt,
        moveCount: result?.moveCount ?? null,
        reason: valid ? null : String(result?.reason || "INVALID_PREWARM_SOLUTION"),
      }));
    }

    return Object.freeze({
      ok: warmed.every((entry) => entry.ok),
      elapsedMs: performance.now() - startedAt,
      warmed: Object.freeze(warmed),
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      elapsedMs: performance.now() - startedAt,
      reason: errorText(error, "CFOP_ZB_PREWARM_FAILED"),
      warmed: Object.freeze([]),
    });
  }
}

async function prewarmRouxV2() {
  const startedAt = performance.now();
  try {
    const { prewarm3x3RouxV2 } = await import("./roux3x3v2.js");
    await prewarm3x3RouxV2();
    return Object.freeze({
      ok: true,
      elapsedMs: performance.now() - startedAt,
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      elapsedMs: performance.now() - startedAt,
      reason: errorText(error, "ROUX_V2_PREWARM_FAILED"),
    });
  }
}

export function startResidentSolverPrewarm(getDefaultPattern) {
  if (residentWarmupPromise) return residentWarmupPromise;
  residentWarmupPromise = (async () => {
    const startedAt = performance.now();
    const [cfopZb, rouxV2] = await Promise.all([
      prewarmCfopAndZb(getDefaultPattern),
      prewarmRouxV2(),
    ]);
    return Object.freeze({
      ok: cfopZb.ok && rouxV2.ok,
      elapsedMs: performance.now() - startedAt,
      cfopZb,
      rouxV2,
    });
  })().catch((error) => Object.freeze({
    ok: false,
    reason: errorText(error, "RESIDENT_SOLVER_PREWARM_FAILED"),
  }));
  return residentWarmupPromise;
}
