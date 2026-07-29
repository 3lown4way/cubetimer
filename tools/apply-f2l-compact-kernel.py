#!/usr/bin/env python3
from __future__ import annotations

import pathlib
import re

PATH = pathlib.Path("solver/cfop3x3.js")
MARKER = "const F2L_COMPACT_KERNEL_VERSION = 2;"

text = PATH.read_text(encoding="utf-8")
if MARKER in text:
    print("F2L compact kernel already applied")
    raise SystemExit(0)

text = text.replace(
    "const F2L_CORNER_STATE_COUNT = 136080; // 8P4 * 3^4\n",
    "const F2L_CORNER_STATE_COUNT = 136080; // 8P4 * 3^4\n"
    f"{MARKER}\n",
    1,
)

helper_anchor = "\nfunction buildF2LPairPruneTable(pairDef, cornerMoveTables, edgeMoveTables, allowedMoveIndices) {"
helpers = r'''

function buildRestrictedF2LPairMoveTable(fullMoveTable, allowedMoveIndices, fullMoveCount) {
  const moveCount = allowedMoveIndices.length;
  const table = new Uint16Array(576 * moveCount);
  for (let state = 0; state < 576; state++) {
    const sourceBase = state * fullMoveCount;
    const targetBase = state * moveCount;
    for (let mi = 0; mi < moveCount; mi++) {
      table[targetBase + mi] = fullMoveTable[sourceBase + allowedMoveIndices[mi]];
    }
  }
  return table;
}

// For every compact pair state, rank the allowed moves by the exact one-pair
// pruning distance of the resulting state. The DFS still checks cross and
// locked pairs, but usually reaches a useful branch much earlier.
function buildF2LPairMoveOrderTable(restrictedMoveTable, pruneTable, moveCount) {
  const order = new Uint8Array(576 * moveCount);
  const localMoves = new Uint8Array(moveCount);
  const localScores = new Int8Array(moveCount);
  for (let state = 0; state < 576; state++) {
    const base = state * moveCount;
    for (let mi = 0; mi < moveCount; mi++) {
      const nextState = restrictedMoveTable[base + mi];
      const score = pruneTable[nextState];
      let pos = mi;
      while (pos > 0 && (
        score < localScores[pos - 1] ||
        (score === localScores[pos - 1] && mi < localMoves[pos - 1])
      )) {
        localScores[pos] = localScores[pos - 1];
        localMoves[pos] = localMoves[pos - 1];
        pos -= 1;
      }
      localScores[pos] = score;
      localMoves[pos] = mi;
    }
    order.set(localMoves, base);
  }
  return order;
}

function hashCompactF2LState(crossState, trackedMask, p0, p1, p2, p3, lastFace) {
  let h = Math.imul((crossState + 1) >>> 0, 0x9e3779b1) >>> 0;
  h ^= Math.imul((trackedMask + 1) >>> 0, 0x85ebca6b) >>> 0;
  h ^= Math.imul((p0 + 1) >>> 0, 0xc2b2ae35) >>> 0;
  h ^= Math.imul((p1 + 1) >>> 0, 0x27d4eb2f) >>> 0;
  h ^= Math.imul((p2 + 1) >>> 0, 0x165667b1) >>> 0;
  h ^= Math.imul((p3 + 1) >>> 0, 0xd3a2646c) >>> 0;
  h ^= Math.imul((lastFace + 2) >>> 0, 0xfd7046c5) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
'''
if helper_anchor not in text:
    raise RuntimeError("helper insertion anchor not found")
text = text.replace(helper_anchor, helpers + helper_anchor, 1)

old_pair_block = r'''    const f2lPairDefs = [];
    for (const { cornerPos: cornerTargetPos, edgePos: edgeTargetPos } of slotPairs) {
      f2lPairDefs.push({
        cornerTargetPos,
        edgeTargetPos,
        cornerPieceId: solvedData.CORNERS.pieces[cornerTargetPos],
        edgePieceId: solvedData.EDGES.pieces[edgeTargetPos],
        cornerTargetOri: solvedData.CORNERS.orientation[cornerTargetPos] % 3,
        edgeTargetOri: solvedData.EDGES.orientation[edgeTargetPos] & 1,
        pruneTable: buildF2LPairPruneTable(
          {
            cornerTargetPos,
            edgeTargetPos,
            cornerTargetOri: solvedData.CORNERS.orientation[cornerTargetPos] % 3,
            edgeTargetOri: solvedData.EDGES.orientation[edgeTargetPos] & 1,
          },
          cornerMoveTables,
          edgeMoveTables,
          noDMoveIndices,
        ),
        moveTable: buildF2LPairMoveTable(
          { cornerTargetPos, edgeTargetPos },
          cornerMoveTables,
          edgeMoveTables,
        ),
      });
    }
'''
new_pair_block = r'''    const f2lPairDefs = [];
    for (const { cornerPos: cornerTargetPos, edgePos: edgeTargetPos } of slotPairs) {
      const pairDef = {
        cornerTargetPos,
        edgeTargetPos,
        cornerPieceId: solvedData.CORNERS.pieces[cornerTargetPos],
        edgePieceId: solvedData.EDGES.pieces[edgeTargetPos],
        cornerTargetOri: solvedData.CORNERS.orientation[cornerTargetPos] % 3,
        edgeTargetOri: solvedData.EDGES.orientation[edgeTargetPos] & 1,
      };
      pairDef.pruneTable = buildF2LPairPruneTable(
        pairDef,
        cornerMoveTables,
        edgeMoveTables,
        noDMoveIndices,
      );
      const fullMoveTable = buildF2LPairMoveTable(
        pairDef,
        cornerMoveTables,
        edgeMoveTables,
      );
      pairDef.moveTable = buildRestrictedF2LPairMoveTable(
        fullMoveTable,
        noDMoveIndices,
        allMoveIndices.length,
      );
      pairDef.moveOrderTable = buildF2LPairMoveOrderTable(
        pairDef.moveTable,
        pairDef.pruneTable,
        noDMoveIndices.length,
      );
      f2lPairDefs.push(pairDef);
    }
'''
if old_pair_block not in text:
    raise RuntimeError("F2L pair-definition block not found")
text = text.replace(old_pair_block, new_pair_block, 1)

old_prefer = r'''  const preferCompactF2L =
    solverVersion === "v2" &&
    solveMode === "strict" &&
    !useSvWvStages &&
'''
new_prefer = r'''  const preferCompactF2L =
    solverVersion === "v2" &&
    (solveMode === "strict" || solveMode === "zb") &&
    !useSvWvStages &&
'''
if old_prefer not in text:
    raise RuntimeError("preferCompactF2L block not found")
text = text.replace(old_prefer, new_prefer, 1)

new_solver = r'''function solveF2LCompactIDA(startPattern, stage, ctx) {
  const startData = startPattern.patternData;
  if (stage.isSolved(startData, ctx)) {
    return { ok: true, moves: [], depth: 0, nodes: 0, bound: 0, transpositionHits: 0 };
  }

  const deadlineTs = Number.isFinite(stage.deadlineTs) && stage.deadlineTs > 0 ? stage.deadlineTs : 0;
  if (deadlineTs > 0 && Date.now() >= deadlineTs) return null;

  const f2lPairDefs = ctx.f2lPairDefs;
  const f2lSolvedPairStates = ctx.f2lSolvedPairStates;
  if (!f2lPairDefs || !f2lSolvedPairStates) return null;

  const moveIndices = ctx.noDMoveIndices;
  const numMoves = moveIndices.length;
  const f2lTargetPairs = Math.min(
    Number.isFinite(stage.f2lTargetPairs) ? stage.f2lTargetPairs : 4,
    f2lPairDefs.length,
  );
  const MAX_PAIR_DEPTH = 18;
  const NODE_LIMIT = deadlineTs > 0 ? 200000000 : 12000000;
  const NPAIRS = f2lTargetPairs;
  const STACK_SIZE = MAX_PAIR_DEPTH + 2;
  const TT_SIZE = 1 << 17;
  const TT_MASK = TT_SIZE - 1;

  // One reusable allocation per worker/context. This removes repeated typed-array
  // allocation and GC pressure when users solve many scrambles in a session.
  let scratch = ctx.f2lCompactScratch;
  if (!scratch || scratch.stackSize < STACK_SIZE || scratch.ttSize !== TT_SIZE) {
    scratch = {
      stackSize: STACK_SIZE,
      ttSize: TT_SIZE,
      crossStack: new Int32Array(STACK_SIZE),
      pairStack: new Uint16Array(4 * STACK_SIZE),
      movePath: new Uint8Array(STACK_SIZE),
      initPairStates: new Uint16Array(4),
      curPairStates: new Uint16Array(4),
      pairOrder: new Uint8Array(4),
      cornerPosById: new Uint8Array(8),
      edgePosById: new Uint8Array(12),
      ttCross: new Uint32Array(TT_SIZE),
      ttPairs: new Uint16Array(TT_SIZE * 4),
      ttTrackedMask: new Uint8Array(TT_SIZE),
      ttLastFace: new Uint8Array(TT_SIZE),
      ttRemaining: new Uint8Array(TT_SIZE),
      ttGeneration: new Uint16Array(TT_SIZE),
      generation: 0,
    };
    ctx.f2lCompactScratch = scratch;
  }

  const crossStack = scratch.crossStack;
  const pairStack = scratch.pairStack;
  const movePath = scratch.movePath;
  const initPairStates = scratch.initPairStates;
  const curPairStates = scratch.curPairStates;
  const pairOrder = scratch.pairOrder;
  const cornerPosById = scratch.cornerPosById;
  const edgePosById = scratch.edgePosById;

  const crossMoveTable = ctx.crossMoveTable;
  const crossPruneTable = ctx.crossPruneTable;
  const allNumMoves = ctx.allMoveIndices.length;
  const solvedCrossIdx = ctx.solvedCrossStateIndex;
  const pruneTables = f2lPairDefs.slice(0, NPAIRS).map((d) => d.pruneTable);
  const pairMoveTables = f2lPairDefs.slice(0, NPAIRS).map((d) => d.moveTable);
  const pairMoveOrderTables = f2lPairDefs.slice(0, NPAIRS).map((d) => d.moveOrderTable);

  let curCrossState = getCrossStateIndexFromData(startData, ctx);
  if (curCrossState < 0) return null;

  const startCorners = startData.CORNERS;
  const startEdges = startData.EDGES;
  for (let p = 0; p < 8; p++) cornerPosById[startCorners.pieces[p]] = p;
  for (let p = 0; p < 12; p++) edgePosById[startEdges.pieces[p]] = p;
  for (let j = 0; j < NPAIRS; j++) {
    const def = f2lPairDefs[j];
    const cpos = cornerPosById[def.cornerPieceId];
    const epos = edgePosById[def.edgePieceId];
    const state = encodeF2LPairState(
      cpos,
      startCorners.orientation[cpos] % 3,
      epos,
      startEdges.orientation[epos] & 1,
    );
    initPairStates[j] = state;
    curPairStates[j] = state;
    pairOrder[j] = j;
  }

  let totalNodes = 0;
  let transpositionHits = 0;
  let nodeLimitHit = false;
  let deadlineHit = false;
  let trackedMask = 0;
  const allMoves = [];
  const selectedPairOrder = [];

  // Re-evaluate the hardest remaining pair after every solved pair. The first
  // pair can substantially rearrange the other three, so a fixed initial order
  // creates avoidable high-bound searches.
  for (let ki = 0; ki < NPAIRS; ki++) {
    let bestPos = ki;
    let bestDistance = -1;
    for (let pos = ki; pos < NPAIRS; pos++) {
      const candidatePair = pairOrder[pos];
      const distance = pruneTables[candidatePair][curPairStates[candidatePair]];
      if (distance > bestDistance) {
        bestDistance = distance;
        bestPos = pos;
      }
    }
    if (bestPos !== ki) {
      const swap = pairOrder[ki];
      pairOrder[ki] = pairOrder[bestPos];
      pairOrder[bestPos] = swap;
    }

    const k = pairOrder[ki];
    selectedPairOrder.push(k);
    trackedMask |= 1 << k;
    const solvedPairStateK = f2lSolvedPairStates[k];
    const trackedPairCount = ki + 1;

    crossStack[0] = curCrossState;
    for (let ji = 0; ji < trackedPairCount; ji++) {
      const j = pairOrder[ji];
      pairStack[j * STACK_SIZE] = curPairStates[j];
    }

    let alreadySolved = crossStack[0] === solvedCrossIdx;
    if (alreadySolved) {
      for (let ji = 0; ji < trackedPairCount; ji++) {
        const j = pairOrder[ji];
        if (pairStack[j * STACK_SIZE] !== f2lSolvedPairStates[j]) {
          alreadySolved = false;
          break;
        }
      }
    }
    if (alreadySolved) continue;

    let solutionDepth = -1;
    let ttGeneration = scratch.generation;

    function startNextGeneration() {
      ttGeneration = (ttGeneration + 1) & 0xffff;
      if (ttGeneration === 0) {
        scratch.ttGeneration.fill(0);
        ttGeneration = 1;
      }
      scratch.generation = ttGeneration;
    }

    function dfs(level, bound, lastFace) {
      if ((totalNodes & 4095) === 0) {
        if (totalNodes >= NODE_LIMIT) {
          nodeLimitHit = true;
          return Infinity;
        }
        if (deadlineTs > 0 && Date.now() >= deadlineTs) {
          deadlineHit = true;
          return Infinity;
        }
      }

      let h = crossPruneTable[crossStack[level]];
      for (let ji = 0; ji < trackedPairCount; ji++) {
        const j = pairOrder[ji];
        const hj = pruneTables[j][pairStack[j * STACK_SIZE + level]];
        if (hj > h) h = hj;
      }
      const f = level + h;
      if (f > bound) return f;
      if (h === 0) {
        solutionDepth = level;
        return true;
      }

      const remaining = bound - level;
      const p0 = (trackedMask & 1) ? pairStack[level] : 0xffff;
      const p1 = (trackedMask & 2) ? pairStack[STACK_SIZE + level] : 0xffff;
      const p2 = (trackedMask & 4) ? pairStack[2 * STACK_SIZE + level] : 0xffff;
      const p3 = (trackedMask & 8) ? pairStack[3 * STACK_SIZE + level] : 0xffff;
      const encodedLastFace = lastFace + 1;
      const hash = hashCompactF2LState(
        crossStack[level],
        trackedMask,
        p0,
        p1,
        p2,
        p3,
        lastFace,
      );
      const slot = hash & TT_MASK;
      const pairBase = slot * 4;
      if (
        scratch.ttGeneration[slot] === ttGeneration &&
        scratch.ttCross[slot] === crossStack[level] &&
        scratch.ttTrackedMask[slot] === trackedMask &&
        scratch.ttLastFace[slot] === encodedLastFace &&
        scratch.ttPairs[pairBase] === p0 &&
        scratch.ttPairs[pairBase + 1] === p1 &&
        scratch.ttPairs[pairBase + 2] === p2 &&
        scratch.ttPairs[pairBase + 3] === p3 &&
        scratch.ttRemaining[slot] >= remaining
      ) {
        transpositionHits += 1;
        return Infinity;
      }
      scratch.ttGeneration[slot] = ttGeneration;
      scratch.ttCross[slot] = crossStack[level];
      scratch.ttTrackedMask[slot] = trackedMask;
      scratch.ttLastFace[slot] = encodedLastFace;
      scratch.ttPairs[pairBase] = p0;
      scratch.ttPairs[pairBase + 1] = p1;
      scratch.ttPairs[pairBase + 2] = p2;
      scratch.ttPairs[pairBase + 3] = p3;
      scratch.ttRemaining[slot] = remaining;

      const nextLevel = level + 1;
      let minNext = Infinity;
      const targetState = pairStack[k * STACK_SIZE + level];
      const orderBase = targetState * numMoves;
      const moveOrder = pairMoveOrderTables[k];
      for (let oi = 0; oi < numMoves; oi++) {
        const mi = moveOrder[orderBase + oi];
        const moveIndex = moveIndices[mi];
        const face = ctx.moveFace[moveIndex];
        if (lastFace !== -1) {
          if (face === lastFace) continue;
          if (face === OPPOSITE_FACE[lastFace] && face < lastFace) continue;
        }
        totalNodes += 1;
        crossStack[nextLevel] = crossMoveTable[crossStack[level] * allNumMoves + moveIndex];
        for (let ji = 0; ji < trackedPairCount; ji++) {
          const j = pairOrder[ji];
          const currentPairState = pairStack[j * STACK_SIZE + level];
          pairStack[j * STACK_SIZE + nextLevel] = pairMoveTables[j][currentPairState * numMoves + mi];
        }
        movePath[level] = moveIndex;
        const res = dfs(nextLevel, bound, face);
        if (res === true) return true;
        if (nodeLimitHit || deadlineHit) return Infinity;
        if (res < minNext) minNext = res;
      }
      return minNext;
    }

    let bound = crossPruneTable[curCrossState];
    for (let ji = 0; ji < trackedPairCount; ji++) {
      const j = pairOrder[ji];
      const hj = pruneTables[j][curPairStates[j]];
      if (hj > bound) bound = hj;
    }
    bound = Math.max(bound, 1);

    let pairSolved = false;
    while (bound <= MAX_PAIR_DEPTH && !nodeLimitHit && !deadlineHit) {
      startNextGeneration();
      const res = dfs(0, bound, -1);
      if (res === true) {
        pairSolved = true;
        break;
      }
      if (!Number.isFinite(res)) break;
      bound = res;
    }

    if (!pairSolved) {
      return {
        ok: false,
        reason: nodeLimitHit
          ? "F2L_COMPACT_NODE_LIMIT"
          : deadlineHit
            ? "F2L_COMPACT_DEADLINE"
            : "F2L_COMPACT_NOT_FOUND",
        nodes: totalNodes,
        bound,
        transpositionHits,
        pairOrder: selectedPairOrder.slice(),
      };
    }

    for (let d = 0; d < solutionDepth; d++) {
      const moveIndex = movePath[d];
      const localMoveIndex = moveIndices.indexOf(moveIndex);
      allMoves.push(MOVE_NAMES[moveIndex]);
      curCrossState = crossMoveTable[curCrossState * allNumMoves + moveIndex];
      for (let j = 0; j < NPAIRS; j++) {
        curPairStates[j] = pairMoveTables[j][curPairStates[j] * numMoves + localMoveIndex];
      }
    }
  }

  return {
    ok: true,
    moves: allMoves,
    depth: allMoves.length,
    nodes: totalNodes,
    bound: allMoves.length,
    transpositionHits,
    pairOrder: selectedPairOrder,
    kernelVersion: F2L_COMPACT_KERNEL_VERSION,
  };
}
'''
pattern = re.compile(
    r"function solveF2LCompactIDA\(startPattern, stage, ctx\) \{.*?\n\}\n\nfunction solveWithFormulaDbF2L",
    re.S,
)
match = pattern.search(text)
if not match:
    raise RuntimeError("solveF2LCompactIDA function not found")
text = text[: match.start()] + new_solver + "\n\nfunction solveWithFormulaDbF2L" + text[match.end() :]

# Surface kernel diagnostics in existing performance telemetry.
text = text.replace(
    "    compactPathUsed: f2lDiagnostics.compactPathUsed === true,\n",
    "    compactPathUsed: f2lDiagnostics.compactPathUsed === true,\n"
    "    compactTranspositionHits: Number.isFinite(f2lDiagnostics.compactTranspositionHits)\n"
    "      ? f2lDiagnostics.compactTranspositionHits\n"
    "      : 0,\n"
    "    compactPairOrder: Array.isArray(f2lDiagnostics.compactPairOrder)\n"
    "      ? f2lDiagnostics.compactPairOrder.slice()\n"
    "      : [],\n",
    1,
)

# Record compact diagnostics in both compact-first and fallback branches.
needle = """        if (Number.isFinite(compactResult?.bound)) {
          stage.performanceCollector.finalBound = compactResult.bound;
        }
"""
replacement = needle + """        if (Number.isFinite(compactResult?.transpositionHits)) {
          stage.performanceCollector.compactTranspositionHits = compactResult.transpositionHits;
        }
        if (Array.isArray(compactResult?.pairOrder)) {
          stage.performanceCollector.compactPairOrder = compactResult.pairOrder.slice();
        }
"""
if text.count(needle) < 2:
    raise RuntimeError("compact diagnostics anchors not found")
text = text.replace(needle, replacement, 2)

PATH.write_text(text, encoding="utf-8")
print("Applied F2L compact kernel v2")
