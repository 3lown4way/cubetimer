#!/usr/bin/env python3
from pathlib import Path


def one(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected one anchor for {label}, found {count}")
    return text.replace(old, new, 1)


def first(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"missing anchor for {label}")
    return text.replace(old, new, 1)


path = Path("solver-wasm/src/twophase_search.rs")
text = path.read_text(encoding="utf-8")
text = one(
    text,
    "use std::collections::{HashMap, HashSet};\n",
    "use std::collections::{HashMap, HashSet};\nuse std::sync::Mutex;\n\nuse once_cell::sync::Lazy;\n",
    "imports",
)
text = one(
    text,
    "const PHASE1_FAIL_CACHE_LIMIT: usize = 220_000;\nconst PHASE2_FAIL_CACHE_LIMIT: usize = 260_000;\nconst PHASE1_EXACT_FAIL_CACHE_LIMIT: usize = 500_000;\n",
    "const PHASE1_EXACT_FAIL_CACHE_LIMIT: usize = 500_000;\nconst FAIL_TT_SET_COUNT: usize = 1 << 17;\nconst FAIL_TT_SET_MASK: usize = FAIL_TT_SET_COUNT - 1;\nconst FAIL_TT_WAYS: usize = 2;\nconst FAIL_TT_SLOTS: usize = FAIL_TT_SET_COUNT * FAIL_TT_WAYS;\n",
    "cache constants",
)

table_code = r'''const FACTORIAL_4: [usize; 5] = [1, 1, 2, 6, 24];

/// Exact-tagged two-way fail table. Hash collisions only evict entries and
/// therefore cannot create false pruning. Epochs make solve reset O(1).
struct FixedFailTable {
    keys: Box<[u64]>,
    masks: Box<[u32]>,
    epochs: Box<[u16]>,
    epoch: u16,
}

impl FixedFailTable {
    fn new() -> Self {
        Self {
            keys: vec![0; FAIL_TT_SLOTS].into_boxed_slice(),
            masks: vec![0; FAIL_TT_SLOTS].into_boxed_slice(),
            epochs: vec![0; FAIL_TT_SLOTS].into_boxed_slice(),
            epoch: 1,
        }
    }

    #[inline]
    fn reset(&mut self) {
        self.epoch = self.epoch.wrapping_add(1);
        if self.epoch == 0 {
            self.epochs.fill(0);
            self.epoch = 1;
        }
    }

    #[inline(always)]
    fn base_slot(key: u64) -> usize {
        let mut hash = (key as u32) ^ ((key >> 32) as u32);
        hash ^= hash >> 16;
        hash = hash.wrapping_mul(0x7feb_352d);
        hash ^= hash >> 15;
        hash = hash.wrapping_mul(0x846c_a68b);
        hash ^= hash >> 16;
        ((hash as usize) & FAIL_TT_SET_MASK) * FAIL_TT_WAYS
    }

    #[inline(always)]
    fn get(&self, key: u64) -> u32 {
        let base = Self::base_slot(key);
        for slot in base..base + FAIL_TT_WAYS {
            if self.epochs[slot] == self.epoch && self.keys[slot] == key {
                return self.masks[slot];
            }
        }
        0
    }

    #[inline(always)]
    fn insert_or(&mut self, key: u64, bit: u32) {
        let base = Self::base_slot(key);
        let mut free = None;
        for slot in base..base + FAIL_TT_WAYS {
            if self.epochs[slot] == self.epoch {
                if self.keys[slot] == key {
                    self.masks[slot] |= bit;
                    return;
                }
            } else if free.is_none() {
                free = Some(slot);
            }
        }
        let slot = free.unwrap_or_else(|| {
            if self.masks[base].count_ones() <= self.masks[base + 1].count_ones() {
                base
            } else {
                base + 1
            }
        });
        self.keys[slot] = key;
        self.masks[slot] = bit;
        self.epochs[slot] = self.epoch;
    }
}

static PHASE1_FAIL_TABLE: Lazy<Mutex<FixedFailTable>> =
    Lazy::new(|| Mutex::new(FixedFailTable::new()));
static PHASE2_FAIL_TABLE: Lazy<Mutex<FixedFailTable>> =
    Lazy::new(|| Mutex::new(FixedFailTable::new()));
'''
text = one(
    text,
    "const FACTORIAL_4: [usize; 5] = [1, 1, 2, 6, 24];\n",
    table_code,
    "fixed table insertion",
)

text = one(
    text,
    "struct Phase1SearchCtx<'a> {\n    tables: &'a TwophaseTables,\n",
    "struct Phase1SearchCtx<'a, 'b> {\n    tables: &'a TwophaseTables,\n",
    "phase1 lifetimes",
)
text = one(
    text,
    "    fail_cache: HashMap<u64, u32>,\n}\n\nimpl<'a> Phase1SearchCtx<'a> {\n",
    "    fail_cache: &'b mut FixedFailTable,\n}\n\nimpl<'a, 'b> Phase1SearchCtx<'a, 'b> {\n",
    "phase1 field",
)
lookup = "        let seen_mask = self.fail_cache.get(&cache_key).copied().unwrap_or(0);\n"
text = first(text, lookup, "        let seen_mask = self.fail_cache.get(cache_key);\n", "phase1 lookup")
text = one(
    text,
    "        if self.fail_cache.len() >= PHASE1_FAIL_CACHE_LIMIT {\n            self.fail_cache.clear();\n        }\n        self.fail_cache.insert(cache_key, seen_mask | bit);\n",
    "        self.fail_cache.insert_or(cache_key, bit);\n",
    "phase1 insert",
)
text = one(
    text,
    "    let mut ctx = Phase1SearchCtx {\n        tables,\n",
    "    let mut fail_cache = PHASE1_FAIL_TABLE.lock().unwrap();\n    fail_cache.reset();\n    let mut ctx = Phase1SearchCtx {\n        tables,\n",
    "phase1 acquire",
)
text = one(
    text,
    "        fail_cache: HashMap::new(),\n    };\n\n    while bound <= input.max_depth {\n",
    "        fail_cache: &mut fail_cache,\n    };\n\n    while bound <= input.max_depth {\n",
    "phase1 construct",
)

text = one(
    text,
    "struct Phase2SearchCtx<'a> {\n    tables: &'a TwophaseTables,\n",
    "struct Phase2SearchCtx<'a, 'b> {\n    tables: &'a TwophaseTables,\n",
    "phase2 lifetimes",
)
text = one(
    text,
    "    fail_cache: HashMap<u64, u32>,\n}\n\nimpl<'a> Phase2SearchCtx<'a> {\n",
    "    fail_cache: &'b mut FixedFailTable,\n}\n\nimpl<'a, 'b> Phase2SearchCtx<'a, 'b> {\n",
    "phase2 field",
)
text = one(text, lookup, "        let seen_mask = self.fail_cache.get(cache_key);\n", "phase2 lookup")
text = one(
    text,
    "        if self.fail_cache.len() >= PHASE2_FAIL_CACHE_LIMIT {\n            self.fail_cache.clear();\n        }\n        self.fail_cache.insert(cache_key, seen_mask | bit);\n",
    "        self.fail_cache.insert_or(cache_key, bit);\n",
    "phase2 insert",
)
text = one(
    text,
    "    let mut ctx = Phase2SearchCtx {\n        tables,\n",
    "    let mut fail_cache = PHASE2_FAIL_TABLE.lock().unwrap();\n    fail_cache.reset();\n    let mut ctx = Phase2SearchCtx {\n        tables,\n",
    "phase2 acquire",
)
text = one(
    text,
    "        fail_cache: HashMap::new(),\n    };\n\n    while bound <= max_depth {\n",
    "        fail_cache: &mut fail_cache,\n    };\n\n    while bound <= max_depth {\n",
    "phase2 construct",
)
path.write_text(text, encoding="utf-8")

cargo_path = Path("solver-wasm/Cargo.toml")
cargo = cargo_path.read_text(encoding="utf-8")
cargo = one(cargo, 'opt-level = "s"\n', "opt-level = 3\n", "release profile")
cargo_path.write_text(cargo, encoding="utf-8")
print("Applied Rust/WASM search hotpath candidate")
