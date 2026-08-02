from pathlib import Path

path = Path("solver/fmcSolver.js")
source = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    source = source.replace(old, new, 1)


replace_once(
'''function canonicalizeAlg(algText) {
  return joinMoves(simplifyMoves(splitMoves(algText)));
}

function isReverseScrambleSolution(solutionText, reverseScrambleCanonical) {
  if (!solutionText || !reverseScrambleCanonical) return false;
  return canonicalizeAlg(solutionText) === reverseScrambleCanonical;
}
''',
'''const FMC_CANONICAL_AXIS_FACES = Object.freeze([
  Object.freeze(["U", "D"]),
  Object.freeze(["R", "L"]),
  Object.freeze(["F", "B"]),
]);

function parseCanonicalOuterMove(move) {
  const parsed = parseMove(move);
  const face = String(parsed?.face || "").toUpperCase();
  if (!parsed || !Object.prototype.hasOwnProperty.call(FACE_AXIS, face)) return null;
  return { face, amount: parsed.amount };
}

function canonicalizeAlg(algText) {
  const moves = simplifyMoves(splitMoves(algText));
  const canonical = [];
  let index = 0;
  while (index < moves.length) {
    const first = parseCanonicalOuterMove(moves[index]);
    if (!first) {
      canonical.push(moves[index]);
      index += 1;
      continue;
    }

    const axis = FACE_AXIS[first.face];
    const amounts = new Map();
    while (index < moves.length) {
      const parsed = parseCanonicalOuterMove(moves[index]);
      if (!parsed || FACE_AXIS[parsed.face] !== axis) break;
      amounts.set(parsed.face, ((amounts.get(parsed.face) || 0) + parsed.amount) % 4);
      index += 1;
    }

    for (const face of FMC_CANONICAL_AXIS_FACES[axis]) {
      const formatted = formatMove(face, amounts.get(face) || 0);
      if (formatted) canonical.push(formatted);
    }
  }
  return joinMoves(canonical);
}

function isReverseScrambleSolution(solutionText, reverseScrambleCanonical) {
  if (!solutionText || !reverseScrambleCanonical) return false;
  return canonicalizeAlg(solutionText) === reverseScrambleCanonical;
}

export function isTrivialReverseScrambleSolution(scrambleText, solutionText) {
  const reverseScrambleCanonical = canonicalizeAlg(invertAlg(scrambleText));
  return isReverseScrambleSolution(solutionText, reverseScrambleCanonical);
}
''',
"axis-aware reverse canonicalization",
)

replace_once(
'''    candidateCounts: {
      beforeVerification: 0,
      verified: 0,
      reverseAware: 0,
''',
'''    candidateCounts: {
      beforeVerification: 0,
      reverseRejected: 0,
      verified: 0,
      reverseAware: 0,
''',
"reverse rejection count",
)

replace_once(
'''    sourceCounts: {
      generated: {},
      verified: {},
      reverseAware: {},
''',
'''    sourceCounts: {
      generated: {},
      reverseRejected: {},
      verified: {},
      reverseAware: {},
''',
"reverse rejection sources",
)

replace_once(
'''    qualityTargetReached: Number.isFinite(bestMoveCount) && bestMoveCount <= targetMoveCount,
''',
'''    qualityTargetReached:
      Number.isFinite(diagnostics.selectedCandidate?.moveCount) &&
      diagnostics.selectedCandidate.moveCount <= targetMoveCount,
''',
"validated quality target diagnostic",
)

replace_once(
'''  const trackCandidate = (candidate) => {
    if (!candidate) return;
    pushRankedUniqueCandidate(candidates, candidate, qualityMode === "extreme" ? 384 : Infinity);
    if (candidate.moveCount < bestMoveCount) {
      bestMoveCount = candidate.moveCount;
    }
  };
''',
'''  const reverseRejectedSolutions = new Set();
  const rejectReverseCandidate = (candidate) => {
    if (
      !candidate?.solution ||
      !isReverseScrambleSolution(candidate.solution, reverseScrambleCanonical)
    ) {
      return false;
    }
    if (!reverseRejectedSolutions.has(candidate.solution)) {
      reverseRejectedSolutions.add(candidate.solution);
      diagnostics.candidateCounts.reverseRejected += 1;
      incrementCounter(
        diagnostics.sourceCounts.reverseRejected,
        candidate.source || "UNKNOWN",
      );
    }
    return true;
  };
  const trackCandidate = (candidate) => {
    if (!candidate || rejectReverseCandidate(candidate)) return false;
    pushRankedUniqueCandidate(candidates, candidate, qualityMode === "extreme" ? 384 : Infinity);
    if (candidate.moveCount < bestMoveCount) {
      bestMoveCount = candidate.moveCount;
    }
    return true;
  };
''',
"early reverse rejection",
)

replace_once(
'''      if (!candidate) continue;
      trackCandidate(candidate);
      created.push(candidate);
''',
'''      if (!candidate || !trackCandidate(candidate)) continue;
      created.push(candidate);
''',
"tracked result candidates",
)

replace_once(
'''      trackCandidate(candidate);
      diagnostics.phaseRuns.insertion.successes += 1;
''',
'''      if (!trackCandidate(candidate)) continue;
      diagnostics.phaseRuns.insertion.successes += 1;
''',
"anytime insertion reverse rejection",
)

replace_once(
'''            if (candidate) {
              stageCreatedCandidates.push(candidate);
              trackCandidate(candidate);
''',
'''            if (candidate && trackCandidate(candidate)) {
              stageCreatedCandidates.push(candidate);
''',
"WASM candidate reverse rejection",
)

replace_once(
'''          wasmFmcDone = true;
          diagnostics.phaseRuns.direct.successes += 1;
          if (
            Number.isFinite(wasmResult.moveCount) &&
            (!Number.isFinite(diagnostics.phaseRuns.direct.bestMoveCount) ||
              wasmResult.moveCount < diagnostics.phaseRuns.direct.bestMoveCount)
          ) {
            diagnostics.phaseRuns.direct.bestMoveCount = wasmResult.moveCount;
            diagnostics.phaseRuns.direct.bestSource = qualityStage.name;
          }
''',
'''          wasmFmcDone = true;
          if (stageCreatedCandidates.length) {
            diagnostics.phaseRuns.direct.successes += 1;
            const stageBestCandidate = stageCreatedCandidates
              .slice()
              .sort(compareFmcCandidatePriority)[0];
            if (
              Number.isFinite(stageBestCandidate?.moveCount) &&
              (!Number.isFinite(diagnostics.phaseRuns.direct.bestMoveCount) ||
                stageBestCandidate.moveCount < diagnostics.phaseRuns.direct.bestMoveCount)
            ) {
              diagnostics.phaseRuns.direct.bestMoveCount = stageBestCandidate.moveCount;
              diagnostics.phaseRuns.direct.bestSource = qualityStage.name;
            }
          }
''',
"accepted direct-stage diagnostics",
)

replace_once(
'''            for (const flipCandidate of flipResult.candidates) {
              trackCandidate(flipCandidate);
              drFlipCandidateCount += 1;
''',
'''            for (const flipCandidate of flipResult.candidates) {
              if (!trackCandidate(flipCandidate)) continue;
              drFlipCandidateCount += 1;
''',
"DR flip reverse rejection",
)

replace_once(
'''  diagnostics.phaseTimingsMs.verification += Math.max(0, Date.now() - verificationStartedAt);
  if (!validCandidates.length) {
''',
'''  diagnostics.phaseTimingsMs.verification += Math.max(0, Date.now() - verificationStartedAt);
  diagnostics.candidateCounts.verified = validCandidates.length;
  diagnostics.moveCountDistribution.verified = buildMoveCountDistribution(validCandidates);
  diagnostics.topCandidates.verified = snapshotTopCandidates(validCandidates);
  diagnostics.sourceCounts.verified = {};
  for (let i = 0; i < validCandidates.length; i += 1) {
    incrementCounter(diagnostics.sourceCounts.verified, validCandidates[i]?.source || "UNKNOWN");
  }
  if (!validCandidates.length) {
''',
"verified diagnostics refresh",
)

replace_once(
'''          if (
            insertionCandidate &&
            (await verifyCandidate(null, insertionCandidate, { cache: verificationCache, scrambleString: scramble }))
          ) {
''',
'''          if (
            insertionCandidate &&
            !rejectReverseCandidate(insertionCandidate) &&
            (await verifyCandidate(null, insertionCandidate, { cache: verificationCache, scrambleString: scramble }))
          ) {
''',
"post-verification insertion reverse rejection",
)

path.write_text(source, encoding="utf-8")

Path("benchmark-fmc-reverse-scramble-guard.mjs").write_text(
'''import assert from "node:assert/strict";
import { isTrivialReverseScrambleSolution } from "./solver/fmcSolver.js";

const cases = [
  {
    name: "exact inverse",
    scramble: "R U D R'",
    solution: "R D' U' R'",
    expected: true,
  },
  {
    name: "opposite-face commuting notation",
    scramble: "R U D R'",
    solution: "R U' D' R'",
    expected: true,
  },
  {
    name: "same-face cancellation across commuting opposite face",
    scramble: "D' R",
    solution: "R' U D U'",
    expected: true,
  },
  {
    name: "genuine different solution",
    scramble: "R U D R'",
    solution: "R U' D2 R'",
    expected: false,
  },
];

for (const testCase of cases) {
  assert.equal(
    isTrivialReverseScrambleSolution(testCase.scramble, testCase.solution),
    testCase.expected,
    testCase.name,
  );
}

console.log(`FMC reverse-scramble guard: ${cases.length}/${cases.length} cases passed`);
''',
encoding="utf-8",
)

for cleanup_path in (
    Path(".github/workflows/apply-fmc-reverse-scramble-guard.yml"),
    Path(".github/workflows/apply-fmc-reverse-scramble-guard-pr.yml"),
    Path("tools/apply-fmc-reverse-scramble-guard.py"),
):
    if cleanup_path.exists():
        cleanup_path.unlink()
