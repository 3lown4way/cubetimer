#!/usr/bin/env python3
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"anchor not found: {label}")
    return text.replace(old, new, 1)


P1_TABLE = r'''// Fixed-capacity 2-way transposition table. Coordinates are stored separately,
// so collisions can only evict entries; they can never cause an invalid prune.
function createPhase1FailTable() {
  return {
    co: new Uint16Array(FAIL_TT_ENTRY_COUNT),
    eo: new Uint16Array(FAIL_TT_ENTRY_COUNT),
    sl: new Uint16Array(FAIL_TT_ENTRY_COUNT),
    face: new Uint8Array(FAIL_TT_ENTRY_COUNT),
    masks: new Uint32Array(FAIL_TT_ENTRY_COUNT),
    epochs: new Uint16Array(FAIL_TT_ENTRY_COUNT),
    replacement: new Uint8Array(FAIL_TT_SET_COUNT),
    epoch: 0,
  };
}

function beginPhase1FailTable(table) {
  let epoch = (table.epoch + 1) & 0xffff;
  if (epoch === 0) {
    table.epochs.fill(0);
    epoch = 1;
  }
  table.epoch = epoch;
}

function phase1FailSet(co, eo, sl, lastFace) {
  let hash = Math.imul(co + 1, 0x9e3779b1);
  hash ^= Math.imul(eo + 1, 0x85ebca6b);
  hash ^= Math.imul(sl + 1, 0xc2b2ae35);
  hash ^= Math.imul(lastFace + 1, 0x27d4eb2d);
  hash ^= hash >>> 16;
  return hash & FAIL_TT_SET_MASK;
}

function getPhase1FailMask(table, co, eo, sl, lastFace) {
  const base = phase1FailSet(co, eo, sl, lastFace) << 1;
  const epoch = table.epoch;
  if (
    table.epochs[base] === epoch &&
    table.co[base] === co && table.eo[base] === eo &&
    table.sl[base] === sl && table.face[base] === lastFace
  ) return table.masks[base];
  const second = base + 1;
  if (
    table.epochs[second] === epoch &&
    table.co[second] === co && table.eo[second] === eo &&
    table.sl[second] === sl && table.face[second] === lastFace
  ) return table.masks[second];
  return 0;
}

function storePhase1FailBit(table, co, eo, sl, lastFace, bit) {
  const set = phase1FailSet(co, eo, sl, lastFace);
  const base = set << 1;
  const second = base + 1;
  const epoch = table.epoch;
  let slot = -1;
  if (
    table.epochs[base] === epoch &&
    table.co[base] === co && table.eo[base] === eo &&
    table.sl[base] === sl && table.face[base] === lastFace
  ) slot = base;
  else if (
    table.epochs[second] === epoch &&
    table.co[second] === co && table.eo[second] === eo &&
    table.sl[second] === sl && table.face[second] === lastFace
  ) slot = second;
  else if (table.epochs[base] !== epoch) slot = base;
  else if (table.epochs[second] !== epoch) slot = second;
  else {
    slot = base + (table.replacement[set] & 1);
    table.replacement[set] ^= 1;
  }

  if (table.epochs[slot] === epoch &&
      table.co[slot] === co && table.eo[slot] === eo &&
      table.sl[slot] === sl && table.face[slot] === lastFace) {
    table.masks[slot] |= bit;
    return;
  }
  table.co[slot] = co;
  table.eo[slot] = eo;
  table.sl[slot] = sl;
  table.face[slot] = lastFace;
  table.masks[slot] = bit;
  table.epochs[slot] = epoch;
}
'''

P2_TABLE = r'''// Lazily allocated because the WASM path normally handles Phase 2. The exact
// coordinate tags make hash collisions safe: a collision only replaces an entry.
function createPhase2FailTable() {
  return {
    cp: new Uint16Array(FAIL_TT_ENTRY_COUNT),
    ep: new Uint16Array(FAIL_TT_ENTRY_COUNT),
    sep: new Uint8Array(FAIL_TT_ENTRY_COUNT),
    face: new Uint8Array(FAIL_TT_ENTRY_COUNT),
    masks: new Uint32Array(FAIL_TT_ENTRY_COUNT),
    epochs: new Uint16Array(FAIL_TT_ENTRY_COUNT),
    replacement: new Uint8Array(FAIL_TT_SET_COUNT),
    epoch: 0,
  };
}

function beginPhase2FailTable(table) {
  let epoch = (table.epoch + 1) & 0xffff;
  if (epoch === 0) {
    table.epochs.fill(0);
    epoch = 1;
  }
  table.epoch = epoch;
}

function phase2FailSet(cp, ep, sep, lastFace) {
  let hash = Math.imul(cp + 1, 0x9e3779b1);
  hash ^= Math.imul(ep + 1, 0x85ebca6b);
  hash ^= Math.imul(sep + 1, 0xc2b2ae35);
  hash ^= Math.imul(lastFace + 1, 0x27d4eb2d);
  hash ^= hash >>> 16;
  return hash & FAIL_TT_SET_MASK;
}

function getPhase2FailMask(table, cp, ep, sep, lastFace) {
  const base = phase2FailSet(cp, ep, sep, lastFace) << 1;
  const epoch = table.epoch;
  if (
    table.epochs[base] === epoch &&
    table.cp[base] === cp && table.ep[base] === ep &&
    table.sep[base] === sep && table.face[base] === lastFace
  ) return table.masks[base];
  const second = base + 1;
  if (
    table.epochs[second] === epoch &&
    table.cp[second] === cp && table.ep[second] === ep &&
    table.sep[second] === sep && table.face[second] === lastFace
  ) return table.masks[second];
  return 0;
}

function storePhase2FailBit(table, cp, ep, sep, lastFace, bit) {
  const set = phase2FailSet(cp, ep, sep, lastFace);
  const base = set << 1;
  const second = base + 1;
  const epoch = table.epoch;
  let slot = -1;
  if (
    table.epochs[base] === epoch &&
    table.cp[base] === cp && table.ep[base] === ep &&
    table.sep[base] === sep && table.face[base] === lastFace
  ) slot = base;
  else if (
    table.epochs[second] === epoch &&
    table.cp[second] === cp && table.ep[second] === ep &&
    table.sep[second] === sep && table.face[second] === lastFace
  ) slot = second;
  else if (table.epochs[base] !== epoch) slot = base;
  else if (table.epochs[second] !== epoch) slot = second;
  else {
    slot = base + (table.replacement[set] & 1);
    table.replacement[set] ^= 1;
  }

  if (table.epochs[slot] === epoch &&
      table.cp[slot] === cp && table.ep[slot] === ep &&
      table.sep[slot] === sep && table.face[slot] === lastFace) {
    table.masks[slot] |= bit;
    return;
  }
  table.cp[slot] = cp;
  table.ep[slot] = ep;
  table.sep[slot] = sep;
  table.face[slot] = lastFace;
  table.masks[slot] = bit;
  table.epochs[slot] = epoch;
}
'''

p1_path = Path("solver/solver3x3Phase/phase1.js")
p1 = p1_path.read_text(encoding="utf-8")
p1 = replace_once(
    p1,
    "const FAIL_CACHE_LIMIT = 220000;\n",
    "const FAIL_TT_SET_COUNT = 1 << 17;\nconst FAIL_TT_SET_MASK = FAIL_TT_SET_COUNT - 1;\nconst FAIL_TT_ENTRY_COUNT = FAIL_TT_SET_COUNT << 1;\n",
    "phase1 constants",
)
p1 = replace_once(
    p1,
    '''const phase1SearchScratch = {\n  path: [],\n  failCache: new Map(),\n};\n''',
    '''const phase1SearchScratch = {\n  path: [],\n  failTable: null,\n};\n\n''' + P1_TABLE,
    "phase1 scratch",
)
p1 = replace_once(
    p1,
    '''  // Fail cache persists across IDA* iterations: "from (state, lastFace) with N remaining moves, no solution exists"\n  // This is valid across bound increases because the state space doesn't change.\n  const failCache = phase1SearchScratch.failCache;\n  failCache.clear();\n''',
    '''  // The table persists across IDA* bounds. Epoch reset is O(1) per solve.\n  const failTable = phase1SearchScratch.failTable ||\n    (phase1SearchScratch.failTable = createPhase1FailTable());\n  beginPhase1FailTable(failTable);\n''',
    "phase1 table setup",
)
p1 = replace_once(
    p1,
    '''    const cacheKey = ((((co * EO_SIZE + eo) * SLICE_SIZE + sl) * 7) + lastFace);\n    const seenMask = failCache.get(cacheKey) || 0;\n    const bit = 1 << Math.min(remaining, 30);\n    if (seenMask & bit) return Infinity;\n''',
    '''    const bit = 1 << Math.min(remaining, 30);\n    if (getPhase1FailMask(failTable, co, eo, sl, lastFace) & bit) return Infinity;\n''',
    "phase1 lookup",
)
p1 = replace_once(
    p1,
    '''    if (failCache.size > FAIL_CACHE_LIMIT) failCache.clear();\n    failCache.set(cacheKey, seenMask | bit);\n''',
    '''    storePhase1FailBit(failTable, co, eo, sl, lastFace, bit);\n''',
    "phase1 store",
)
p1_path.write_text(p1, encoding="utf-8")

p2_path = Path("solver/solver3x3Phase/phase2.js")
p2 = p2_path.read_text(encoding="utf-8")
p2 = replace_once(
    p2,
    "const FAIL_CACHE_LIMIT = 260000;\n",
    "const FAIL_TT_SET_COUNT = 1 << 17;\nconst FAIL_TT_SET_MASK = FAIL_TT_SET_COUNT - 1;\nconst FAIL_TT_ENTRY_COUNT = FAIL_TT_SET_COUNT << 1;\n",
    "phase2 constants",
)
p2 = replace_once(
    p2,
    '''const phase2SearchScratch = {\n  path: [],\n  failCache: new Map(),\n  simplifyBuffer: [],\n};\n''',
    '''const phase2SearchScratch = {\n  path: [],\n  failTable: null,\n  simplifyBuffer: [],\n};\n\n''' + P2_TABLE,
    "phase2 scratch",
)
p2 = replace_once(
    p2,
    '''  // Fail cache persists across IDA* iterations: valid since remaining-budget bits are bound-independent.\n  const failCache = phase2SearchScratch.failCache;\n  failCache.clear();\n''',
    '''  // Lazily created only when the JS fallback is used; epoch reset is O(1).\n  const failTable = phase2SearchScratch.failTable ||\n    (phase2SearchScratch.failTable = createPhase2FailTable());\n  beginPhase2FailTable(failTable);\n''',
    "phase2 table setup",
)
p2 = replace_once(
    p2,
    '''    const cacheKey = ((((cp * EP_SIZE + ep) * SEP_SIZE + sep) * 7) + lastFace);\n    const seenMask = failCache.get(cacheKey) || 0;\n    const bit = 1 << Math.min(remaining, 30);\n    if (seenMask & bit) return Infinity;\n''',
    '''    const bit = 1 << Math.min(remaining, 30);\n    if (getPhase2FailMask(failTable, cp, ep, sep, lastFace) & bit) return Infinity;\n''',
    "phase2 lookup",
)
p2 = replace_once(
    p2,
    '''    if (failCache.size > FAIL_CACHE_LIMIT) failCache.clear();\n    failCache.set(cacheKey, seenMask | bit);\n''',
    '''    storePhase2FailBit(failTable, cp, ep, sep, lastFace, bit);\n''',
    "phase2 store",
)
p2_path.write_text(p2, encoding="utf-8")
print("Applied phase transposition tables")
