import { performance } from 'node:perf_hooks';
import {
  prewarm3x3StrictCfopLibraries,
} from './solver/cfop3x3.js';

const contextStarted = performance.now();
const contextOnly = await prewarm3x3StrictCfopLibraries({
  includeF2L: false,
  includeSingleStage: false,
});
const contextMs = performance.now() - contextStarted;

const f2lStarted = performance.now();
const withF2L = await prewarm3x3StrictCfopLibraries({
  includeF2L: true,
  includeSingleStage: false,
});
const f2lMs = performance.now() - f2lStarted;

const singleStageStarted = performance.now();
const full = await prewarm3x3StrictCfopLibraries({
  includeF2L: false,
  includeSingleStage: true,
});
const singleStageMs = performance.now() - singleStageStarted;

console.log('=== CFOP/ZB cold-start benchmark ===');
console.log(`context tables: ${contextMs.toFixed(1)}ms cache=${contextOnly.singleStageLibraryCacheSize}`);
console.log(`F2L formula library: ${f2lMs.toFixed(1)}ms ready=${withF2L.f2lCaseLibraryReady}`);
console.log(`OLL/PLL/ZBLS/ZBLL libraries: ${singleStageMs.toFixed(1)}ms cache=${full.singleStageLibraryCacheSize}`);
console.log(`total full prewarm: ${(contextMs + f2lMs + singleStageMs).toFixed(1)}ms`);
