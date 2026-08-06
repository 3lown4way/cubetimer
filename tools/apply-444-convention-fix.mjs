import fs from "node:fs";

function replaceOnce(path, before, after, label) {
  const source = fs.readFileSync(path, "utf8");
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one target, found ${count}`);
  fs.writeFileSync(path, source.replace(before, after));
}

replaceOnce(
  "solver444-wasm/src/reduction.rs",
  `const CORNER_FACELETS: [[usize; 3]; CORNER_COUNT] = [
    [8, 9, 20],
    [6, 18, 38],
    [0, 36, 47],
    [2, 45, 11],
    [29, 26, 15],
    [27, 44, 24],
    [33, 53, 42],
    [35, 17, 51],
];

const CORNER_COLORS: [[u8; 3]; CORNER_COUNT] = [
    [0, 1, 2],
    [0, 2, 4],
    [0, 4, 5],
    [0, 5, 1],
    [3, 2, 1],
    [3, 4, 2],
    [3, 5, 4],
    [3, 1, 5],
];`,
  `const CORNER_FACELETS: [[usize; 3]; CORNER_COUNT] = [
    [8, 9, 20],   // URF
    [2, 45, 11],  // UBR
    [0, 36, 47],  // UBL
    [6, 18, 38],  // UFL
    [29, 26, 15], // DFR
    [27, 44, 24], // DLF
    [33, 53, 42], // DBL
    [35, 17, 51], // DRB
];

const CORNER_COLORS: [[u8; 3]; CORNER_COUNT] = [
    [0, 1, 2],
    [0, 5, 1],
    [0, 4, 5],
    [0, 2, 4],
    [3, 2, 1],
    [3, 4, 2],
    [3, 5, 4],
    [3, 1, 5],
];`,
  "cubing.js corner order",
);

replaceOnce(
  "solver444-wasm/src/reduction.rs",
  `const EDGE_FACELETS: [[usize; 2]; EDGE_COUNT] = [
    [5, 10],
    [7, 19],
    [3, 37],
    [1, 46],
    [32, 16],
    [28, 25],
    [30, 43],
    [34, 52],
    [23, 12],
    [21, 41],
    [50, 39],
    [48, 14],
];

const EDGE_COLORS: [[u8; 2]; EDGE_COUNT] = [
    [0, 1],
    [0, 2],
    [0, 4],
    [0, 5],
    [3, 1],
    [3, 2],
    [3, 4],
    [3, 5],
    [2, 1],
    [2, 4],
    [5, 4],
    [5, 1],
];`,
  `const EDGE_FACELETS: [[usize; 2]; EDGE_COUNT] = [
    [7, 19],  // UF
    [5, 10],  // UR
    [1, 46],  // UB
    [3, 37],  // UL
    [28, 25], // DF
    [32, 16], // DR
    [34, 52], // DB
    [30, 43], // DL
    [23, 12], // FR
    [21, 41], // FL
    [48, 14], // BR
    [50, 39], // BL
];

const EDGE_COLORS: [[u8; 2]; EDGE_COUNT] = [
    [0, 2],
    [0, 1],
    [0, 5],
    [0, 4],
    [3, 2],
    [3, 1],
    [3, 5],
    [3, 4],
    [2, 1],
    [2, 4],
    [5, 1],
    [5, 4],
];`,
  "cubing.js edge order",
);

replaceOnce(
  "solver/solver444.js",
  `function deadlineReached(deadlineTs) {
  const deadline = Number(deadlineTs);
  return Number.isFinite(deadline) && deadline > 0 && Date.now() >= deadline;
}`,
  `function deadlineReached(deadlineTs) {
  const deadline = Number(deadlineTs);
  return Number.isFinite(deadline) && deadline > 0 && Date.now() >= deadline;
}

function translateTwophaseSolutionFor444(solution) {
  return String(solution || "")
    .trim()
    .split(/\\s+/)
    .filter(Boolean)
    .map((token) => {
      const match = /^([URFDLB])(2|')?$/.exec(token);
      if (!match) return token;
      const [, face, suffix = ""] = match;
      if (suffix === "2" || !["R", "D", "L"].includes(face)) return token;
      return suffix === "'" ? face : face + "'";
    })
    .join(" ");
}`,
  "Two-Phase output translator",
);

replaceOnce(
  "solver/solver444.js",
  `  const threeByThreeStage = {
    id: "threeByThree",
    name: "3x3 Stage",
    solution: String(twophase.solution).trim(),
    moveCount: Number(twophase.moveCount) || String(twophase.solution).trim().split(/\\s+/).filter(Boolean).length,
    verified: false,
  };`,
  `  const translatedTwophaseSolution = translateTwophaseSolutionFor444(twophase.solution);
  const threeByThreeStage = {
    id: "threeByThree",
    name: "3x3 Stage",
    solution: translatedTwophaseSolution,
    moveCount: translatedTwophaseSolution ? translatedTwophaseSolution.split(/\\s+/).length : 0,
    verified: false,
  };`,
  "translated 3x3 stage",
);

console.log("Applied exact 4x4/Two-Phase convention bridge");
