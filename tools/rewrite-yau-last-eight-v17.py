from pathlib import Path
import runpy

# Start from the positional ML/LL model, not the depth-probe variant.
runpy.run_path('tools/rewrite-yau-last-eight-v14.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()

anchor = '''function collectYauNextTwoCandidates444(
'''
helper = r'''const YAU_FIRST3_F2L_MACROS_444 = Object.freeze((() => {
  const algorithms = ["U", "U'", "U2"];
  const addFaceTriggers = (face, inverseFace) => {
    for (const u of ["U", "U'", "U2"]) {
      algorithms.push(`${face} ${u} ${inverseFace}`);
      algorithms.push(`${inverseFace} ${u} ${face}`);
    }
  };
  addFaceTriggers("R", "R'");
  addFaceTriggers("L", "L'");
  addFaceTriggers("F", "F'");
  addFaceTriggers("B", "B'");
  return [...new Set(algorithms)];
})());

function searchYauFirstThreeHuman444(initialState, sliceFamily, model, deadlineTs, crossMask) {
  const middleMask = sliceFamily.middleMask;
  if (bitCount(pairedSlotMask(initialState) & middleMask) >= 3) {
    return [{ state: initialState, mask: pairedEdgeTypeMask(initialState), moves: [] }];
  }

  const macroPool = YAU_FIRST3_F2L_MACROS_444.map((algorithm) => ({
    algorithm,
    moves: splitAlgorithm(algorithm),
    action: model.actionFor(algorithm),
  }));
  const goals = new Map();

  for (const openMove of sliceFamily.openMoves) {
    if (deadlineReached(deadlineTs)) break;
    const closeMove = invertMoveToken(openMove);
    const opened = applyCompactAction(initialState, model.actionFor(openMove), true);
    if (!maskContains(pairedEdgeTypeMask(opened), crossMask)) continue;

    let beam = [{ state: opened, moves: [], lastMacro: "", score: 0 }];
    for (let macroDepth = 0; macroDepth <= 5; macroDepth += 1) {
      if (deadlineReached(deadlineTs)) break;
      const seen = new Map();
      for (const node of beam) {
        const closed = applyCompactAction(node.state, model.actionFor(closeMove), true);
        const mlPaired = bitCount(pairedSlotMask(closed) & middleMask);
        if (
          mlPaired >= 3 &&
          maskContains(pairedEdgeTypeMask(closed), crossMask) &&
          maskContains(solvedEdgeTypeMask(closed), crossMask) &&
          centersSolved(closed, model.solvedCompact.centerPieces)
        ) {
          const moves = [openMove, ...node.moves, closeMove];
          const key = compactStateKey(closed, true);
          const previous = goals.get(key);
          if (!previous || moves.length < previous.moves.length) {
            goals.set(key, { state: closed, mask: pairedEdgeTypeMask(closed), moves });
          }
        }
        if (macroDepth === 5) continue;

        for (const macro of macroPool) {
          // Do not spam the same U-only adjustment twice in a row.
          if (/^U/.test(node.lastMacro) && /^U/.test(macro.algorithm)) continue;
          const nextState = applyCompactAction(node.state, macro.action, true);
          if (!maskContains(pairedEdgeTypeMask(nextState), crossMask)) continue;
          const closedCandidate = applyCompactAction(nextState, model.actionFor(closeMove), true);
          const slotMask = pairedSlotMask(closedCandidate);
          const mlScore = bitCount(slotMask & middleMask);
          const remainingScore = bitCount(pairedEdgeTypeMask(closedCandidate) & (0x0fff ^ crossMask));
          const score = mlScore * 20000 + remainingScore * 700 - (node.moves.length + macro.moves.length);
          const key = compactStateKey(nextState, false);
          const previous = seen.get(key);
          if (!previous || previous.score < score) {
            seen.set(key, {
              state: nextState,
              moves: [...node.moves, ...macro.moves],
              lastMacro: macro.algorithm,
              score,
            });
          }
        }
      }
      if (goals.size) break;
      beam = [...seen.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, 5000);
    }
  }

  return [...goals.values()]
    .sort((a, b) => a.moves.length - b.moves.length)
    .slice(0, 6);
}

'''
if anchor not in s:
    raise SystemExit('Next2 helper anchor missing')
s = s.replace(anchor, helper + anchor, 1)

old = '''  const initialMiddlePaired = bitCount(pairedSlotMask(state) & sliceFamily.middleMask);
  let first3Candidates = initialMiddlePaired >= 3
    ? [{ state, mask: pairedEdgeTypeMask(state), moves: [] }]
    : collectYauCycleGoals444(
        state,
        0,
        sliceFamily,
        model,
        edgeStageDeadline,
        crossMask,
        crossMask,
        7,
        6,
        0,
        sliceFamily.middleMask,
        3,
      );
'''
new = '''  const initialMiddlePaired = bitCount(pairedSlotMask(state) & sliceFamily.middleMask);
  let first3Candidates = searchYauFirstThreeHuman444(
    state,
    sliceFamily,
    model,
    edgeStageDeadline,
    crossMask,
  );
'''
if old not in s:
    raise SystemExit('v14 First3 collector block missing')
s = s.replace(old, new, 1)

# The generic second-tier depth probe no longer applies: First3 now searches
# insertion triggers directly. Remove it rather than falling back to atomic beam.
start = s.find('''  // If every shortest First-3 arrangement creates a bad continuation, look
''')
if start >= 0:
    end = s.find('''
  if (!chosenPipeline) {
''', start)
    if end < 0:
        raise SystemExit('second-tier block end missing')
    s = s[:start] + s[end:]

# Diagnostic wording for the new engine.
s = s.replace('''    firstTier: chosenPipeline.tier,
''', '''    firstTier: chosenPipeline.tier || "f2l-triggers",
''', 1)
p.write_text(s)
print('replaced atomic First3 beam with F2L-trigger Yau insertion engine')
