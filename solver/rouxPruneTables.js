/**
 * Roux FB/SB/LSE Prune Tables
 *
 * Architecture:
 *   1. Build move transition tables (one-time: 30 pattern.applyAlg calls)
 *   2. BFS entirely in compact encoded state space — no pattern ops
 *   3. Heuristic = max(corner_table, edge_table)  (admissible lower bound)
 *
 * Encoding:
 *   Corner pair:   (pos1*3+or1)*24 + (pos2*3+or2)   → 576 slots, ~504 reachable
 *   Edge triplet:  (pos1*2+or1)*576 + (pos2*2+or2)*24 + (pos3*2+or3) → 13824 slots, ~10560 reachable
 *   LSE hex:       base-12 encoding of 6 (pieceIdx*2+orient) digits → 12^6=2985984 slots, ~23040 reachable
 *
 * Piece indices (cubing.js kpuzzle, 3x3):
 *   FB corners: DLF=5, DLB=6   SB corners: DRF=4, DRB=7
 *   FB edges:   DL=7, FL=9, BL=11   SB edges: DR=5, FR=8, BR=10
 *   LSE edges:  UF=0, UR=1, UB=2, UL=3, DF=4, DB=6
 */

export const ALL_MOVES = ["U","U'","U2","D","D'","D2","R","R'","R2","L","L'","L2","F","F'","F2","B","B'","B2"];
export const SB_MOVES  = ["U","U'","U2","R","R'","R2","M","M'","M2","r","r'","r2"];
export const LSE_MOVES = ["U","U'","U2","M","M'","M2"];
// Indices of LSE moves within SB_MOVES (U,U',U2 = 0,1,2; M,M',M2 = 6,7,8)
const LSE_MOVE_IDXS_IN_SB = [0, 1, 2, 6, 7, 8];

// LSE edge positions and piece-to-index maps
const LSE_POSITIONS = [0, 1, 2, 3, 4, 6]; // absolute edge positions
const LSE_POS_IDXMAP = new Array(12).fill(-1);
LSE_POSITIONS.forEach((p, i) => { LSE_POS_IDXMAP[p] = i; });
const LSE_PIECE_IDXMAP = new Array(12).fill(-1);
[0, 1, 2, 3, 4, 6].forEach((p, i) => { LSE_PIECE_IDXMAP[p] = i; });

// Shared scratch buffers for applyMoveToLSEEnc (safe: returned as integer before any recursion)
const _lseS = new Int32Array(6);
const _lseN = new Int32Array(6);

// ============================================================
// Encode functions  (exported for use in roux3x3.js IDA*)
// ============================================================

export function encodeFBCornerState(data) {
  let p5 = 0, o5 = 0, p6 = 0, o6 = 0;
  for (let p = 0; p < 8; p++) {
    const pc = data.CORNERS.pieces[p];
    if (pc === 5) { p5 = p; o5 = data.CORNERS.orientation[p]; }
    else if (pc === 6) { p6 = p; o6 = data.CORNERS.orientation[p]; }
  }
  return (p5 * 3 + o5) * 24 + (p6 * 3 + o6);
}

export function encodeFBEdgeState(data) {
  let p7 = 0, o7 = 0, p9 = 0, o9 = 0, p11 = 0, o11 = 0;
  for (let p = 0; p < 12; p++) {
    const pc = data.EDGES.pieces[p];
    if (pc === 7)  { p7  = p; o7  = data.EDGES.orientation[p]; }
    else if (pc === 9)  { p9  = p; o9  = data.EDGES.orientation[p]; }
    else if (pc === 11) { p11 = p; o11 = data.EDGES.orientation[p]; }
  }
  return (p7 * 2 + o7) * 576 + (p9 * 2 + o9) * 24 + (p11 * 2 + o11);
}

export function encodeSBCornerState(data) {
  let p4 = 0, o4 = 0, p7 = 0, o7 = 0;
  for (let p = 0; p < 8; p++) {
    const pc = data.CORNERS.pieces[p];
    if (pc === 4) { p4 = p; o4 = data.CORNERS.orientation[p]; }
    else if (pc === 7) { p7 = p; o7 = data.CORNERS.orientation[p]; }
  }
  return (p4 * 3 + o4) * 24 + (p7 * 3 + o7);
}

export function encodeSBEdgeState(data) {
  let p5 = 0, o5 = 0, p8 = 0, o8 = 0, p10 = 0, o10 = 0;
  for (let p = 0; p < 12; p++) {
    const pc = data.EDGES.pieces[p];
    if (pc === 5)  { p5  = p; o5  = data.EDGES.orientation[p]; }
    else if (pc === 8)  { p8  = p; o8  = data.EDGES.orientation[p]; }
    else if (pc === 10) { p10 = p; o10 = data.EDGES.orientation[p]; }
  }
  return (p5 * 2 + o5) * 576 + (p8 * 2 + o8) * 24 + (p10 * 2 + o10);
}

// LSE state: base-12 encoding of 6 (pieceIdx*2+orient) digits for LSE positions [0,1,2,3,4,6]
export function encodeLSEState(data) {
  let enc = 0;
  for (let posIdx = 0; posIdx < 6; posIdx++) {
    const pos = LSE_POSITIONS[posIdx];
    const piece = data.EDGES.pieces[pos];
    const pieceIdx = LSE_PIECE_IDXMAP[piece];
    const orient = data.EDGES.orientation[pos];
    enc = enc * 12 + pieceIdx * 2 + orient;
  }
  return enc;
}

// M-center cycle positions (U=0, F=2, D=4, B=5 participate in M cycle)
// Order: [0,2,5,4] means after one M, piece from pos 0 goes to pos 2, etc.
const M_CENTER_CYCLE = [0, 2, 5, 4];

// Returns the M-center rotation state (0..3) from pattern center data.
// Computed by finding where center piece 0 landed in the M-cycle.
// r/r' wide moves shift this because r includes an M or M' component.
export function getMCenterState(data) {
  const pos = data.CENTERS.pieces.indexOf(0);
  const idx = M_CENTER_CYCLE.indexOf(pos);
  return idx < 0 ? 0 : idx; // fallback to 0 if not found
}

// Apply LSE move to full LSE state: fullEnc = (edgeEnc<<4) | (mCenter<<2) | uRot
// uDelta[lmi]: net U rotation (mod 4) — affects top-layer corners
// mDelta[lmi]: net M center rotation (mod 4) — affects U/F/D/B center positions
export function applyMoveToLSEEnc(fullEnc, lmi, lsePerm, lseFlip, uDelta, mDelta) {
  const uRot    = fullEnc & 3;
  const mCenter = (fullEnc >> 2) & 3;
  let e = fullEnc >> 4; // edge encoding
  for (let i = 5; i >= 0; i--) { _lseS[i] = e % 12; e = (e / 12) | 0; }
  const p = lsePerm[lmi], f = lseFlip[lmi];
  _lseN[p[0]] = ((_lseS[0] >> 1) << 1) | ((_lseS[0] & 1) ^ f[0]);
  _lseN[p[1]] = ((_lseS[1] >> 1) << 1) | ((_lseS[1] & 1) ^ f[1]);
  _lseN[p[2]] = ((_lseS[2] >> 1) << 1) | ((_lseS[2] & 1) ^ f[2]);
  _lseN[p[3]] = ((_lseS[3] >> 1) << 1) | ((_lseS[3] & 1) ^ f[3]);
  _lseN[p[4]] = ((_lseS[4] >> 1) << 1) | ((_lseS[4] & 1) ^ f[4]);
  _lseN[p[5]] = ((_lseS[5] >> 1) << 1) | ((_lseS[5] & 1) ^ f[5]);
  const edgeEnc = _lseN[0]*248832 + _lseN[1]*20736 + _lseN[2]*1728 + _lseN[3]*144 + _lseN[4]*12 + _lseN[5];
  const newURot    = (uRot    + uDelta[lmi]) & 3;
  const newMCenter = (mCenter + mDelta[lmi]) & 3;
  return (edgeEnc << 4) | (newMCenter << 2) | newURot;
}

// ============================================================
// Move transition tables
// ============================================================

async function buildMoveTransitions(getDefaultPatternFn, moves) {
  const solved = await getDefaultPatternFn("333");
  const cornerPerm  = [];
  const cornerTwist = [];
  const edgePerm    = [];
  const edgeFlip    = [];

  for (const move of moves) {
    const after = solved.applyAlg(move);
    const cPerm = new Int8Array(8), cTwist = new Int8Array(8);
    const ePerm = new Int8Array(12), eFlip = new Int8Array(12);

    // In solved state pieces[pos] == pos, so piece oldPos is at position oldPos.
    // After the move, piece oldPos is at the position newPos where pieces[newPos] == oldPos.
    for (let oldPos = 0; oldPos < 8; oldPos++) {
      for (let newPos = 0; newPos < 8; newPos++) {
        if (after.patternData.CORNERS.pieces[newPos] === oldPos) {
          cPerm[oldPos]  = newPos;
          cTwist[oldPos] = after.patternData.CORNERS.orientation[newPos];
          break;
        }
      }
    }
    for (let oldPos = 0; oldPos < 12; oldPos++) {
      for (let newPos = 0; newPos < 12; newPos++) {
        if (after.patternData.EDGES.pieces[newPos] === oldPos) {
          ePerm[oldPos] = newPos;
          eFlip[oldPos] = after.patternData.EDGES.orientation[newPos];
          break;
        }
      }
    }
    cornerPerm.push(cPerm);  cornerTwist.push(cTwist);
    edgePerm.push(ePerm);    edgeFlip.push(eFlip);
  }
  return { cornerPerm, cornerTwist, edgePerm, edgeFlip };
}

// Apply one move (by index in the moves array) to a corner-pair encoding.
// Exported so roux3x3.js IDA* can use it without re-importing the transition tables.
export function applyMoveToCornerEnc(enc, mi, cPerm, cTwist) {
  const c1 = (enc / 24) | 0,  c2 = enc % 24;
  const pos1 = (c1 / 3) | 0, or1 = c1 % 3;
  const pos2 = (c2 / 3) | 0, or2 = c2 % 3;
  const np1 = cPerm[mi][pos1], no1 = (or1 + cTwist[mi][pos1]) % 3;
  const np2 = cPerm[mi][pos2], no2 = (or2 + cTwist[mi][pos2]) % 3;
  return (np1 * 3 + no1) * 24 + (np2 * 3 + no2);
}

// Apply one move (by index) to an edge-triplet encoding.
export function applyMoveToEdgeEnc(enc, mi, ePerm, eFlip) {
  const e1 = (enc / 576) | 0,  e2 = ((enc % 576) / 24) | 0,  e3 = enc % 24;
  const pos1 = (e1 / 2) | 0, or1 = e1 % 2;
  const pos2 = (e2 / 2) | 0, or2 = e2 % 2;
  const pos3 = (e3 / 2) | 0, or3 = e3 % 2;
  const np1 = ePerm[mi][pos1], no1 = (or1 + eFlip[mi][pos1]) % 2;
  const np2 = ePerm[mi][pos2], no2 = (or2 + eFlip[mi][pos2]) % 2;
  const np3 = ePerm[mi][pos3], no3 = (or3 + eFlip[mi][pos3]) % 2;
  return (np1 * 2 + no1) * 576 + (np2 * 2 + no2) * 24 + (np3 * 2 + no3);
}

// ============================================================
// BFS in compact state space
// ============================================================

function bfsCornerTable(solvedEnc, nMoves, cPerm, cTwist) {
  const table = new Map([[solvedEnc, 0]]);
  const queue = [solvedEnc];
  let head = 0;
  while (head < queue.length) {
    const enc = queue[head++];
    const d   = table.get(enc);
    if (d >= 9) continue;
    for (let mi = 0; mi < nMoves; mi++) {
      const nEnc = applyMoveToCornerEnc(enc, mi, cPerm, cTwist);
      if (!table.has(nEnc)) { table.set(nEnc, d + 1); queue.push(nEnc); }
    }
  }
  return table;
}

function bfsEdgeTable(solvedEnc, nMoves, ePerm, eFlip) {
  const table = new Map([[solvedEnc, 0]]);
  const queue = [solvedEnc];
  let head = 0;
  while (head < queue.length) {
    const enc = queue[head++];
    const d   = table.get(enc);
    if (d >= 9) continue;
    for (let mi = 0; mi < nMoves; mi++) {
      const nEnc = applyMoveToEdgeEnc(enc, mi, ePerm, eFlip);
      if (!table.has(nEnc)) { table.set(nEnc, d + 1); queue.push(nEnc); }
    }
  }
  return table;
}

// Build LSE-specific permutation/flip/uDelta/mDelta tables derived from sbTrans
function buildLSEMoveTables(sbTrans) {
  const lsePerm = [], lseFlip = [];
  // U rotation deltas: U=+1, U'=+3(=-1 mod4), U2=+2, M/M'/M2=0
  const uDelta = [1, 3, 2, 0, 0, 0];
  // M center rotation deltas: U/U'/U2=0, M=+1, M'=+3, M2=+2
  const mDelta = [0, 0, 0, 1, 3, 2];
  for (let lmi = 0; lmi < 6; lmi++) {
    const sbMi = LSE_MOVE_IDXS_IN_SB[lmi];
    const perm = new Int8Array(6), flip = new Int8Array(6);
    for (let posIdx = 0; posIdx < 6; posIdx++) {
      const absPos = LSE_POSITIONS[posIdx];
      perm[posIdx] = LSE_POS_IDXMAP[sbTrans.edgePerm[sbMi][absPos]];
      flip[posIdx] = sbTrans.edgeFlip[sbMi][absPos];
    }
    lsePerm.push(perm); lseFlip.push(flip);
  }
  return { lsePerm, lseFlip, uDelta, mDelta };
}

function bfsLSETable(solvedEdgeEnc, lseMovesTrans) {
  const { lsePerm, lseFlip, uDelta, mDelta } = lseMovesTrans;
  // Full encoding: (edgeEnc<<4) | (mCenter<<2) | uRot. Solved: mCenter=0, uRot=0.
  const solvedEnc = solvedEdgeEnc << 4;
  const table = new Map([[solvedEnc, 0]]);
  const queue = [solvedEnc];
  let head = 0;
  while (head < queue.length) {
    const enc = queue[head++];
    const d = table.get(enc);
    if (d >= 14) continue;
    for (let lmi = 0; lmi < 6; lmi++) {
      const nEnc = applyMoveToLSEEnc(enc, lmi, lsePerm, lseFlip, uDelta, mDelta);
      if (!table.has(nEnc)) { table.set(nEnc, d + 1); queue.push(nEnc); }
    }
  }
  return table;
}

// ============================================================
// Public API
// ============================================================

export async function buildAllPruneTables(getDefaultPatternFn) {
  const solved    = await getDefaultPatternFn("333");
  const allTrans  = await buildMoveTransitions(getDefaultPatternFn, ALL_MOVES);
  const sbTrans   = await buildMoveTransitions(getDefaultPatternFn, SB_MOVES);

  const fbCEnc = encodeFBCornerState(solved.patternData);
  const fbEEnc = encodeFBEdgeState(solved.patternData);
  const sbCEnc = encodeSBCornerState(solved.patternData);
  const sbEEnc = encodeSBEdgeState(solved.patternData);
  const lseEnc = encodeLSEState(solved.patternData);

  const fbCornerTable = bfsCornerTable(fbCEnc, ALL_MOVES.length, allTrans.cornerPerm, allTrans.cornerTwist);
  const fbEdgeTable   = bfsEdgeTable  (fbEEnc, ALL_MOVES.length, allTrans.edgePerm,   allTrans.edgeFlip);
  const sbCornerTable = bfsCornerTable(sbCEnc, SB_MOVES.length,  sbTrans.cornerPerm,  sbTrans.cornerTwist);
  const sbEdgeTable   = bfsEdgeTable  (sbEEnc, SB_MOVES.length,  sbTrans.edgePerm,    sbTrans.edgeFlip);

  const lseMovesTrans = buildLSEMoveTables(sbTrans);
  const lseTable      = bfsLSETable(lseEnc, lseMovesTrans);

  return {
    fbCornerTable, fbEdgeTable,
    sbCornerTable, sbEdgeTable,
    lseTable, lseSolvedEnc: lseEnc << 4, lseMovesTrans,
    fbSolvedCornerEnc: fbCEnc, fbSolvedEdgeEnc: fbEEnc,
    sbSolvedCornerEnc: sbCEnc, sbSolvedEdgeEnc: sbEEnc,
    allMovesTrans: allTrans,
    sbMovesTrans:  sbTrans,
  };
}

export function getFBPruneHeuristic(pattern, tables) {
  if (!tables || !pattern?.patternData) return 0;
  const d = pattern.patternData;
  return Math.max(
    tables.fbCornerTable.get(encodeFBCornerState(d)) ?? 0,
    tables.fbEdgeTable.get(encodeFBEdgeState(d))     ?? 0,
  );
}

export function getSBPruneHeuristic(pattern, tables) {
  if (!tables || !pattern?.patternData) return 0;
  const d = pattern.patternData;
  return Math.max(
    tables.sbCornerTable.get(encodeSBCornerState(d)) ?? 0,
    tables.sbEdgeTable.get(encodeSBEdgeState(d))     ?? 0,
  );
}

// Legacy aliases (kept for any external callers)
export async function buildFBPruneTable(getDefaultPatternFn) { return buildAllPruneTables(getDefaultPatternFn); }
export async function buildSBPruneTable() { return null; }

export const FB_CORNER_PIECES = [5, 6];
export const FB_EDGE_PIECES   = [7, 9, 11];
export const SB_CORNER_PIECES = [4, 7];
export const SB_EDGE_PIECES   = [5, 8, 10];
