from pathlib import Path

p = Path('solver/edgePairing444.js')
s = p.read_text()

s = s.replace(
'''// These four physical dedge slots form the protected bank used by the\n// Dw-based 3-2-3 planner. They are the same stable slots the verified\n// reduction engine locks first, but the human planner is free to place any\n// four paired edge types in them.\nconst EDGE_323_BANK_SLOTS = Object.freeze([0, 7, 10, 11]);\nconst EDGE_323_BANK_MASK = EDGE_323_BANK_SLOTS.reduce((mask, slot) => mask | (1 << slot), 0);\n''',
'''// Base protected bank used by the Dw-based 3-2-3 planner. Human solvers\n// naturally change viewpoint around the D/U axis, so the planner derives and\n// tries all four y-rotated equivalents instead of forcing this one physical bank.\nconst EDGE_323_BANK_SLOTS = Object.freeze([0, 7, 10, 11]);\nconst EDGE_323_BANK_MASK = EDGE_323_BANK_SLOTS.reduce((mask, slot) => mask | (1 << slot), 0);\n''')

s = s.replace('const SEED_BEAM_WIDTH = 1200;\nconst SLICE_BEAM_WIDTH = 1000;\nconst SEED_GOAL_LIMIT = 30;\nconst SEED_MAX_MACROS = 5;\nconst SLICE_MAX_OUTER_MOVES = 5;\n',
'''const SEED_BEAM_WIDTH = 1800;\nconst SLICE_BEAM_WIDTH = 1400;\nconst SEED_GOAL_LIMIT = 40;\nconst SEED_MAX_MACROS = 6;\nconst SLICE_MAX_OUTER_MOVES = 6;\n''')

marker = '''function maskContains(mask, required) {\n  return (mask & required) === required;\n}\n'''
helper = r'''

function transformSlotMask(mask, action) {
  const destinationBySource = new Uint8Array(24);
  for (let destination = 0; destination < 24; destination += 1) {
    destinationBySource[action.edgePermutation[destination]] = destination;
  }
  let transformed = 0;
  for (let slot = 0; slot < EDGE_SLOT_PAIRS_444.length; slot += 1) {
    if (!(mask & (1 << slot))) continue;
    const [first, second] = EDGE_SLOT_PAIRS_444[slot];
    const targetFirst = destinationBySource[first];
    const targetSecond = destinationBySource[second];
    const targetSlot = EDGE_SLOT_PAIRS_444.findIndex(([left, right]) =>
      (left === targetFirst && right === targetSecond) ||
      (left === targetSecond && right === targetFirst));
    if (targetSlot < 0) throw new Error(`444_323_SLOT_ROTATION_FAILED:${slot}`);
    transformed |= 1 << targetSlot;
  }
  return transformed;
}
'''
if 'function transformSlotMask(' not in s:
    if marker not in s:
        raise SystemExit('maskContains marker missing')
    s = s.replace(marker, marker + helper, 1)

old_return = '''  return {\n    kpuzzle,\n    solved,\n    solvedCompact,\n    actionFor,\n    seedActions,\n    outerActions,\n    l2eActions,\n  };\n'''
new_return = '''  const bankMasks = [...new Set(["", "y", "y2", "y'"]\n    .map((rotation) => rotation\n      ? transformSlotMask(EDGE_323_BANK_MASK, actionFor(rotation))\n      : EDGE_323_BANK_MASK))];\n  if (bankMasks.length !== 4) {\n    throw new Error(`444_323_BANK_ROTATION_COUNT:${bankMasks.length}`);\n  }\n\n  return {\n    kpuzzle,\n    solved,\n    solvedCompact,\n    actionFor,\n    seedActions,\n    outerActions,\n    l2eActions,\n    bankMasks,\n  };\n'''
if old_return not in s:
    raise SystemExit('planner model return block missing')
s = s.replace(old_return, new_return, 1)

s = s.replace('function collectSeedCandidates(initialState, model, deadlineTs) {\n  if (maskContains(pairedSlotMask(initialState), EDGE_323_BANK_MASK)) {',
'''function collectSeedCandidates(initialState, bankMask, model, deadlineTs) {\n  if (maskContains(pairedSlotMask(initialState), bankMask)) {''')
s = s.replace('const bankCount = bitCount(nextMask & EDGE_323_BANK_MASK);', 'const bankCount = bitCount(nextMask & bankMask);')
s = s.replace('if (maskContains(pairedSlotMask(node.state), EDGE_323_BANK_MASK)) goals.push(node);', 'if (maskContains(pairedSlotMask(node.state), bankMask)) goals.push(node);')

old_solve = '''  const seedCandidates = collectSeedCandidates(initialState, model, deadlineTs);\n  for (let seedIndex = 0; seedIndex < seedCandidates.length; seedIndex += 1) {\n    if (deadlineReached(deadlineTs)) break;\n    const seed = seedCandidates[seedIndex];\n    const seedMask = pairedSlotMask(seed.state);\n    const firstTarget = Math.max(7, bitCount(seedMask));\n    const firstThree = searchSliceCycle(seed.state, seedMask, firstTarget, model, deadlineTs);\n    if (!firstThree) continue;\n\n    const secondTarget = Math.max(9, bitCount(firstThree.mask));\n    const nextTwo = searchSliceCycle(firstThree.state, firstThree.mask, secondTarget, model, deadlineTs);\n    if (!nextTwo) continue;\n\n    let finalSetup = null;\n    let beforeL2E = nextTwo;\n    if (bitCount(nextTwo.mask) < 10) {\n      finalSetup = searchSliceCycle(nextTwo.state, nextTwo.mask, 10, model, deadlineTs);\n      if (!finalSetup) continue;\n      beforeL2E = finalSetup;\n    }\n\n    const l2e = findL2E(beforeL2E.state, model, deadlineTs);\n    if (!l2e) continue;\n\n    const seedMoves = seed.path.flatMap((actionIndex) => splitAlgorithm(model.seedActions[actionIndex].algorithm));\n    const seedCount = bitCount(seedMask);\n    const firstCount = bitCount(firstThree.mask);\n    const secondCount = bitCount(nextTwo.mask);\n    const finalSetupCount = finalSetup ? bitCount(finalSetup.mask) : secondCount;\n    const segments = [\n      buildSegment("edge323Bank", `Edge Bank ${seedCount}/12`, seedMoves, 1, seedCount),\n      buildSegment("edge323First3", "3-2-3 · First 3", firstThree.moves, seedCount + 1, firstCount),\n      buildSegment("edge323Next2", "3-2-3 · Next 2", nextTwo.moves, firstCount + 1, secondCount),\n    ];\n    if (finalSetup) {\n      segments.push(buildSegment(\n        "edge323Last3Setup",\n        "3-2-3 · Last 3 setup",\n        finalSetup.moves,\n        secondCount + 1,\n        finalSetupCount,\n      ));\n    }\n    segments.push(buildSegment(\n      "edge323L2E",\n      "3-2-3 · L2E",\n      l2e.moves,\n      finalSetupCount + 1,\n      12,\n    ));\n\n    const solution = segments.map((segment) => segment.solution).filter(Boolean).join(" ");\n    const verifiedPattern = solution ? pattern.applyAlg(solution) : pattern;\n    const verifiedState = compactStateFromPattern(verifiedPattern);\n    if (\n      bitCount(pairedSlotMask(verifiedState)) !== 12 ||\n      !centersSolved(verifiedState, model.solvedCompact.centerPieces)\n    ) {\n      continue;\n    }\n\n    return {\n      ok: true,\n      reason: null,\n      solution,\n      moveCount: splitAlgorithm(solution).length,\n      segments,\n      method: "3-2-3",\n      meta: {\n        seedCandidateIndex: seedIndex,\n        seedPairCount: seedCount,\n        afterFirstThree: firstCount,\n        afterNextTwo: secondCount,\n        beforeL2E: finalSetupCount,\n      },\n    };\n  }\n\n  return {\n    ok: false,\n    reason: deadlineReached(deadlineTs) ? "444_323_DEADLINE_REACHED" : "444_323_NO_PLAN",\n    solution: "",\n    moveCount: 0,\n    segments: [],\n    method: "3-2-3",\n  };\n'''
new_solve = r'''  const diagnostics = {
    bankCount: model.bankMasks.length,
    seedCandidates: 0,
    firstThreeFailures: 0,
    nextTwoFailures: 0,
    lastThreeFailures: 0,
    l2eFailures: 0,
    verificationFailures: 0,
  };

  for (let bankIndex = 0; bankIndex < model.bankMasks.length; bankIndex += 1) {
    if (deadlineReached(deadlineTs)) break;
    const bankMask = model.bankMasks[bankIndex];
    const seedCandidates = collectSeedCandidates(initialState, bankMask, model, deadlineTs);
    diagnostics.seedCandidates += seedCandidates.length;
    for (let seedIndex = 0; seedIndex < seedCandidates.length; seedIndex += 1) {
      if (deadlineReached(deadlineTs)) break;
      const seed = seedCandidates[seedIndex];
      const seedMask = pairedSlotMask(seed.state);
      const firstTarget = Math.max(7, bitCount(seedMask));
      const firstThree = searchSliceCycle(seed.state, seedMask, firstTarget, model, deadlineTs);
      if (!firstThree) {
        diagnostics.firstThreeFailures += 1;
        continue;
      }

      const secondTarget = Math.max(9, bitCount(firstThree.mask));
      const nextTwo = searchSliceCycle(firstThree.state, firstThree.mask, secondTarget, model, deadlineTs);
      if (!nextTwo) {
        diagnostics.nextTwoFailures += 1;
        continue;
      }

      let finalSetup = null;
      let beforeL2E = nextTwo;
      if (bitCount(nextTwo.mask) < 10) {
        finalSetup = searchSliceCycle(nextTwo.state, nextTwo.mask, 10, model, deadlineTs);
        if (!finalSetup) {
          diagnostics.lastThreeFailures += 1;
          continue;
        }
        beforeL2E = finalSetup;
      }

      const l2e = findL2E(beforeL2E.state, model, deadlineTs);
      if (!l2e) {
        diagnostics.l2eFailures += 1;
        continue;
      }

      const seedMoves = seed.path.flatMap((actionIndex) => splitAlgorithm(model.seedActions[actionIndex].algorithm));
      const seedCount = bitCount(seedMask);
      const firstCount = bitCount(firstThree.mask);
      const secondCount = bitCount(nextTwo.mask);
      const finalSetupCount = finalSetup ? bitCount(finalSetup.mask) : secondCount;
      const segments = [
        buildSegment("edge323Bank", `Edge Bank ${seedCount}/12`, seedMoves, 1, seedCount),
        buildSegment("edge323First3", "3-2-3 · First 3", firstThree.moves, seedCount + 1, firstCount),
        buildSegment("edge323Next2", "3-2-3 · Next 2", nextTwo.moves, firstCount + 1, secondCount),
      ];
      if (finalSetup) {
        segments.push(buildSegment(
          "edge323Last3Setup",
          "3-2-3 · Last 3 setup",
          finalSetup.moves,
          secondCount + 1,
          finalSetupCount,
        ));
      }
      segments.push(buildSegment(
        "edge323L2E",
        "3-2-3 · L2E",
        l2e.moves,
        finalSetupCount + 1,
        12,
      ));

      const solution = segments.map((segment) => segment.solution).filter(Boolean).join(" ");
      const verifiedPattern = solution ? pattern.applyAlg(solution) : pattern;
      const verifiedState = compactStateFromPattern(verifiedPattern);
      if (
        bitCount(pairedSlotMask(verifiedState)) !== 12 ||
        !centersSolved(verifiedState, model.solvedCompact.centerPieces)
      ) {
        diagnostics.verificationFailures += 1;
        continue;
      }

      return {
        ok: true,
        reason: null,
        solution,
        moveCount: splitAlgorithm(solution).length,
        segments,
        method: "3-2-3",
        meta: {
          bankIndex,
          bankMask,
          seedCandidateIndex: seedIndex,
          seedPairCount: seedCount,
          afterFirstThree: firstCount,
          afterNextTwo: secondCount,
          beforeL2E: finalSetupCount,
          diagnostics,
        },
      };
    }
  }

  const timedOut = deadlineReached(deadlineTs);
  return {
    ok: false,
    reason: timedOut ? "444_323_DEADLINE_REACHED" : "444_323_NO_PLAN",
    detail: JSON.stringify(diagnostics),
    solution: "",
    moveCount: 0,
    segments: [],
    method: "3-2-3",
    meta: diagnostics,
  };
'''
if old_solve not in s:
    raise SystemExit('solveEdgePairing323 main search block missing')
s = s.replace(old_solve, new_solve, 1)

p.write_text(s)
