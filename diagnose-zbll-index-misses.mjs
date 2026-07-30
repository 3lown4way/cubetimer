import { cube3x3x3 } from './vendor/cubing/puzzles/index.js';
import { solve3x3StrictCfopFromPattern } from './solver/cfop3x3.js';

const scrambles = [
  "B' U' B' R F2 R U' D2 R D2 F R2 F' R2 F2 R2 B L2 U2 D2",
  "R2 F2 U2 B2 R2 U2 R2 D' L2 D' R2 U2 B' L' D' L F2 L2 R2 F",
  "U2 R L2 B2 R2 F' D B U2 R F2 U2 F2 B2 L' F2 U2 L2 B2 L'",
  "L B' D R2 F' R2 L U' B2 R2 D2 F2 L F2 B2 L' U2 L' U2 L' U",
  "D F2 L2 U L2 F2 U' L2 U B2 U2 R2 F' U B R D R B U",
  "R2 B2 D2 L' U F' L' R2 U2 F R2 U2 F' R2 B D2 R2 F' U2 L B2",
  "U' B' U2 L B2 D' L U B' U F2 U2 L2 D' L2 F2 U' F2 B2 L2 D'",
];

const kpuzzle = await cube3x3x3.kpuzzle();
const solved = kpuzzle.defaultPattern();

for (const version of ['v1', 'v2']) {
  console.log(`\n=== ${version.toUpperCase()} ===`);
  for (let i = 0; i < scrambles.length; i++) {
    const scramble = scrambles[i];
    const result = await solve3x3StrictCfopFromPattern(solved.applyAlg(scramble), {
      mode: 'zb',
      solverVersion: version,
      crossColor: 'D',
      enableOllPllPrediction: false,
      allowRelaxedSearch: false,
      deadlineTs: Date.now() + 30000,
    });
    const failed = Array.isArray(result?.stageDiagnostics)
      ? result.stageDiagnostics.find((stage) => stage.ok === false)
      : null;
    const metrics = failed?.metrics || null;
    console.log(JSON.stringify({
      index: i + 1,
      scramble,
      ok: result?.ok === true,
      reason: result?.reason || null,
      stage: result?.stage || failed?.stageName || null,
      failedStage: failed || null,
      candidateCount: metrics?.candidateCount ?? null,
      attempts: metrics?.attempts ?? null,
      libraryCacheHit: metrics?.libraryCacheHit ?? null,
      lookupElapsedMs: metrics?.lookupElapsedMs ?? null,
      cacheSize: metrics?.cacheSize ?? null,
    }));
  }
}
