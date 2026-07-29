import { performance } from 'node:perf_hooks';
import {
  prewarm3x3StrictCfopLibraries,
} from './solver/cfop3x3.js';

const contextStarted = performance.now();
const base = await prewarm3x3StrictCfopLibraries({
  includeF2L: true,
  includeSingleStage: false,
});
const baseMs = performance.now() - contextStarted;

const singleStageStarted = performance.now();
const full = await prewarm3x3StrictCfopLibraries({
  includeF2L: false,
  includeSingleStage: true,
});
const singleStageMs = performance.now() - singleStageStarted;

console.log('=== ZB cold-start benchmark ===');
console.log(`context+F2L: ${baseMs.toFixed(1)}ms ready=${base.f2lCaseLibraryReady}`);
console.log(`OLL/PLL/ZBLS/ZBLL libraries: ${singleStageMs.toFixed(1)}ms cache=${full.singleStageLibraryCacheSize}`);
console.log(`total prewarm: ${(baseMs + singleStageMs).toFixed(1)}ms`);
