import fs from 'node:fs';

function read(path) {
  const lines = fs.readFileSync(path, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

const baseline = read(process.argv[2]);
const optimized = read(process.argv[3]);

if (optimized.success !== optimized.total) {
  throw new Error(`ZB correctness failure: ${JSON.stringify(optimized.failures)}`);
}
if (optimized.avgMoves > baseline.avgMoves + 1.0) {
  throw new Error(
    `ZB move regression: ${baseline.avgMoves.toFixed(2)} -> ${optimized.avgMoves.toFixed(2)}`,
  );
}
if (optimized.firstMs > baseline.firstMs * 1.1 + 10) {
  throw new Error(
    `ZB cold-start regression: ${baseline.firstMs.toFixed(2)} -> ${optimized.firstMs.toFixed(2)}ms`,
  );
}
if (optimized.warmAvgMs > baseline.warmAvgMs * 1.15 + 1) {
  throw new Error(
    `ZB warm regression: ${baseline.warmAvgMs.toFixed(2)} -> ${optimized.warmAvgMs.toFixed(2)}ms`,
  );
}

console.log(
  `ZB cold ${baseline.firstMs.toFixed(2)}ms -> ${optimized.firstMs.toFixed(2)}ms; ` +
  `warm ${baseline.warmAvgMs.toFixed(2)}ms -> ${optimized.warmAvgMs.toFixed(2)}ms; ` +
  `ZBLS cold stage ${baseline.firstZblsMs.toFixed(2)}ms -> ${optimized.firstZblsMs.toFixed(2)}ms; ` +
  `moves ${baseline.avgMoves.toFixed(2)} -> ${optimized.avgMoves.toFixed(2)}`,
);
console.log(JSON.stringify({ baseline, optimized }));
