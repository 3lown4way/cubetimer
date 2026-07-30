import {
  ALL_MOVES,
  SB_MOVES,
  LSE_MOVES,
  buildAllPruneTables,
  applyMoveToCornerEnc,
  applyMoveToEdgeEnc,
  applyMoveToLSEEnc,
} from "./rouxPruneTables.js";

const PAIR_EDGE_FACTOR = 1 << 14;
const PAIR_STATE_SPACE = 576 * PAIR_EDGE_FACTOR;
const UNVISITED = 0xff;

let tablesPromise = null;

function buildExactPairDistanceTable(
  solvedCornerEnc,
  solvedEdgeEnc,
  transitions,
  moveCount,
  queue,
) {
  const distances = new Uint8Array(PAIR_STATE_SPACE);
  distances.fill(UNVISITED);

  const startKey = solvedCornerEnc * PAIR_EDGE_FACTOR + solvedEdgeEnc;
  let head = 0;
  let tail = 0;
  let maxDepth = 0;
  queue[tail++] = startKey;
  distances[startKey] = 0;

  const { cornerPerm, cornerTwist, edgePerm, edgeFlip } = transitions;
  while (head < tail) {
    const key = queue[head++];
    const depth = distances[key];
    if (depth > maxDepth) maxDepth = depth;
    const cornerEnc = Math.floor(key / PAIR_EDGE_FACTOR);
    const edgeEnc = key % PAIR_EDGE_FACTOR;

    for (let moveIndex = 0; moveIndex < moveCount; moveIndex++) {
      const nextCornerEnc = applyMoveToCornerEnc(
        cornerEnc,
        moveIndex,
        cornerPerm,
        cornerTwist,
      );
      const nextEdgeEnc = applyMoveToEdgeEnc(
        edgeEnc,
        moveIndex,
        edgePerm,
        edgeFlip,
      );
      const nextKey = nextCornerEnc * PAIR_EDGE_FACTOR + nextEdgeEnc;
      if (distances[nextKey] !== UNVISITED) continue;
      distances[nextKey] = depth + 1;
      queue[tail++] = nextKey;
    }
  }

  return {
    distances,
    stateCount: tail,
    maxDepth,
  };
}

function buildCompleteLseDistanceTable(solvedEnc, transitions) {
  const distances = new Map([[solvedEnc, 0]]);
  const queue = [solvedEnc];
  let head = 0;
  let maxDepth = 0;
  const { lsePerm, lseFlip, uDelta, mDelta } = transitions;

  while (head < queue.length) {
    const enc = queue[head++];
    const depth = distances.get(enc);
    if (depth > maxDepth) maxDepth = depth;
    for (let moveIndex = 0; moveIndex < LSE_MOVES.length; moveIndex++) {
      const nextEnc = applyMoveToLSEEnc(
        enc,
        moveIndex,
        lsePerm,
        lseFlip,
        uDelta,
        mDelta,
      );
      if (distances.has(nextEnc)) continue;
      distances.set(nextEnc, depth + 1);
      queue.push(nextEnc);
    }
  }

  return {
    distances,
    stateCount: distances.size,
    maxDepth,
  };
}

export async function ensureRouxExactTablesV2(getDefaultPatternFn) {
  if (tablesPromise) return tablesPromise;
  tablesPromise = (async () => {
    const startedAt = performance.now();
    const base = await buildAllPruneTables(getDefaultPatternFn);
    const queue = new Int32Array(PAIR_STATE_SPACE);

    const fb = buildExactPairDistanceTable(
      base.fbSolvedCornerEnc,
      base.fbSolvedEdgeEnc,
      base.allMovesTrans,
      ALL_MOVES.length,
      queue,
    );
    const sb = buildExactPairDistanceTable(
      base.sbSolvedCornerEnc,
      base.sbSolvedEdgeEnc,
      base.sbMovesTrans,
      SB_MOVES.length,
      queue,
    );
    const lse = buildCompleteLseDistanceTable(
      base.lseSolvedEnc,
      base.lseMovesTrans,
    );

    return Object.freeze({
      ...base,
      pairEdgeFactor: PAIR_EDGE_FACTOR,
      unvisited: UNVISITED,
      fbExactDistances: fb.distances,
      sbExactDistances: sb.distances,
      lseExactDistances: lse.distances,
      buildMetrics: Object.freeze({
        elapsedMs: performance.now() - startedAt,
        fbStateCount: fb.stateCount,
        fbMaxDepth: fb.maxDepth,
        sbStateCount: sb.stateCount,
        sbMaxDepth: sb.maxDepth,
        lseStateCount: lse.stateCount,
        lseMaxDepth: lse.maxDepth,
      }),
    });
  })().catch((error) => {
    tablesPromise = null;
    throw error;
  });
  return tablesPromise;
}
