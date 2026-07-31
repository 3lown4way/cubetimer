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
    if variant == 0 || solutions.len() <= limit {
        solutions.truncate(limit);
        return solutions;
    }

    const VARIANT_BUCKETS: usize = 4;
    let bucket = variant as usize % VARIANT_BUCKETS;
    let mut selected: Vec<Vec<u8>> = solutions
        .iter()
        .enumerate()
        .filter_map(|(index, moves)| (index % VARIANT_BUCKETS == bucket).then_some(moves.clone()))
        .take(limit)
        .collect();

    if selected.len() < limit {
        let rotation = (variant as usize * 17) % solutions.len();
        for offset in 0..solutions.len() {
            if selected.len() >= limit {
                break;
            }
            let moves = solutions[(rotation + offset) % solutions.len()].clone();
            if !selected.contains(&moves) {
                selected.push(moves);
            }
        }
    }
    selected
}
'''
if old not in text:
    raise SystemExit("MISSING:EO_VARIANT_POOL")
PATH.write_text(text.replace(old, new, 1))
print("Partitioned EO candidate pools across human search variants")
