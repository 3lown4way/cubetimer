import { readFile } from 'node:fs/promises';

if (process.argv.length < 4) {
  throw new Error('usage: compare-wasm-search-hotpath.mjs BASELINE OPTIMIZED');
}

const baseline = JSON.parse(await readFile(process.argv[2], 'utf8'));
const optimized = JSON.parse(await readFile(process.argv[3], 'utf8'));
const pct = (before, after) => ((after / before) - 1) * 100;

if (baseline.success !== baseline.total || optimized.success !== optimized.total) {
  throw new Error(`solve failures: baseline=${JSON.stringify(baseline.failures)} optimized=${JSON.stringify(optimized.failures)}`);
}
if (optimized.total !== baseline.total) throw new Error('benchmark sample count changed');
if (optimized.movesAvg > baseline.movesAvg + 0.25) {
  throw new Error(`move regression: ${baseline.movesAvg} -> ${optimized.movesAvg}`);
}
if (optimized.phase1NodesAvg > baseline.phase1NodesAvg * 1.04) {
  throw new Error(`phase1 node regression: ${baseline.phase1NodesAvg} -> ${optimized.phase1NodesAvg}`);
}
if (optimized.phase2NodesAvg > baseline.phase2NodesAvg * 1.04) {
  throw new Error(`phase2 node regression: ${baseline.phase2NodesAvg} -> ${optimized.phase2NodesAvg}`);
}
if (optimized.totalAvgMs > baseline.totalAvgMs * 0.97) {
  throw new Error(`insufficient speedup: ${baseline.totalAvgMs} -> ${optimized.totalAvgMs}`);
}
if (optimized.totalP95Ms > baseline.totalP95Ms * 1.08) {
  throw new Error(`p95 regression: ${baseline.totalP95Ms} -> ${optimized.totalP95Ms}`);
}
if (optimized.wasmBytes > baseline.wasmBytes * 1.30) {
  throw new Error(`WASM size regression: ${baseline.wasmBytes} -> ${optimized.wasmBytes}`);
}

console.log(
  `WASM hotpath: prepare ${baseline.prepareAvgMs.toFixed(2)}ms -> ${optimized.prepareAvgMs.toFixed(2)}ms ` +
  `(${pct(baseline.prepareAvgMs, optimized.prepareAvgMs).toFixed(1)}%), search ` +
  `${baseline.searchAvgMs.toFixed(2)}ms -> ${optimized.searchAvgMs.toFixed(2)}ms ` +
  `(${pct(baseline.searchAvgMs, optimized.searchAvgMs).toFixed(1)}%), total ` +
  `${baseline.totalAvgMs.toFixed(2)}ms -> ${optimized.totalAvgMs.toFixed(2)}ms ` +
  `(${pct(baseline.totalAvgMs, optimized.totalAvgMs).toFixed(1)}%), p95 ` +
  `${baseline.totalP95Ms.toFixed(2)}ms -> ${optimized.totalP95Ms.toFixed(2)}ms; ` +
  `nodes P1 ${baseline.phase1NodesAvg.toFixed(0)} -> ${optimized.phase1NodesAvg.toFixed(0)}, ` +
  `P2 ${baseline.phase2NodesAvg.toFixed(0)} -> ${optimized.phase2NodesAvg.toFixed(0)}; ` +
  `moves ${baseline.movesAvg.toFixed(2)} -> ${optimized.movesAvg.toFixed(2)}; ` +
  `WASM ${(baseline.wasmBytes / 1024).toFixed(1)}KiB -> ${(optimized.wasmBytes / 1024).toFixed(1)}KiB`,
);
console.log(JSON.stringify({ baseline, optimized }));
