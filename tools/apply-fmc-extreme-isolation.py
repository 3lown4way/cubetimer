from pathlib import Path
import re


def replace_exact(text, old, new, label, expected=1):
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{label}: expected {expected} match(es), found {count}")
    return text.replace(old, new, expected)


js_path = Path("solver/fmcSolver.js")
js = js_path.read_text()

js = replace_exact(
    js,
    "const searchLevel = variant === 0 ? 0 : variant < 3 ? 1 : variant < 7 ? 2 : 3;",
    "// Extreme starts above the baseline-equivalent L0 profile.\n"
    "      const searchLevel = variant < 2 ? 1 : variant < 7 ? 2 : 3;",
    "extreme search level",
)
js = replace_exact(
    js,
    "searchLevel === 0 ? 40 : searchLevel === 1 ? 90 : searchLevel === 2 ? 140 : requestedPremoveSets;",
    "searchLevel === 1 ? 90 : searchLevel === 2 ? 140 : requestedPremoveSets;",
    "extreme premove cap",
)
js = replace_exact(
    js,
    "          searchVariant: variant,\n          enableMultiSwitchNiss: searchLevel >= 1,",
    "          searchVariant: variant,\n"
    "          rawExplorationLimit: searchLevel === 1 ? 28 : searchLevel === 2 ? 31 : 34,\n"
    "          enableMultiSwitchNiss: true,",
    "extreme raw limit stage option",
)

stage_pattern = re.compile(
    r"(?m)^\s{8}const stageOptions = \{\n"
    r"\s{10}\.\.\.qualityStage\.options,\n"
    r"\s{10}incumbentMoveCount: Number\.isFinite\(bestMoveCount\)\n"
    r"\s{12}\? Math\.max\(1, bestMoveCount - \(bestMoveCount <= targetMoveCount \? 1 : 0\)\)\n"
    r"\s{12}: 40,\n"
    r"\s{8}\};"
)
stage_replacement = '''        const rawExplorationLimit =
            qualityMode === "extreme"
              ? Number.isFinite(qualityStage.options.rawExplorationLimit)
                ? Math.max(24, Math.min(40, Math.floor(qualityStage.options.rawExplorationLimit)))
                : 32
              : Number.isFinite(bestMoveCount)
                ? Math.max(1, bestMoveCount - (bestMoveCount <= targetMoveCount ? 1 : 0))
                : 40;
        const { rawExplorationLimit: _rawExplorationLimit, ...wasmQualityOptions } = qualityStage.options;
        const stageOptions = {
          ...wasmQualityOptions,
          // Kept under the legacy WASM option name for compatibility. In Extreme
          // this is a fixed raw-path ceiling, not the completed-solution incumbent.
          incumbentMoveCount: rawExplorationLimit,
        };'''
js, count = stage_pattern.subn(stage_replacement, js, count=1)
if count != 1:
    raise SystemExit(f"independent raw limit: expected 1 match, found {count}")

js = replace_exact(
    js,
    "    sweepBudgetMs,\n    searchProfiles: {",
    "    sweepBudgetMs,\n"
    "    extremeIsolation:\n"
    "      qualityMode === \"extreme\"\n"
    "        ? {\n"
    "            baselineCandidateImported: false,\n"
    "            baselineCacheReused: false,\n"
    "            rawLimitIndependentFromFinalBest: true,\n"
    "          }\n"
    "        : null,\n"
    "    searchProfiles: {",
    "extreme diagnostics root",
)
js = replace_exact(
    js,
    "          multiInsertion: stageOptions.enableMultiInsertion === true,\n        });",
    "          multiInsertion: stageOptions.enableMultiInsertion === true,\n"
    "          rawExplorationLimit: stageOptions.incumbentMoveCount,\n"
    "          finalBestImportedAsRawLimit: qualityMode !== \"extreme\",\n"
    "        });",
    "stage diagnostics",
)
js_path.write_text(js)

rust_path = Path("solver-wasm/src/fmc_search.rs")
rust = rust_path.read_text()

direct_pattern = re.compile(
    r"(?m)^\s*if simplified\.len\(\) < \*current_best \{\n"
    r"\s*\*current_best = simplified\.len\(\);\n"
    r"\s*\}\n"
)
rust, count = direct_pattern.subn(
    "            // `current_best` is a raw exploration ceiling. A complete\n"
    "            // candidate must not tighten it; longer skeletons may compress\n"
    "            // below the final best after insertion and cancellation.\n",
    rust,
    count=1,
)
if count != 1:
    raise SystemExit(f"direct incumbent tightening: expected 1 match, found {count}")

htr_pattern = re.compile(
    r"(?m)^\s*if htr_simplified\.len\(\) < \*current_best \{\n"
    r"\s*\*current_best = htr_simplified\.len\(\);\n"
    r"\s*\}\n"
)
rust, count = htr_pattern.subn(
    "                        // HTR completion also leaves the raw ceiling unchanged.\n",
    rust,
    count=1,
)
if count != 1:
    raise SystemExit(f"HTR incumbent tightening: expected 1 match, found {count}")

rust = replace_exact(
    rust,
    "let mut best_count = incumbent_move_count.clamp(1, 40);",
    "// Independent from the best completed solution: Extreme can retain\n"
    "    // 28-34 move raw skeletons after finding a 20-21 move result.\n"
    "    let mut raw_exploration_limit = incumbent_move_count.clamp(1, 40);",
    "raw ceiling declaration",
)
ref_count = rust.count("&mut best_count")
if ref_count < 1:
    raise SystemExit("raw ceiling references: no &mut best_count references found")
rust = rust.replace("&mut best_count", "&mut raw_exploration_limit")
rust_path.write_text(rust)

assert "human-L0-" not in js
assert "baselineCandidateImported: false" in js
assert "rawLimitIndependentFromFinalBest: true" in js
assert "*current_best = simplified.len()" not in rust
assert "*current_best = htr_simplified.len()" not in rust
assert "let mut raw_exploration_limit" in rust
