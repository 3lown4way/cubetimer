from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "solver-wasm/src/fmc_search.rs"
text = PATH.read_text()

old = '''        solutions: Vec::new(),
        limit,
        variant,
    };

    for d in min_depth..=max_depth {
        if ctx.solutions.len() >= limit {
            break;
        }
        ctx.path.clear();
        ctx.dfs(eo_idx, 0, d, LAST_FACE_FREE);
    }

    ctx.solutions
}
'''
new = '''        solutions: Vec::new(),
        // Collect a wider deterministic pool, then assign different residue
        // buckets to search variants. This makes additional Extreme time cover
        // new EO branches instead of replaying the same shortest prefix set.
        limit: limit.saturating_mul(4).max(limit),
        variant,
    };

    for d in min_depth..=max_depth {
        if ctx.solutions.len() >= ctx.limit {
            break;
        }
        ctx.path.clear();
        ctx.dfs(eo_idx, 0, d, LAST_FACE_FREE);
    }

    let mut solutions = ctx.solutions;
    solutions.sort_by_key(|moves| (moves.len(), moves.clone()));
    solutions.dedup();
    if variant == 0 {
        solutions.truncate(limit);
        return solutions;
    }

    // Non-zero variants deliberately evaluate a disjoint slice of the wider
    // EO pool. Do not refill from the complete pool: doing that made every
    // variant converge back to the same candidate set.
    const VARIANT_BUCKETS: usize = 4;
    let bucket = variant as usize % VARIANT_BUCKETS;
    let mut selected: Vec<Vec<u8>> = solutions
        .iter()
        .enumerate()
        .filter_map(|(index, moves)| (index % VARIANT_BUCKETS == bucket).then_some(moves.clone()))
        .take(limit)
        .collect();

    // Very small EO pools can leave a residue bucket empty. In that case retain
    // one rotated candidate so the variant stays productive without recreating
    // the entire baseline set.
    if selected.is_empty() && !solutions.is_empty() {
        let rotation = (variant as usize * 17) % solutions.len();
        selected.push(solutions[rotation].clone());
    }
    selected
}
'''
if old not in text:
    raise SystemExit("MISSING:EO_VARIANT_POOL")
PATH.write_text(text.replace(old, new, 1))
print("Partitioned EO candidate pools across human search variants")
