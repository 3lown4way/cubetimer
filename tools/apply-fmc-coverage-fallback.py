from pathlib import Path

path = Path(__file__).resolve().parents[1] / "solver" / "wasmSolver.js"
text = path.read_text()
old = '''/**
 * Run the full FMC pipeline (EO→DR→P2, 3 axes, NISS, premove sweep) entirely in WASM.
 * Returns { ok, solution, moveCount, candidates } or null.
 */
export async function solveFmcWasm(scramble, options = {}) {
  let api;
  try {
    api = await ensureTwophase333Ready();
  } catch (_) {
    return null;
  }
  if (!api || typeof api.solveFmcWasm !== "function") return null;
  try {
    const optionsJson = JSON.stringify({
      maxPremoveSets: options.maxPremoveSets ?? 120,
      forceRzp: options.forceRzp ?? false,
      enableMultiInsertion: options.enableMultiInsertion === true,
    });
    const raw = api.solveFmcWasm(scramble, optionsJson);
    if (!raw) return null;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && parsed.ok !== undefined ? parsed : null;
  } catch (err) {
    console.warn("[solveFmcWasm] error:", err);
    return null;
  }
}
'''
new = '''async function solveFmcTwophaseFallback(api, scramble, originalResult) {
  const attempts = [
    {
      prepare: {
        maxPhase1Solutions: 4,
        phase1MaxDepth: 13,
        phase1NodeLimit: 4_000_000,
      },
      search: {
        phase2MaxDepth: 20,
        phase2NodeLimit: 12_000_000,
      },
    },
    {
      prepare: {
        maxPhase1Solutions: 12,
        phase1MaxDepth: 13,
        phase1NodeLimit: 12_000_000,
      },
      search: {
        phase2MaxDepth: 20,
        phase2NodeLimit: 30_000_000,
      },
    },
  ];

  for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
    const attempt = attempts[attemptIndex];
    let searchId = null;
    try {
      const prepared = parseJsonResponse(
        api.prepareTwophase333(String(scramble || ""), JSON.stringify(attempt.prepare)),
      );
      if (!prepared?.ok || !Number.isFinite(prepared.searchId)) continue;
      searchId = prepared.searchId;
      const searched = parseJsonResponse(
        api.searchTwophase333(searchId, JSON.stringify(attempt.search)),
      );
      if (!searched?.ok || !searched.solution) continue;

      const verification = parseJsonResponse(
        api.verifyFmcSolutionWasm(String(scramble || ""), String(searched.solution)),
      );
      if (!verification?.ok || verification.solved !== true) continue;

      const solution = String(searched.solution).trim();
      const moves = solution.split(/\\s+/).filter(Boolean);
      const moveCount = Number.isFinite(searched.moveCount)
        ? Math.max(0, Math.floor(searched.moveCount))
        : moves.length;
      const candidate = {
        ok: true,
        solution,
        moveCount,
        moves,
        source: "FMC_TWOPHASE_FALLBACK",
        axisName: "",
        eoLength: Number(searched.phase1Depth || 0),
        drLength: 0,
        p2Length: Number(searched.phase2Depth || 0),
        eoMoves: [],
        drMoves: [],
        finishMoves: moves,
        premoves: "",
        rzpUsed: false,
        fallbackUsed: true,
      };
      return {
        ok: true,
        solution,
        moveCount,
        candidates: [candidate],
        skeletonCount: 0,
        skeletons: [],
        insertionCandidateCount: 0,
        mixedInsertionCandidateCount: 0,
        multiInsertionCandidateCount: 0,
        fallbackUsed: true,
        fallbackSource: "TWOPHASE",
        fallbackAttempt: attemptIndex + 1,
        fallbackReason: String(originalResult?.reason || "FMC_NO_SOLUTION"),
      };
    } catch (_) {
      // Try the wider second attempt, then preserve the original FMC failure.
    } finally {
      if (Number.isFinite(searchId)) {
        try {
          api.dropTwophaseSearch(searchId);
        } catch (_) {
          // Search-session cleanup is best effort.
        }
      }
    }
  }
  return originalResult;
}

/**
 * Run the full FMC pipeline (EO→DR→P2, 3 axes, NISS, premove sweep) entirely in WASM.
 * A two-phase coverage fallback runs only when the human-style FMC pipeline returns no candidate.
 * Returns { ok, solution, moveCount, candidates } or null.
 */
export async function solveFmcWasm(scramble, options = {}) {
  let api;
  try {
    api = await ensureTwophase333Ready();
  } catch (_) {
    return null;
  }
  if (!api || typeof api.solveFmcWasm !== "function") return null;
  try {
    const optionsJson = JSON.stringify({
      maxPremoveSets: options.maxPremoveSets ?? 120,
      forceRzp: options.forceRzp ?? false,
      enableMultiInsertion: options.enableMultiInsertion === true,
    });
    const raw = api.solveFmcWasm(scramble, optionsJson);
    if (!raw) return null;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || parsed.ok === undefined) return null;
    if (parsed.ok || options.enableCoverageFallback === false) return parsed;
    return await solveFmcTwophaseFallback(api, scramble, parsed);
  } catch (err) {
    console.warn("[solveFmcWasm] error:", err);
    return null;
  }
}
'''
if old not in text:
    if "solveFmcTwophaseFallback" in text:
        print("FMC coverage fallback already applied")
    else:
        raise RuntimeError("solveFmcWasm block not found")
else:
    path.write_text(text.replace(old, new, 1))
    print("FMC coverage fallback applied")
