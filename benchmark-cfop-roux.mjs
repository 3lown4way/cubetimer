import { cube3x3x3 } from './vendor/cubing/puzzles/index.js';
import { solve3x3StrictCfopFromPattern } from './solver/cfop3x3.js';
import { solve3x3RouxFromPattern } from './solver/roux3x3.js';

const kpuzzle = await cube3x3x3.kpuzzle();
const solved = kpuzzle.defaultPattern();
const scrambles = [
  'R U R\' U\' R\' F R2 U\' R\' U\' R U R\' F\'',
  'D2 B2 R2 U\' R2 U B2 D2 L2 F2 U2 F\' D\' B L\' U B\' L\' U\' R\'',
  'F2 D2 B2 F2 L2 D2 B2 U R2 U\' L2 B U\' F2 U\' R\' B2 D2 R\' D',
  'B2 D2 L2 U\' B2 D2 F2 U\' F2 L2 U\' R B\' D2 B\' R\' B2 D2 R2 F',
  'U2 R2 D\' L2 B2 D\' R2 F2 U B2 L\' D B\' R\' D2 U L F2 U',
];

console.log('=== Benchmark: CFOP vs Roux ===\n');

// CFOP baseline
console.log('CFOP (strict mode):');
let cfopTimes = [];
for (const s of scrambles) {
  const p = solved.applyAlg(s);
  const t0 = Date.now();
  const r = await solve3x3StrictCfopFromPattern(p, {
    crossColor: 'white',
    mode: 'strict',
    deadlineMs: 10000
  });
  const elapsed = Date.now() - t0;
  cfopTimes.push(elapsed);
  console.log(`  ${elapsed.toString().padStart(4)}ms ${r?.ok ? 'OK' : 'FAIL'} (${r?.moveCount ?? '?'} moves)`);
}
const cfopAvg = cfopTimes.reduce((a, b) => a + b, 0) / cfopTimes.length;
console.log(`  Avg: ${cfopAvg.toFixed(1)}ms\n`);

// Roux baseline
console.log('Roux (strict mode):');
let rouxTimes = [];
for (const s of scrambles) {
  const p = solved.applyAlg(s);
  const t0 = Date.now();
  const r = await solve3x3RouxFromPattern(p, {
    mode: 'strict',
    deadlineMs: 10000
  });
  const elapsed = Date.now() - t0;
  rouxTimes.push(elapsed);
  console.log(`  ${elapsed.toString().padStart(4)}ms ${r?.ok ? 'OK' : 'FAIL'} (${r?.moveCount ?? '?'} moves)`);
}
const rouxAvg = rouxTimes.reduce((a, b) => a + b, 0) / rouxTimes.length;
console.log(`  Avg: ${rouxAvg.toFixed(1)}ms\n`);

const ratio = cfopAvg / rouxAvg;
console.log(`CFOP/Roux ratio: ${ratio.toFixed(2)}x`);

process.exit(0);
