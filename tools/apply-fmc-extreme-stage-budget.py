from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    if old not in text:
        raise SystemExit(f"missing target in {path}: {old[:120]!r}")
    file_path.write_text(text.replace(old, new, 1))


path = Path("solver/fmcSolver.js")
text = path.read_text()
text = text.replace(
    '''  const stage = (name, stageOptions) => ({
    name,
    options: { ...common, ...stageOptions },
  });''',
    '''  const stage = (name, stageOptions, minRemainingMs = 250) => ({
    name,
    minRemainingMs,
    options: { ...common, ...stageOptions },
  });''',
    1,
)
text = text.replace(
    '''      stage("extreme-wide-seed", {
        maxPremoveSets: capPremoves(32),
        enableMultiSwitchNiss: true,
      }),''',
    '''      stage("extreme-wide-seed", {
        maxPremoveSets: capPremoves(32),
        enableMultiSwitchNiss: true,
      }, 100),''',
    1,
)
text = text.replace(
    '''      stage("extreme-deep-eo-dr", {
        maxPremoveSets: capPremoves(120),
        enableMultiSwitchNiss: true,
        enableDeepMultiSwitchNiss: true,
      }),''',
    '''      stage("extreme-deep-eo-dr", {
        maxPremoveSets: capPremoves(120),
        enableMultiSwitchNiss: true,
        enableDeepMultiSwitchNiss: true,
      }, 750),''',
    1,
)
text = text.replace(
    '''      stage("extreme-htr-insertion", {
        maxPremoveSets: capPremoves(160),
        enableHtrSkeletons: true,
        enableSliceInsertion: true,
        enableDeepMultiSwitchNiss: true,
      }),''',
    '''      stage("extreme-htr-insertion", {
        maxPremoveSets: capPremoves(160),
        enableHtrSkeletons: true,
        enableSliceInsertion: true,
        enableDeepMultiSwitchNiss: true,
      }, 2200),''',
    1,
)
text = text.replace(
    '''      stage("extreme-full-human-portfolio", {
        maxPremoveSets: requestedPremoveSets,
        enableMultiInsertion: true,
        enableHtrSkeletons: true,
        enableSliceInsertion: true,
        enableMultiSwitchNiss: true,
        enableDeepMultiSwitchNiss: true,
      }),''',
    '''      stage("extreme-full-human-portfolio", {
        maxPremoveSets: requestedPremoveSets,
        enableMultiInsertion: true,
        enableHtrSkeletons: true,
        enableSliceInsertion: true,
        enableMultiSwitchNiss: true,
        enableDeepMultiSwitchNiss: true,
      }, 1100),''',
    1,
)
text = text.replace(
    '''  const timeBudgetMs = Number.isFinite(options.timeBudgetMs)
    ? Math.max(1000, Math.floor(options.timeBudgetMs))
    : qualityPreset.timeBudgetMs;''',
    '''  const timeBudgetMs = Number.isFinite(options.timeBudgetMs)
    ? Math.max(100, Math.floor(options.timeBudgetMs))
    : qualityPreset.timeBudgetMs;''',
    1,
)
old_loop = '''      for (let stageIndex = 0; stageIndex < wasmStages.length; stageIndex += 1) {
        if (remainingMs(deadlineTs) <= 250) break;
        if (Number.isFinite(bestMoveCount) && bestMoveCount <= targetMoveCount) break;

        const qualityStage = wasmStages[stageIndex];
        notify({'''
new_loop = '''      for (let stageIndex = 0; stageIndex < wasmStages.length; stageIndex += 1) {
        const remainingBeforeStage = remainingMs(deadlineTs);
        if (remainingBeforeStage <= 100) break;
        if (Number.isFinite(bestMoveCount) && bestMoveCount <= targetMoveCount) break;

        const qualityStage = wasmStages[stageIndex];
        const minRemainingMs = Number.isFinite(qualityStage.minRemainingMs)
          ? Math.max(0, qualityStage.minRemainingMs)
          : 250;
        if (remainingBeforeStage < minRemainingMs) continue;
        notify({'''
if old_loop not in text:
    raise SystemExit("FMC quality scheduler loop target missing")
text = text.replace(old_loop, new_loop, 1)
path.write_text(text)

runtime_path = Path("benchmark-fmc-extreme-contract.mjs")
runtime = runtime_path.read_text()
replace_target = '''assert.equal(result.qualityTargetReached, result.moveCount <= 20);

const wasmStages'''
replacement = '''assert.equal(result.qualityTargetReached, result.moveCount <= 20);
assert.ok(elapsedMs < 1000, `900 ms Extreme budget overran to ${elapsedMs.toFixed(1)} ms`);

const wasmStages'''
if replace_target not in runtime:
    raise SystemExit("runtime elapsed assertion target missing")
runtime_path.write_text(runtime.replace(replace_target, replacement, 1))

verify_path = Path("tools/verify-benchmark-no-fallback.mjs")
verify = verify_path.read_text()
verify = verify.replace(
    '''  'maxPremoveSets: capPremoves(32)',
  'stage("extreme-deep-eo-dr"',''',
    '''  'maxPremoveSets: capPremoves(32)',
  '}, 100)',
  '}, 750)',
  '}, 2200)',
  '}, 1100)',
  'Math.max(100, Math.floor(options.timeBudgetMs))',
  'remainingBeforeStage < minRemainingMs',
  'stage("extreme-deep-eo-dr"',''',
    1,
)
verify_path.write_text(verify)

Path("tools/apply-fmc-extreme-stage-budget.py").unlink()
