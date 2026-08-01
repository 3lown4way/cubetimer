#!/usr/bin/env bash
set -euo pipefail

node tools/.fmc-sub20-dev.mjs /tmp/sub20-dev-before.json
FMC_GENERALIZATION_FIXED_COUNT=6 FMC_GENERALIZATION_COMPRESSION_COUNT=2 \
  node tools/benchmark-fmc-generalization.mjs --out /tmp/sub20-general-before.json

python3 - <<'PY'
from pathlib import Path
path = Path('solver-wasm/src/fmc_search.rs')
text = path.read_text()

phase_anchor = '    // --- Phase 3: Premove sweep ---\n'
phase = r'''    // --- Phase 2d: complementary-frame normal EO→DR→P2 rescue ---
    // This is intentionally much narrower than a full six-frame replay: it is
    // only active in deep Extreme while the current completed best exceeds 20.
    let completed_best_before_complementary_normal = all_candidates
        .iter()
        .map(|candidate| candidate.moves.len())
        .min()
        .unwrap_or(usize::MAX);
    if enable_deep_multi_switch_niss
        && search_level >= 3
        && completed_best_before_complementary_normal > FMC_COMPLEMENTARY_MITM_TARGET_TOTAL
    {
        let complementary_scramble_maps: [[u8; 18]; 3] = std::array::from_fn(|axis| {
            build_move_conjugation(&COMPLEMENTARY_AXIS_SCRAMBLE_MAPS_JS[axis])
        });
        let complementary_solution_maps: [[u8; 18]; 3] = std::array::from_fn(|axis| {
            build_move_conjugation(&COMPLEMENTARY_AXIS_SOLUTION_MAPS_JS[axis])
        });

        for axis in 0..3usize {
            let conjugated_direct: Vec<u8> = scramble_moves
                .iter()
                .map(|&move_index| complementary_scramble_maps[axis][move_index as usize])
                .collect();
            let direct_state =
                CubeState::solved().apply_moves(&conjugated_direct, &tables.move_data);
            let mut rescue_limit = FMC_COMPLEMENTARY_MITM_TARGET_TOTAL + 1;
            let results = solve_fmc_single_axis(
                &direct_state,
                tables,
                fmc_tables,
                max_eo_depth,
                8,
                FMC_MAX_DR_DEPTH,
                FMC_MAX_P2_DEPTH,
                2_000_000,
                &mut p2_cache,
                &mut rescue_limit,
                0,
                force_rzp,
                false,
            );

            let convert = |moves: &[u8]| -> Vec<u8> {
                moves
                    .iter()
                    .map(|&move_index| complementary_solution_maps[axis][move_index as usize])
                    .collect()
            };
            for (moves, eo_moves, dr_moves, p2_moves, rzp_used, _, _) in results {
                let simplified = simplify_moves(&convert(&moves));
                if simplified.is_empty()
                    || simplified.len() > FMC_COMPLEMENTARY_MITM_TARGET_TOTAL
                    || !original_scramble_state
                        .apply_moves(&simplified, &tables.move_data)
                        .is_solved()
                {
                    continue;
                }
                all_candidates.push(FmcCandidate {
                    moves: simplified,
                    eo_len: eo_moves.len() as u8,
                    dr_len: dr_moves.len() as u8,
                    p2_len: p2_moves.len() as u8,
                    eo_moves: convert(&eo_moves),
                    dr_moves: convert(&dr_moves),
                    finish_moves: convert(&p2_moves),
                    axis: axis as u8,
                    source_tag: 13,
                    premove_moves: vec![],
                    rzp_used,
                    skeleton_moves: vec![],
                    insertion_moves: vec![],
                    insertion_position: None,
                    skeleton_kind: None,
                    insertion_steps: vec![],
                });
            }
        }
    }

'''
if phase_anchor not in text:
    raise SystemExit('phase anchor not found')
text = text.replace(phase_anchor, phase + phase_anchor, 1)

old_comment = '/// 0=direct, 1=niss, 2=premove_direct, 3=premove_niss; 8..=11 are stage-boundary NISS; 12 is complementary-frame short-P2 MITM rescue.'
new_comment = '/// 0=direct, 1=niss, 2=premove_direct, 3=premove_niss; 8..=11 are stage-boundary NISS; 12 is complementary-frame short-P2 MITM rescue; 13 is complementary-frame normal direct rescue.'
if old_comment not in text:
    raise SystemExit('source-tag comment anchor not found')
text = text.replace(old_comment, new_comment, 1)

source_anchor = '''        12 => format!(
            "FMC_COMPLEMENTARY_MITM_INVERSE_EO_BOUNDARY_{}",
            AXIS_NAMES[candidate.axis as usize]
        ),
'''
source_insert = source_anchor + '''        13 => format!(
            "FMC_COMPLEMENTARY_NORMAL_{}",
            AXIS_NAMES[candidate.axis as usize]
        ),
'''
if source_anchor not in text:
    raise SystemExit('candidate source anchor not found')
text = text.replace(source_anchor, source_insert, 1)

skeleton_anchor = '''        12 => format!(
            "FMC_COMPLEMENTARY_MITM_INVERSE_EO_BOUNDARY_{}",
            AXIS_NAMES[skeleton.axis as usize]
        ),
'''
skeleton_insert = skeleton_anchor + '''        13 => format!(
            "FMC_COMPLEMENTARY_NORMAL_{}",
            AXIS_NAMES[skeleton.axis as usize]
        ),
'''
if skeleton_anchor not in text:
    raise SystemExit('skeleton source anchor not found')
text = text.replace(skeleton_anchor, skeleton_insert, 1)

path.write_text(text)
PY

cargo test --release --manifest-path solver-wasm/Cargo.toml
cargo install wasm-pack --locked --version 0.13.1 >/dev/null 2>&1 || true
wasm-pack build solver-wasm --target web --out-dir ../public/solver-wasm
git diff --check

node tools/.fmc-sub20-dev.mjs /tmp/sub20-dev-after.json
FMC_GENERALIZATION_FIXED_COUNT=6 FMC_GENERALIZATION_COMPRESSION_COUNT=2 \
  node tools/benchmark-fmc-generalization.mjs \
    --baseline /tmp/sub20-general-before.json \
    --out /tmp/sub20-general-after.json

node --input-type=module <<'JS'
import fs from 'node:fs';
const before = JSON.parse(fs.readFileSync('/tmp/sub20-dev-before.json', 'utf8'));
const after = JSON.parse(fs.readFileSync('/tmp/sub20-dev-after.json', 'utf8'));
const general = JSON.parse(fs.readFileSync('/tmp/sub20-general-after.json', 'utf8'));
const row = (data, needle) => data.rows.find((entry) => entry.id.includes(needle));
const wongBefore = row(before, 'wong-chong-wen');
const wongAfter = row(after, 'wong-chong-wen');
const wrAfter = row(after, 'sebastiano-tronto');
if (!wongBefore || !wongAfter || !wrAfter) throw new Error('DEV_ROWS_MISSING');
if (wongAfter.found > 18 || wongAfter.found >= wongBefore.found) {
  throw new Error(`WONG18_NOT_REACHED:${wongBefore.found}->${wongAfter.found}`);
}
if (wrAfter.found > 16) throw new Error(`WR16_REGRESSED:${wrAfter.found}`);
if (!general.gate?.passed) {
  throw new Error(`GENERALIZATION_GATE_FAILED:${JSON.stringify(general.gate)}`);
}
console.log(`COMPLEMENTARY_NORMAL_ACCEPTED WONG=${wongBefore.found}->${wongAfter.found}`);
console.log(`SUB20_DEV_AFTER ${JSON.stringify(after)}`);
console.log(`SUB20_GENERAL_AFTER ${JSON.stringify(general.comparison)}`);
JS

git fetch origin main
git show origin/main:.github/workflows/cfop-speedup-benchmark.yml > .github/workflows/cfop-speedup-benchmark.yml
git rm -f solver-wasm/src/bin/sub20_path_diag.rs tools/.fmc-sub20-dev.mjs tools/.fmc-complementary-normal-experiment.sh
git add solver-wasm/src/fmc_search.rs public/solver-wasm .github/workflows/cfop-speedup-benchmark.yml
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git commit -m "Add complementary-frame normal direct rescue"
git push origin HEAD:agent/fmc-extreme-independent-frontier-v2
