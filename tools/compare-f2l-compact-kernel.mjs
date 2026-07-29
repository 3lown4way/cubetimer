import fs from 'node:fs';

function readLastJson(path) {
  const lines = fs.readFileSync(path, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

const baseline = readLastJson(process.argv[2]);
const optimized = readLastJson(process.argv[3]);

function byMode(payload, mode) {
  const entry = payload.summaries.find((item) => item.mode === mode);
  if (!entry) throw new Error(`missing ${mode} summary`);
  return entry;
}

for (const mode of ['strict', 'zb']) {
  const before = byMode(baseline, mode);
  const after = byMode(optimized, mode);
  if (after.success !== after.total) {
    throw new Error(`${mode} correctness failure: ${JSON.stringify(after.failures)}`);
  }
  const moveBudget = mode === 'strict' ? 1.5 : 3.0;
  if (after.avgMoves > before.avgMoves + moveBudget) {
    throw new Error(
      `${mode} move regression: before=${before.avgMoves.toFixed(2)} after=${after.avgMoves.toFixed(2)}`,
    );
  }
  console.log(
    `${mode}: F2L ${before.warmF2lAvgMs.toFixed(2)}ms -> ${after.warmF2lAvgMs.toFixed(2)}ms, ` +
    `nodes ${before.warmF2lAvgNodes.toFixed(0)} -> ${after.warmF2lAvgNodes.toFixed(0)}, ` +
    `moves ${before.avgMoves.toFixed(2)} -> ${after.avgMoves.toFixed(2)}`,
  );
}

const strictBefore = byMode(baseline, 'strict');
const strictAfter = byMode(optimized, 'strict');
const zbBefore = byMode(baseline, 'zb');
const zbAfter = byMode(optimized, 'zb');

if (strictAfter.warmF2lAvgMs > strictBefore.warmF2lAvgMs * 1.05 + 1) {
  throw new Error('strict F2L compact kernel regressed by more than tolerance');
}
if (zbAfter.warmF2lAvgMs > zbBefore.warmF2lAvgMs * 0.8 + 1) {
  throw new Error('ZB F2L compact-first path did not improve enough');
}
if (optimized.kernelVersion !== 2) {
  throw new Error('optimized benchmark did not exercise compact kernel v2');
}

console.log(JSON.stringify({ baseline, optimized }));
