from pathlib import Path

path = Path("tools/apply-fmc-real-deadline.py")
text = path.read_text()
anchor = '''# Do not launch insertion portfolios after the deadline or after the target is met.
fmc = replace_once(
'''
insert = r'''# A premove pipeline result is not a complete candidate until the premove is
# attached and simplified. Never let the inner length update the global
# incumbent/target state; otherwise an inner 20 + 2 premove is mistaken for a
# complete 20-move solve and stops Extreme early.
premove_start = fmc.index("    // --- Phase 3: Premove sweep ---")
premove_end = fmc.index("    let multi_switch_niss_candidate_count", premove_start)
premove_block = fmc[premove_start:premove_end]

direct_anchor = """                let pm_len = pm_set.len();

                let results = solve_fmc_single_axis(
"""
direct_new = """                let pm_len = pm_set.len();
                let mut premove_inner_best = best_count.saturating_add(pm_len);

                let results = solve_fmc_single_axis(
"""
if direct_anchor not in premove_block:
    raise SystemExit("direct premove incumbent anchor missing")
premove_block = premove_block.replace(direct_anchor, direct_new, 1)
if "                    &mut best_count,\n" not in premove_block:
    raise SystemExit("direct premove best_count argument missing")
premove_block = premove_block.replace(
    "                    &mut best_count,\n",
    "                    &mut premove_inner_best,\n",
    1,
)

inverse_anchor = """                let results = solve_fmc_single_axis(
                    &state,
                    tables,
                    fmc_tables,
                    max_eo_depth,
                    FMC_PM_EO_LIMIT,
"""
inverse_new = """                let mut premove_inner_best = best_count.saturating_add(pm_set.len());
                let results = solve_fmc_single_axis(
                    &state,
                    tables,
                    fmc_tables,
                    max_eo_depth,
                    FMC_PM_EO_LIMIT,
"""
if inverse_anchor not in premove_block:
    raise SystemExit("inverse premove incumbent anchor missing")
premove_block = premove_block.replace(inverse_anchor, inverse_new, 1)
if "                    &mut best_count,\n" not in premove_block:
    raise SystemExit("inverse premove best_count argument missing")
premove_block = premove_block.replace(
    "                    &mut best_count,\n",
    "                    &mut premove_inner_best,\n",
    1,
)
fmc = fmc[:premove_start] + premove_block + fmc[premove_end:]

# Do not launch insertion portfolios after the deadline or after the target is met.
fmc = replace_once(
'''
if anchor not in text:
    raise SystemExit("premove repair insertion anchor missing")
path.write_text(text.replace(anchor, insert, 1))
