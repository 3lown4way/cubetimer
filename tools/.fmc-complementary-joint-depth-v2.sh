#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
path = Path('tools/.fmc-complementary-joint-depth-experiment.sh')
text = path.read_text()
old = '''    let mut nodes = 0u64;
    let mut p2_calls = 0usize;
    for total_bound in initial_bound..=max_total_depth {
        let mut path = Vec::with_capacity(FMC_COMPLEMENTARY_NISS_MAX_DR_DEPTH);
        let mut seen = std::collections::HashMap::new();
        if let Some(result) = search_joint_dr_p2_bound(
            *state,
            tables,
            fmc_tables,
            p2_cache,
            &mut path,
            LAST_FACE_FREE,
            total_bound,
            FMC_COMPLEMENTARY_NISS_MAX_DR_DEPTH.min(total_bound),
            &mut nodes,
            &mut p2_calls,
            &mut seen,
        ) {
            return Some(result);
        }
        if nodes >= FMC_COMPLEMENTARY_NISS_NODE_LIMIT {
            break;
        }
    }
    None
'''
new = '''    let total_bound = max_total_depth.max(initial_bound);
    let mut nodes = 0u64;
    let mut p2_calls = 0usize;
    let mut path = Vec::with_capacity(FMC_COMPLEMENTARY_NISS_MAX_DR_DEPTH);
    let mut seen = std::collections::HashMap::new();
    search_joint_dr_p2_bound(
        *state,
        tables,
        fmc_tables,
        p2_cache,
        &mut path,
        LAST_FACE_FREE,
        total_bound,
        FMC_COMPLEMENTARY_NISS_MAX_DR_DEPTH.min(total_bound),
        &mut nodes,
        &mut p2_calls,
        &mut seen,
    )
'''
if old not in text:
    raise SystemExit('joint rescue loop anchor not found')
path.write_text(text.replace(old, new, 1))
PY
exec bash tools/.fmc-complementary-joint-depth-experiment.sh
