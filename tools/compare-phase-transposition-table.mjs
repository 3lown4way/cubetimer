import { readFile } from 'node:fs/promises';

if (process.argv.length < 4) {
  throw new Error('usage: compare-phase-transposition-table.mjs BASELINE OPTIMIZED');
}

const baseline = JSON.parse(await readFile(process.argv[2], 'utf8'));
const optimized = JSON.parse(await readFile(process.argv[3], 'utf8'));
const ratio = (value, reference) => reference > 0 ? value / reference : 1;
const pct = (value) => `${((value - 1) * 100).toFixed(1)}%`;

if (baseline.success !== baseline.total) {
  throw new Error(`baseline failures: ${JSON.stringify(baseline.failures)}`);
}
if (optimized.success !== optimized.total) {
  throw new Error(`optimized failures: ${JSON.stringify(optimized.failures)}`);
}
if (Math.abs(optimized.movesAvg - baseline.movesAvg) > 0.001) {
  throw new Error(`move-count changed: ${baseline.movesAvg} -> ${optimized.movesAvg}`);
}

const p1TimeRatio = ratio(optimized.p1AvgMs, baseline.p1AvgMs);
const p2TimeRatio = ratio(optimized.p2AvgMs, baseline.p2AvgMs);
const totalTimeRatio = ratio(optimized.totalAvgMs, baseline.totalAvgMs);
const p1NodeRatio = ratio(optimized.p1NodesAvg, baseline.p1NodesAvg);
const p2NodeRatio = ratio(optimized.p2NodesAvg, baseline.p2NodesAvg);

// Hash collisions may discard cache entries but must not materially increase work.
if (p1NodeRatio > 1.12) throw new Error(`Phase 1 node regression: ${pct(p1NodeRatio)}`);
if (p2NodeRatio > 1.12) throw new Error(`Phase 2 node regression: ${pct(p2NodeRatio)}`);
if (totalTimeRatio > 1.08) throw new Error(`total runtime regression: ${pct(totalTimeRatio)}`);

console.log(
  `Phase TT: P1 ${baseline.p1AvgMs.toFixed(2)}ms -> ${optimized.p1AvgMs.toFixed(2)}ms ` +
  `(${pct(p1TimeRatio)}), P2 ${baseline.p2AvgMs.toFixed(2)}ms -> ${optimized.p2AvgMs.toFixed(2)}ms ` +
  `(${pct(p2TimeRatio)}), total ${baseline.totalAvgMs.toFixed(2)}ms -> ${optimized.totalAvgMs.toFixed(2)}ms ` +
  `(${pct(totalTimeRatio)}); nodes P1 ${baseline.p1NodesAvg.toFixed(0)} -> ${optimized.p1NodesAvg.toFixed(0)}, ` +
  `P2 ${baseline.p2NodesAvg.toFixed(0)} -> ${optimized.p2NodesAvg.toFixed(0)}; ` +
  `heap ${baseline.memory.heapUsedAfterMiB.toFixed(1)}MiB -> ${optimized.memory.heapUsedAfterMiB.toFixed(1)}MiB, ` +
  `arrayBuffers ${baseline.memory.arrayBuffersAfterMiB.toFixed(1)}MiB -> ${optimized.memory.arrayBuffersAfterMiB.toFixed(1)}MiB`,
);
console.log(JSON.stringify({ baseline, optimized }));
