import {
  ALL_MOVES,
  SB_MOVES,
  LSE_MOVES,
  encodeFBCornerState,
  encodeFBEdgeState,
  encodeSBCornerState,
  encodeSBEdgeState,
  encodeLSEState,
  applyMoveToCornerEnc,
  applyMoveToEdgeEnc,
  applyMoveToLSEEnc,
} from "./rouxPruneTables.js";

const PAIR_EDGE_FACTOR = 1 << 14;
const PAIR_STATE_SPACE = 576 * PAIR_EDGE_FACTOR;
const UNVISITED = 0xff;
const CACHE_SCHEMA_VERSION = 1;
const CACHE_REVISION = "roux-v2-exact-2026-07-30-b";
const EXPECTED_METRICS = Object.freeze({
  fbStateCount: 5322240,
  fbMaxDepth: 9,
  sbStateCount: 1088640,
  sbMaxDepth: 14,
  lseStateCount: 184320,
  lseMaxDepth: 20,
});
const LSE_POSITIONS = [0, 1, 2, 3, 4, 6];
const LSE_MOVE_IDXS_IN_SB = [0, 1, 2, 6, 7, 8];

let tablesPromise = null;
let cacheWritePromise = null;

function buildMoveTransitions(solved, moves) {
  const cornerPerm = [];
  const cornerTwist = [];
  const edgePerm = [];
  const edgeFlip = [];

  for (const move of moves) {
    const after = solved.applyAlg(move);
    const cPerm = new Int8Array(8);
    const cTwist = new Int8Array(8);
    const ePerm = new Int8Array(12);
    const eFlip = new Int8Array(12);

    for (let oldPosition = 0; oldPosition < 8; oldPosition++) {
      for (let newPosition = 0; newPosition < 8; newPosition++) {
        if (after.patternData.CORNERS.pieces[newPosition] !== oldPosition) continue;
        cPerm[oldPosition] = newPosition;
        cTwist[oldPosition] = after.patternData.CORNERS.orientation[newPosition];
        break;
      }
    }
    for (let oldPosition = 0; oldPosition < 12; oldPosition++) {
      for (let newPosition = 0; newPosition < 12; newPosition++) {
        if (after.patternData.EDGES.pieces[newPosition] !== oldPosition) continue;
        ePerm[oldPosition] = newPosition;
        eFlip[oldPosition] = after.patternData.EDGES.orientation[newPosition];
        break;
      }
    }

    cornerPerm.push(cPerm);
    cornerTwist.push(cTwist);
    edgePerm.push(ePerm);
    edgeFlip.push(eFlip);
  }

  return { cornerPerm, cornerTwist, edgePerm, edgeFlip };
}

function buildLseMoveTransitions(sbTransitions) {
  const positionIndex = new Int8Array(12);
  positionIndex.fill(-1);
  LSE_POSITIONS.forEach((position, index) => { positionIndex[position] = index; });

  const lsePerm = [];
  const lseFlip = [];
  const uDelta = [1, 3, 2, 0, 0, 0];
  const mDelta = [0, 0, 0, 1, 3, 2];

  for (let lseMoveIndex = 0; lseMoveIndex < LSE_MOVES.length; lseMoveIndex++) {
    const sbMoveIndex = LSE_MOVE_IDXS_IN_SB[lseMoveIndex];
    const perm = new Int8Array(6);
    const flip = new Int8Array(6);
    for (let positionIndexInLse = 0; positionIndexInLse < 6; positionIndexInLse++) {
      const absolutePosition = LSE_POSITIONS[positionIndexInLse];
      perm[positionIndexInLse] = positionIndex[
        sbTransitions.edgePerm[sbMoveIndex][absolutePosition]
      ];
      flip[positionIndexInLse] = sbTransitions.edgeFlip[sbMoveIndex][absolutePosition];
    }
    lsePerm.push(perm);
    lseFlip.push(flip);
  }

  return { lsePerm, lseFlip, uDelta, mDelta };
}

async function buildRouxV2BaseTables(getDefaultPatternFn) {
  const solved = await getDefaultPatternFn("333");
  const allMovesTrans = buildMoveTransitions(solved, ALL_MOVES);
  const sbMovesTrans = buildMoveTransitions(solved, SB_MOVES);
  const lseMovesTrans = buildLseMoveTransitions(sbMovesTrans);

  return {
    allMovesTrans,
    sbMovesTrans,
    lseMovesTrans,
    fbSolvedCornerEnc: encodeFBCornerState(solved.patternData),
    fbSolvedEdgeEnc: encodeFBEdgeState(solved.patternData),
    sbSolvedCornerEnc: encodeSBCornerState(solved.patternData),
    sbSolvedEdgeEnc: encodeSBEdgeState(solved.patternData),
    lseSolvedEnc: encodeLSEState(solved.patternData) << 4,
  };
}

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

  return { distances, stateCount: tail, maxDepth };
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

  return { distances, stateCount: distances.size, maxDepth };
}

function typedArray(value, Type) {
  if (value instanceof Type) return value;
  if (value instanceof ArrayBuffer) return new Type(value);
  if (ArrayBuffer.isView(value)) {
    return new Type(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  return null;
}

function metricsMatch(metrics) {
  return Object.entries(EXPECTED_METRICS)
    .every(([key, expected]) => metrics?.[key] === expected);
}

function hydrateCachedTables(record, base, cacheReadMetrics) {
  if (
    record?.schemaVersion !== CACHE_SCHEMA_VERSION
    || record?.revision !== CACHE_REVISION
    || record?.pairEdgeFactor !== PAIR_EDGE_FACTOR
    || record?.unvisited !== UNVISITED
    || !metricsMatch(record?.metrics)
  ) return null;

  const fbExactDistances = typedArray(record.fbExactDistances, Uint8Array);
  const sbExactDistances = typedArray(record.sbExactDistances, Uint8Array);
  const lseKeys = typedArray(record.lseKeys, Int32Array);
  const lseDepths = typedArray(record.lseDepths, Uint8Array);
  if (
    fbExactDistances?.length !== PAIR_STATE_SPACE
    || sbExactDistances?.length !== PAIR_STATE_SPACE
    || lseKeys?.length !== EXPECTED_METRICS.lseStateCount
    || lseDepths?.length !== EXPECTED_METRICS.lseStateCount
  ) return null;

  const lseExactDistances = new Map();
  for (let index = 0; index < lseKeys.length; index++) {
    lseExactDistances.set(lseKeys[index], lseDepths[index]);
  }

  return Object.freeze({
    ...base,
    pairEdgeFactor: PAIR_EDGE_FACTOR,
    unvisited: UNVISITED,
    fbExactDistances,
    sbExactDistances,
    lseExactDistances,
    buildMetrics: Object.freeze({
      ...record.metrics,
      elapsedMs: cacheReadMetrics.elapsedMs,
      cacheStatus: "hit",
      cacheReadMs: cacheReadMetrics.elapsedMs,
    }),
  });
}

function createCacheRecord(fb, sb, lse, metrics) {
  const lseKeys = new Int32Array(lse.distances.size);
  const lseDepths = new Uint8Array(lse.distances.size);
  let index = 0;
  for (const [key, depth] of lse.distances) {
    lseKeys[index] = key;
    lseDepths[index] = depth;
    index += 1;
  }

  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    revision: CACHE_REVISION,
    pairEdgeFactor: PAIR_EDGE_FACTOR,
    unvisited: UNVISITED,
    fbExactDistances: fb.distances,
    sbExactDistances: sb.distances,
    lseKeys,
    lseDepths,
    metrics,
    createdAt: Date.now(),
  };
}

async function readCache() {
  if (typeof globalThis.indexedDB === "undefined") {
    return { status: "unavailable", record: null, elapsedMs: 0 };
  }
  const cache = await import("./rouxExactTableCacheV2.js");
  return cache.readRouxExactTableCacheV2();
}

function scheduleCacheWrite(record) {
  if (typeof globalThis.indexedDB === "undefined") return null;
  if (!cacheWritePromise) {
    cacheWritePromise = import("./rouxExactTableCacheV2.js")
      .then((cache) => cache.writeRouxExactTableCacheV2(record))
      .catch(() => ({ status: "error" }))
      .finally(() => { cacheWritePromise = null; });
  }
  return cacheWritePromise;
}

export async function ensureRouxExactTablesV2(getDefaultPatternFn) {
  if (tablesPromise) return tablesPromise;
  tablesPromise = (async () => {
    const startedAt = performance.now();
    const [base, cacheRead] = await Promise.all([
      buildRouxV2BaseTables(getDefaultPatternFn),
      readCache(),
    ]);

    if (cacheRead.record) {
      const hydrated = hydrateCachedTables(cacheRead.record, base, cacheRead);
      if (hydrated) return hydrated;
    }

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

    const exactMetrics = Object.freeze({
      fbStateCount: fb.stateCount,
      fbMaxDepth: fb.maxDepth,
      sbStateCount: sb.stateCount,
      sbMaxDepth: sb.maxDepth,
      lseStateCount: lse.stateCount,
      lseMaxDepth: lse.maxDepth,
    });
    const buildMetrics = Object.freeze({
      ...exactMetrics,
      elapsedMs: performance.now() - startedAt,
      cacheStatus: cacheRead.status === "unavailable" ? "unavailable" : cacheRead.status,
      cacheReadMs: cacheRead.elapsedMs || 0,
      cacheWriteStatus: typeof globalThis.indexedDB === "undefined" ? "unavailable" : "scheduled",
    });

    scheduleCacheWrite(createCacheRecord(fb, sb, lse, exactMetrics));

    return Object.freeze({
      ...base,
      pairEdgeFactor: PAIR_EDGE_FACTOR,
      unvisited: UNVISITED,
      fbExactDistances: fb.distances,
      sbExactDistances: sb.distances,
      lseExactDistances: lse.distances,
      buildMetrics,
    });
  })().catch((error) => {
    tablesPromise = null;
    throw error;
  });
  return tablesPromise;
}
