import assert from "node:assert/strict";
import {
  countBenchmarkMoves,
  formatBenchmarkSolveRecord,
  replaceBenchmarkUnitText,
} from "./benchmark-copy-record.js";

const cfopRecord = formatBenchmarkSolveRecord({
  scramble: "F2 U' F2 L' B' L D L' F2 R2 U' L2 F2 U2 F2 U' B2 L2 D' F2 R'",
  mode: "cfop",
  stages: [
    { name: "Cross (Yellow | DF DR DB DL)", solution: "B2 D' F2 B'" },
    { name: "F2L 1", solution: "U R' U2 R2 U R'" },
    { name: "F2L 2", solution: "F2 R B' R' F2" },
    { name: "F2L 3", solution: "B L U' L2 B2 L B2" },
    { name: "F2L 4", solution: "R B2 U B' U' B2 R'" },
    { name: "OLL", solution: "U' L' U2 L2 F' L' F L' U2 L" },
    { name: "PLL", solution: "x R' U R' D2 R U' R' D2 R2 x' U'" },
  ],
});

assert.equal(cfopRecord, `Scramble: F2 U' F2 L' B' L D L' F2 R2 U' L2 F2 U2 F2 U' B2 L2 D' F2 R'

Cross (Yellow | DF DR DB DL) (4회전): B2 D' F2 B'
F2L 1 (6회전): U R' U2 R2 U R'
F2L 2 (5회전): F2 R B' R' F2
F2L 3 (7회전): B L U' L2 B2 L B2
F2L 4 (7회전): R B2 U B' U' B2 R'
OLL (10회전): U' L' U2 L2 F' L' F L' U2 L
PLL (12회전): x R' U R' D2 R U' R' D2 R2 x' U'`);

const zbRecord = formatBenchmarkSolveRecord({
  scramble: "R U R' U'",
  mode: "zb",
  stages: [
    { name: "Cross", solution: "D R'" },
    { name: "F2L 1", solution: "U R U' R'" },
    { name: "F2L 2", solution: "U2 L' U L" },
    { name: "F2L 3", solution: "R U R'" },
    { name: "ZBLS", solution: "U R U2 R'" },
    { name: "ZBLL", solution: "R U R' U R U2 R'" },
  ],
});
assert.match(zbRecord, /ZBLS \(4회전\)/);
assert.match(zbRecord, /ZBLL \(7회전\)/);

const rouxRecord = formatBenchmarkSolveRecord({
  scramble: "R2 U F2",
  mode: "roux",
  stages: [
    { name: "FB", solution: "x L U L'" },
    { name: "SB", solution: "M U M'" },
    { name: "CMLL", solution: "R U R'" },
    { name: "LSE", solution: "M2 U M2" },
  ],
});
assert.match(rouxRecord, /FB \(4회전\)/);
assert.match(rouxRecord, /LSE \(3회전\)/);

const fmcRecord = formatBenchmarkSolveRecord({
  scramble: "U R2 F",
  mode: "fmc",
  stages: [
    { name: "EO", solution: "F R U" },
    { name: "DR", solution: "R2 D2" },
    { name: "Insertion", note: "3-cycle insertion applied" },
  ],
  finalSolution: "F R U R2 D2 U2",
});
assert.match(fmcRecord, /EO \(3회전\)/);
assert.match(fmcRecord, /Insertion: 3-cycle insertion applied/);
assert.match(fmcRecord, /Final Solution \(6회전\)/);

const minmoveRecord = formatBenchmarkSolveRecord({
  scramble: "R U R'",
  mode: "minmove",
  finalSolution: "R U' R'",
});
assert.match(minmoveRecord, /minmove HTM \(3회전\)/);

const failureRecord = formatBenchmarkSolveRecord({
  scramble: "R U2 F'",
  mode: "zb",
  failureReason: "ZBLL_NOT_FOUND",
});
assert.match(failureRecord, /실패 단계: ZBLL/);
assert.match(failureRecord, /실패 원인: ZBLL_NOT_FOUND/);

assert.equal(countBenchmarkMoves("x R U2 R' x'"), 5);
assert.equal(replaceBenchmarkUnitText("24수 이하"), "24회전 이하");
assert.equal(replaceBenchmarkUnitText("  수 "), "  회전 ");
assert.equal(replaceBenchmarkUnitText("평균 해 길이"), "평균 회전");
assert.equal(replaceBenchmarkUnitText("알 수 없는 오류"), "알 수 없는 오류");
assert.ok(!cfopRecord.includes("수):"));

console.log("benchmark copy record formatting verified");
