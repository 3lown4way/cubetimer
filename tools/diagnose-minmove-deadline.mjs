import { solveMinmoveExactV2 } from "../solver/minmoveExactV2.js";

const scramble = "F2 D U2 B2 L2 R2 U2 B' L2 F D2 B' F' U L' U' F U2 R' B";
const progress = [];
const result = await solveMinmoveExactV2(scramble, (event) => {
  progress.push({ ...event, at: Date.now() });
}, { timeBudgetMs: 120_000 });

console.log("PROGRESS", JSON.stringify(progress, null, 2));
console.log("RESULT", JSON.stringify(result, null, 2));
