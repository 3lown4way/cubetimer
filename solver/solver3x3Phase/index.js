import { buildPhase1Input, solvePhase1, solvePhase1Multi } from "./phase1.js";
import { buildPhase2Input, solvePhase2 } from "./phase2.js";
import { parsePatternToCoords3x3 } from "./state3x3.js";

function applyMoves(pattern, moves) {
  let current = pattern;
  for (let i = 0; i < moves.length; i++) {
    current = current.applyMove(moves[i]);
  }
  return current;
}

export async function solve3x3InternalPhase(pattern, options = {}) {
  const coords = parsePatternToCoords3x3(pattern);
  const phase1Input = buildPhase1Input(coords, options);

  const maxPhase2 = options.phase2MaxDepth ?? 18;
  const targetTotal = options.targetTotalDepth; // if set, limit phase2 to (target - p1.depth)
  const maxPhase1Solutions = Number.isFinite(options.maxPhase1Solutions)
    ? Math.max(1, Math.floor(options.maxPhase1Solutions))
    : 1;

  let phase1Solutions;
  let totalPhase1Nodes = 0;

  if (maxPhase1Solutions > 1) {
    const multi = await solvePhase1Multi(phase1Input, maxPhase1Solutions);
    totalPhase1Nodes = multi.nodes;
    if (!multi.solutions.length) {
      const reason = multi.timeLimitHit ? "PHASE1_TIMEOUT" : multi.nodeLimitHit ? "PHASE1_SEARCH_LIMIT" : "PHASE1_NOT_FOUND";
      return { ok: false, reason, phase1Nodes: totalPhase1Nodes };
    }
    phase1Solutions = multi.solutions;
  } else {
    const phase1 = await solvePhase1(phase1Input);
    totalPhase1Nodes = phase1.nodes || 0;
    if (!phase1.ok) {
      return { ok: false, reason: phase1.reason || "PHASE1_FAILED", phase1Nodes: totalPhase1Nodes };
    }
    phase1Solutions = [{ moves: phase1.moves }];
  }

  // Try each phase1 solution, picking the shortest combined result
  let best = null;
  let totalPhase2Nodes = 0;
  const currentBestTotal = () => best ? best.moveCount : Infinity;

  for (const p1 of phase1Solutions) {
    const p1Depth = p1.moves.length;
    // Limit phase2 based on: explicit target OR current best candidate
    const p2Limit = Math.min(
      maxPhase2,
      Number.isFinite(targetTotal) && targetTotal > 0 ? targetTotal - p1Depth : maxPhase2,
      Number.isFinite(currentBestTotal()) ? currentBestTotal() - 1 - p1Depth : maxPhase2,
    );
    if (p2Limit < 0) continue;

    const afterPhase1 = applyMoves(pattern, p1.moves);
    const phase2Input = buildPhase2Input(afterPhase1, { ...options, phase2MaxDepth: p2Limit });
    const phase2 = await solvePhase2(phase2Input);
    totalPhase2Nodes += phase2.nodes || 0;

    if (phase2.ok) {
      const fullMoves = p1.moves.concat(phase2.moves);
      if (!best || fullMoves.length < best.moveCount) {
        best = {
          ok: true,
          solution: fullMoves.join(" "),
          moveCount: fullMoves.length,
          nodes: totalPhase1Nodes + totalPhase2Nodes,
          bound: fullMoves.length,
          phase1Depth: p1Depth,
          phase2Depth: phase2.depth,
          source: "INTERNAL_3X3_PHASE",
        };
      }
    }
  }

  if (best) return { ...best, nodes: totalPhase1Nodes + totalPhase2Nodes };

  // If target-limited phase2 failed for all p1 solutions, retry without target limit
  if (Number.isFinite(targetTotal)) {
    for (const p1 of phase1Solutions) {
      const p1Depth = p1.moves.length;
      const p2Limit = Math.min(maxPhase2, Number.isFinite(currentBestTotal()) ? currentBestTotal() - 1 - p1Depth : maxPhase2);
      if (p2Limit < 0) continue;
      const afterPhase1 = applyMoves(pattern, p1.moves);
      const phase2Input = buildPhase2Input(afterPhase1, { ...options, phase2MaxDepth: p2Limit });
      const phase2 = await solvePhase2(phase2Input);
      totalPhase2Nodes += phase2.nodes || 0;
      if (phase2.ok) {
        const fullMoves = p1.moves.concat(phase2.moves);
        if (!best || fullMoves.length < best.moveCount) {
          best = {
            ok: true,
            solution: fullMoves.join(" "),
            moveCount: fullMoves.length,
            nodes: totalPhase1Nodes + totalPhase2Nodes,
            bound: fullMoves.length,
            phase1Depth: p1Depth,
            phase2Depth: phase2.depth,
            source: "INTERNAL_3X3_PHASE",
          };
        }
      }
    }
  }

  if (best) return { ...best, nodes: totalPhase1Nodes + totalPhase2Nodes };

  return {
    ok: false,
    reason: "PHASE2_FAILED",
    phase1Nodes: totalPhase1Nodes,
    phase2Nodes: totalPhase2Nodes,
  };
}

