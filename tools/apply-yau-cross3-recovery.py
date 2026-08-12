from pathlib import Path
import re

TOKEN = "20260813-yau-cross3-recovery-1"

# 1) Replace the Cross 3/4 greedy-only solver with bounded edge-order backtracking.
p = Path("solver/edgePairing444.js")
text = p.read_text()
start = text.index("export async function solveYauCross3Natural444(")
end = text.index("\nfunction buildSegment(", start)
new_func = r'''export async function solveYauCross3Natural444(publicScramble, publicSetupSolution, targetTypeMask, options = {}) {
  const globalDeadlineTs = Number(options?.deadlineTs) || 0;
  const budgetMs = Math.max(350, Math.min(5200, Number(options?.timeBudgetMs) || 3000));
  const startedAt = Date.now();
  const localDeadlineTs = globalDeadlineTs > 0
    ? Math.min(globalDeadlineTs, startedAt + budgetMs)
    : startedAt + budgetMs;
  const model = await getPlannerModel();
  let pattern = model.solved;
  if (publicScramble) pattern = pattern.applyAlg(String(publicScramble));
  if (publicSetupSolution) pattern = pattern.applyAlg(String(publicSetupSolution));
  const initialState = compactStateFromPattern(pattern);
  const targetMask = Number(targetTypeMask) >>> 0;
  const protectedCenterFaces = Array.isArray(options?.protectedCenterFaces)
    ? options.protectedCenterFaces
    : ["D", "U"];
  if (!protectedCenterFacesSolved444(initialState, model, protectedCenterFaces)) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS3_CENTERS_NOT_READY" };
  }
  if (!humanYauCrossMacros444(model).length) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS3_MACRO_BANK_EMPTY" };
  }

  const initialSolvedMask = solvedEdgeTypeMask(initialState) & targetMask;
  const initialSolvedCount = bitCount(initialSolvedMask);
  if (initialSolvedCount > 3) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS3_OVERSHOOT_START" };
  }

  // Normal cases still take the cheapest local edge first.  The difference is
  // that we keep the other edge choices on a tiny DFS stack.  If a locally
  // cheapest first/second edge makes the next cross edge impossible, we
  // backtrack to another *edge order* instead of failing the whole Yau solve.
  // This is at most 4*3*2 leaf orders; it does not widen the underlying move
  // search or introduce generic reduction macros.
  const stack = [{
    state: initialState,
    solvedMask: initialSolvedMask,
    moves: [],
    steps: [],
    candidates: null,
    nextIndex: 0,
  }];
  let solvedNode = null;
  let expandedNodes = 0;
  let backtrackCount = 0;

  while (stack.length && !deadlineReached(localDeadlineTs)) {
    const node = stack[stack.length - 1];
    const solvedCount = bitCount(node.solvedMask);
    if (solvedCount === 3) {
      solvedNode = node;
      break;
    }

    if (node.candidates == null) {
      const candidates = [];
      for (let edgeType = 0; edgeType < 12; edgeType += 1) {
        const bit = 1 << edgeType;
        if (!(targetMask & bit) || (node.solvedMask & bit)) continue;
        const candidate = humanYauCrossCandidate444(
          node.state,
          node.solvedMask,
          targetMask,
          edgeType,
          model,
          protectedCenterFaces,
          localDeadlineTs,
        );
        if (candidate) candidates.push({ ...candidate, edgeType });
        if (deadlineReached(localDeadlineTs)) break;
      }
      candidates.sort((left, right) => left.cost - right.cost || left.moves.length - right.moves.length);
      node.candidates = candidates;
      node.nextIndex = 0;
      expandedNodes += 1;
    }

    if (node.nextIndex >= node.candidates.length) {
      stack.pop();
      if (stack.length) backtrackCount += 1;
      continue;
    }

    const candidate = node.candidates[node.nextIndex++];
    const nextSolvedCount = bitCount(candidate.solvedMask);
    stack.push({
      state: candidate.state,
      solvedMask: candidate.solvedMask,
      moves: [...node.moves, ...candidate.moves],
      steps: [...node.steps, {
        edgeType: candidate.edgeType,
        workingSlice: candidate.workingSlice,
        moveCount: candidate.moves.length,
        solvedCrossCount: nextSolvedCount,
        macro: candidate.macro,
      }],
      candidates: null,
      nextIndex: 0,
    });
  }

  if (!solvedNode) {
    const deepest = stack.reduce((best, node) =>
      bitCount(node.solvedMask) > bitCount(best.solvedMask) ? node : best,
      { solvedMask: initialSolvedMask },
    );
    return {
      ok: false,
      reason: deadlineReached(localDeadlineTs)
        ? "444_YAU_HUMAN_CROSS3_TIMEOUT"
        : "444_YAU_HUMAN_CROSS3_EDGE_ORDER_EXHAUSTED",
      moveCount: 0,
      solvedCrossCount: bitCount(deepest.solvedMask),
      elapsedMs: Date.now() - startedAt,
      expandedNodes,
      backtrackCount,
    };
  }

  // Keep human insertion boundaries intact so the presentation layer can
  // regrip between cross-edge insertions while the cross center stays on R.
  const simplified = [...solvedNode.moves];
  const solution = simplified.join(" ");
  let verified = pattern;
  if (solution) verified = verified.applyAlg(solution);
  const verifiedState = compactStateFromPattern(verified);
  const verifiedSolvedMask = solvedEdgeTypeMask(verifiedState) & targetMask;
  const verifiedPairedMask = pairedEdgeTypeMask(verifiedState) & targetMask;
  if (
    bitCount(verifiedSolvedMask) !== 3 ||
    !maskContains(verifiedPairedMask, verifiedSolvedMask) ||
    !protectedCenterFacesSolved444(verifiedState, model, protectedCenterFaces)
  ) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS3_VERIFY_FAILED" };
  }

  return {
    ok: true,
    reason: null,
    solution,
    moveCount: simplified.length,
    lockedTypeMask: verifiedSolvedMask,
    pairedTargetMask: verifiedPairedMask,
    solvedTargetMask: verifiedSolvedMask,
    humanStepCount: solvedNode.steps.length,
    steps: solvedNode.steps,
    elapsedMs: Date.now() - startedAt,
    searchExpandedNodes: expandedNodes,
    searchBacktrackCount: backtrackCount,
    method: "Yau Human Cross 3/4",
  };
}
'''
text = text[:start] + new_func + text[end:]
p.write_text(text)

# 2) Give full Cross3 a little more local time, while keeping frame probes cheap.
p = Path("solver/solver444.js")
text = p.read_text()
text = text.replace(
    'timeBudgetMs: options?.__yauFastFrameProbe === true ? 950 : 2400,',
    'timeBudgetMs: options?.__yauFastFrameProbe === true ? 950 : 3000,',
)
# Ensure the worker's dynamic dependency is also a new URL.
text = text.replace('import("./edgePairing444.js")', f'import("./edgePairing444.js?v={TOKEN}")')
p.write_text(text)

# 3) Bust every browser cache boundary in the 4x4 module chain.
p = Path("solver/solverWorker.js")
text = p.read_text().replace('import("./solver444.js")', f'import("./solver444.js?v={TOKEN}")')
p.write_text(text)

p = Path("solver/solver444UiActivation.js")
text = p.read_text()
text = re.sub(r'const WORKER_BUILD_TOKEN = "[^"]+";', f'const WORKER_BUILD_TOKEN = "{TOKEN}";', text, count=1)
p.write_text(text)

p = Path("solver/nxnTwistyPreview.js")
text = p.read_text()
text = re.sub(r'solver444UiActivation\.js\?v=[^"\)]+', f'solver444UiActivation.js?v={TOKEN}', text, count=1)
p.write_text(text)

p = Path("main.js")
text = p.read_text().replace(
    'from "./solver/nxnTwistyPreview.js";',
    f'from "./solver/nxnTwistyPreview.js?v={TOKEN}";',
    1,
)
p.write_text(text)

p = Path("index.html")
text = p.read_text().replace(
    '<script type="module" src="main.js"></script>',
    f'<script type="module" src="main.js?v={TOKEN}"></script>',
    1,
)
p.write_text(text)

p = Path("tools/verify-444-ui-worker-bootstrap.mjs")
text = p.read_text()
text = re.sub(
    r'assert\.match\(preview, /solver444UiActivation\\\.js\\\?v=[^/]+/\);',
    f'assert.match(preview, /solver444UiActivation\\.js\\?v={TOKEN}/);',
    text,
    count=1,
)
p.write_text(text)

print("patched bounded Yau Cross3 recovery and browser cache chain")
