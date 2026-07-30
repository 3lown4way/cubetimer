import { performance } from 'node:perf_hooks';
import { cube3x3x3 } from './vendor/cubing/puzzles/index.js';
import { solve3x3StrictCfopFromPattern } from './solver/cfop3x3.js';

const baseScrambles = [
  "D2 B2 R2 U' R2 U B2 D2 L2 F2 U2 F' D' B L' U B' L' U' R'",
  "F2 D2 B2 F2 L2 D2 B2 U R2 U' L2 B U' F2 U' R' B2 D2 R' D",
  "B2 D2 L2 U' B2 D2 F2 U' F2 L2 U' R B' D2 B' R' B2 D2 R2 F",
  "U2 R2 D' L2 B2 D' R2 F2 U B2 L' D B' R' D2 U L F2 U",
  "L2 D2 B2 U F2 U2 R2 D' F2 U L2 R' B2 U' F D' L B' U2",
];
const scrambles = Array.from({ length: 100 }, (_, i) => baseScrambles[i % baseScrambles.length]);
const percentile = (xs, p) => { const s=[...xs].sort((a,b)=>a-b); return s[Math.min(s.length-1, Math.ceil(s.length*p)-1)] ?? 0; };
const mean = xs => xs.reduce((a,b)=>a+b,0)/(xs.length||1);

const kpuzzle = await cube3x3x3.kpuzzle();
const solved = kpuzzle.defaultPattern();
const results = [];
for (const mode of ['strict','zb']) {
  for (const version of ['v1','v2']) {
    const rows=[];
    for (const scramble of scrambles) {
      const pattern=solved.applyAlg(scramble);
      const t0=performance.now();
      const result=await solve3x3StrictCfopFromPattern(pattern,{mode,solverVersion:version,crossColor:'D',enableOllPllPrediction:false,allowRelaxedSearch:false,deadlineTs:Date.now()+30000});
      const ms=performance.now()-t0;
      const ok=result?.ok===true && pattern.applyAlg(result.solution||'').experimentalIsSolved({ignorePuzzleOrientation:false});
      rows.push({ok,ms,moves:Number(result?.moveCount||0),reason:result?.reason||null});
    }
    const good=rows.filter(r=>r.ok); const times=good.map(r=>r.ms);
    const summary={mode,version,success:good.length,total:rows.length,avgMs:mean(times),medianMs:percentile(times,.5),p95Ms:percentile(times,.95),minMs:Math.min(...times),maxMs:Math.max(...times),avgMoves:mean(good.map(r=>r.moves)),failures:rows.filter(r=>!r.ok)};
    results.push(summary); console.log(JSON.stringify(summary));
  }
}
for (const mode of ['strict','zb']) {
  const a=results.find(r=>r.mode===mode&&r.version==='v1'); const b=results.find(r=>r.mode===mode&&r.version==='v2');
  console.log(`${mode.toUpperCase()} SPEEDUP avg=${(a.avgMs/b.avgMs).toFixed(2)}x median=${(a.medianMs/b.medianMs).toFixed(2)}x p95=${(a.p95Ms/b.p95Ms).toFixed(2)}x moves=${a.avgMoves.toFixed(2)}->${b.avgMoves.toFixed(2)} success=${a.success}/${a.total}->${b.success}/${b.total}`);
}
