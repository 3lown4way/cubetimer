import { randomScrambleForEvent } from "./vendor/cubing/scramble/index.js";
import { solve3x3RouxFromPattern } from './solver/roux3x3.js';
import { getDefaultPattern } from './solver/context.js';

const solvedPattern = await getDefaultPattern('333');

const scrambles = [];
for (let i = 0; i < 100; i++) {
  const scr = await randomScrambleForEvent("333");
  scrambles.push(scr.toString());
}

console.log('=== Roux Benchmark: 100 Random Scrambles ===\n');

let successCount = 0;
let failCount = 0;
let totalMoves = 0;
let totalNodes = 0;
let totalTime = 0;

for (let i = 0; i < 100; i++) {
  const scramble = scrambles[i];
  const startTime = Date.now();
  
  try {
    const pattern = solvedPattern.applyAlg(scramble);
    const result = await solve3x3RouxFromPattern(pattern, { deadlineTs: Date.now() + 60000 });
    
    const elapsed = Date.now() - startTime;
    totalTime += elapsed;
    
    if (result.ok) {
      successCount++;
      totalMoves += result.moveCount;
      totalNodes += result.nodes || 0;
      console.log(`[${i+1}/100] ✅ ${scramble.substring(0, 40).padEnd(40)} - ${String(result.moveCount).padStart(2)} moves, ${elapsed}ms`);
    } else {
      failCount++;
      console.log(`[${i+1}/100] ❌ ${scramble.substring(0, 40).padEnd(40)} - ${result.reason}`);
    }
  } catch (error) {
    failCount++;
    console.log(`[${i+1}/100] ❌ ${scramble.substring(0, 40).padEnd(40)} - Error: ${error.message}`);
  }
}

console.log('\n=== Benchmark Results ===');
console.log(`Total: ${successCount + failCount}`);
console.log(`Success: ${successCount}/100 (${(successCount).toFixed(0)}%)`);
console.log(`Failed: ${failCount}/100 (${(failCount).toFixed(0)}%)`);
if (successCount > 0) {
  console.log(`Average Moves: ${(totalMoves / successCount).toFixed(1)}`);
  console.log(`Average Time: ${(totalTime / 100).toFixed(0)}ms`);
  console.log(`Total Time: ${totalTime}ms`);
  console.log(`Total Nodes: ${totalNodes}`);
}
console.log('');
