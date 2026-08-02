from pathlib import Path

PROFILE_ID = "independent-frontier-v2-compression-first-24"


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"missing target in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


replace_once(
    "solver/fmcExtremeProfile.js",
    '  id: "independent-frontier-v2-24",\n',
    f'  id: "{PROFILE_ID}",\n',
)
replace_once(
    "solver/fmcExtremeProfile.js",
    "  extremeReservedCompressionPremoves: 48,\n",
    "  extremeReservedCompressionPremoves: 24,\n",
)
replace_once(
    "solver/fmcExtremeProfile.js",
    "  continueBelowTarget: true,\n",
    "  continueBelowTarget: false,\n",
)

replace_once(
    "solver/fmcSolver.js",
    "    const variantOrder = [0, reservedCompressionVariant];\n",
    "    const variantOrder = [reservedCompressionVariant, 0];\n",
)
replace_once(
    "solver/fmcSolver.js",
    '''      // Reserve multi-insertion immediately after one fast L1 scout. Repeated\n      // L2 searches can no longer consume the entire short Extreme budget.\n''',
    '''      // Reproduce the validated compression benchmark first: L3-V7 with\n      // 24 premove sets. Only expand to scout and wider variants on target miss.\n''',
)

# Runtime contract: first stage must be the old validated L3-V7/24 profile.
Path("benchmark-fmc-extreme-contract.mjs").write_text(f'''import assert from "node:assert/strict";
import {{ performance }} from "node:perf_hooks";
import {{ solveWithFMCSearch }} from "./solver/fmcSolver.js";
import {{ buildFmcTablesWasm }} from "./solver/wasmSolver.js";
import {{ FMC_EXTREME_PROFILE, buildFmcExtremeOptions }} from "./solver/fmcExtremeProfile.js";

const scramble = "L2 U2 R U' F2 R' D L D2 L2 B' R' D2 F2 R' B' R2 F L F2 U B D2 B' U2";
const siteOptions = buildFmcExtremeOptions({{ timeBudgetMs: 1000, targetMoveCount: 20 }});

assert.equal(FMC_EXTREME_PROFILE.id, "{PROFILE_ID}");
assert.equal(siteOptions.extremeVariantCount, 24);
assert.equal(siteOptions.maxPremoveSets, 180);
assert.equal(siteOptions.extremeReservedCompressionPremoves, 24);
assert.equal(siteOptions.continueBelowTarget, false);
assert.equal(siteOptions.enableCoverageFallback, false);
assert.equal(siteOptions.allowCfopFallback, false);
assert.equal(siteOptions.premoveAllowCfopFallback, false);

assert.equal(await buildFmcTablesWasm(), true);
const startedAt = performance.now();
const result = await solveWithFMCSearch(scramble, null, siteOptions);
const elapsedMs = performance.now() - startedAt;
const diagnostics = result?.performanceDiagnostics || {{}};
const stages = diagnostics.wasmStages || [];

assert.equal(result?.extremeProfileId || diagnostics.extremeProfileId, FMC_EXTREME_PROFILE.id);
assert.ok(stages.length >= 1, "compression-first Extreme executed no frontier");
assert.equal(stages[0]?.name, "human-L3-V7-reserved");
assert.equal(stages[0]?.maxPremoveSets, 24);
assert.equal(stages[0]?.multiInsertion, true);
assert.equal(stages[0]?.htr, true);
assert.equal(stages[0]?.sliceInsertion, true);
assert.equal(stages.some((stage) => /baseline|sweet/i.test(stage.name)), false);
assert.equal(result?.qualityDowngraded, false);
if (result?.ok) {{
  assert.equal(result.qualityTargetReached, true);
  assert.ok(result.moveCount <= 20);
  assert.equal(stages.length, 1, "target reached but Extreme continued into expansion stages");
}} else {{
  assert.equal(result?.reason, "FMC_EXTREME_TARGET_NOT_REACHED");
  assert.ok(Number(result?.bestCandidate?.moveCount) > 20);
}}

console.log(JSON.stringify({{
  profile: FMC_EXTREME_PROFILE.id,
  elapsedMs,
  ok: result?.ok === true,
  reason: result?.reason || "",
  moveCount: result?.moveCount ?? result?.bestCandidate?.moveCount ?? null,
  stages: stages.map((stage) => ({{ name: stage.name, maxPremoveSets: stage.maxPremoveSets, moveCount: stage.moveCount }})),
}}));
''')

# Policy fixtures must identify the new profile exactly.
policy_test = Path("benchmark/benchmark-no-fallback-policy.test.mjs")
text = policy_test.read_text().replace(
    'extremeProfileId: "independent-frontier-v2-24"',
    f'extremeProfileId: "{PROFILE_ID}"',
)
policy_test.write_text(text)

verify = Path("tools/verify-benchmark-no-fallback.mjs")
text = verify.read_text()
text = text.replace('id: "independent-frontier-v2-24"', f'id: "{PROFILE_ID}"')
text = text.replace('"extremeReservedCompressionPremoves: 48"', '"extremeReservedCompressionPremoves: 24"')
text = text.replace(
    '''  "FMC_EXTREME_PROFILE.extremeReservedCompressionPremoves",\n''',
    '''  "FMC_EXTREME_PROFILE.extremeReservedCompressionPremoves",\n  "const variantOrder = [reservedCompressionVariant, 0]",\n''',
)
verify.write_text(text)

# The patcher is an integration aid only.
Path("tools/apply-fmc-extreme-compression-first.py").unlink()
