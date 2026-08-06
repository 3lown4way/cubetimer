import fs from "node:fs";

function replaceOnce(path, before, after, label) {
  const source = fs.readFileSync(path, "utf8");
  if (source.includes(after)) return;
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one target, found ${count}`);
  fs.writeFileSync(path, source.replace(before, after));
}

replaceOnce(
  "solver444-wasm/src/centers.rs",
  "assert_eq!(coordinate_rank(GOAL_UD_GROUP, &ALL_CENTER_POSITIONS, 8), 319_769);",
  "assert_eq!(coordinate_rank(GOAL_UD_GROUP, &ALL_CENTER_POSITIONS, 8), 12_375);",
  "phase1 combinadic rank",
);

replaceOnce(
  "solver/solver444.js",
  `  const ok = value.ok === true;\n  const solution = ok ? String(value.solution || "").trim() : "";`,
  `  const ok = value.ok === true;\n  const partial = !ok && String(value.status || "") === "partial";\n  const solution = ok ? String(value.solution || "").trim() : "";`,
  "partial boundary flag",
);
replaceOnce(
  "solver/solver444.js",
  `    stages: ok && Array.isArray(value.stages) ? value.stages : [],`,
  `    stages: (ok || partial) && Array.isArray(value.stages) ? value.stages : [],`,
  "partial stage preservation",
);
replaceOnce(
  "solver/solver444.js",
  `  emitProgress(onProgress, {\n    type: result.ok ? "444_stage_done" : "444_stage_fail",\n    eventId: "444",\n    stage: "BOUNDARY",\n    reason: result.reason,\n    status: result.status,\n  });`,
  `  const centerStage = Array.isArray(result.stages)\n    ? result.stages.find((stage) => stage?.id === "centers" && stage?.verified === true)\n    : null;\n  if (centerStage && result.meta?.centersSolved === true) {\n    emitProgress(onProgress, {\n      type: "444_stage_done",\n      eventId: "444",\n      stage: "CENTERS",\n      stageName: "Centers",\n      moveCount: Number(centerStage.moveCount) || 0,\n      tableBuildMs: Number(result.meta.centerTableBuildMs) || 0,\n      searchMs: Number(result.meta.centerSearchMs) || 0,\n    });\n  }\n\n  emitProgress(onProgress, {\n    type: result.ok\n      ? "444_stage_done"\n      : result.status === "partial"\n        ? "444_stage_update"\n        : "444_stage_fail",\n    eventId: "444",\n    stage: "REDUCTION",\n    reason: result.reason,\n    status: result.status,\n  });`,
  "center progress event",
);

replaceOnce(
  "solver/solverWorker.js",
  `const SOLVER_444_BOUNDARY_TIMEOUT_MS = 5000;`,
  `const SOLVER_444_BOUNDARY_TIMEOUT_MS = 30000;`,
  "4x4 center timeout",
);

const verifierPath = "tools/verify-444-worker-boundary.mjs";
let verifier = fs.readFileSync(verifierPath, "utf8");
verifier = verifier
  .replace(`assert.equal(valid.status, "not_implemented");`, `assert.equal(valid.status, "partial");`)
  .replace(`assert.equal(valid.reason, "444_NOT_IMPLEMENTED");`, `assert.equal(valid.reason, "444_REDUCTION_INCOMPLETE");`)
  .replace(`assert.deepEqual(valid.stages, []);`, `assert.equal(valid.stages.length, 1);\nassert.equal(valid.stages[0].id, "centers");\nassert.equal(valid.stages[0].name, "Centers");\nassert.equal(valid.stages[0].verified, true);\nassert.equal(valid.stages[0].moveCount, valid.meta.centerMoveCount);\nassert.equal(valid.meta.centersSolved, true);`)
  .replace(`assert.equal(valid.meta.apiVersion, "444-boundary-v1");`, `assert.equal(valid.meta.apiVersion, "444-centers-v1");`)
  .replace(`assert.ok(progress.some((update) => update.type === "444_stage_fail" && update.reason === "444_NOT_IMPLEMENTED"));`, `assert.ok(progress.some((update) => update.type === "444_stage_done" && update.stage === "CENTERS"));\nassert.ok(progress.some((update) => update.type === "444_stage_update" && update.stage === "REDUCTION" && update.reason === "444_REDUCTION_INCOMPLETE"));`)
  .replace(`assert.equal(readiness.apiVersion, "444-boundary-v1");`, `assert.equal(readiness.apiVersion, "444-centers-v1");`);
if (!verifier.includes(`assert.equal(valid.status, "partial");`)) {
  throw new Error("worker verifier partial contract was not applied");
}
fs.writeFileSync(verifierPath, verifier);

replaceOnce(
  "solver444-wasm/README.md",
  `- progress and readiness reporting\n\n## Boundary contract\n\nThe current engine validates the request and scrambled 4×4 state, but it does not claim to solve it yet. A valid request returns:\n\n\`\`\`json\n{\n  "ok": false,\n  "status": "not_implemented",\n  "reason": "444_NOT_IMPLEMENTED",\n  "solution": "",\n  "moveCount": 0,\n  "verified": false,\n  "stages": []\n}\n\`\`\`\n\nExpired deadlines return \`444_DEADLINE_REACHED\`; invalid notation returns \`444_INVALID_SCRAMBLE\`. No candidate or fallback solution is exposed.`,
  `- progress and readiness reporting\n- four exact center pruning coordinates with 753,311 total abstract states\n- independently verified Centers stage generation\n\n## Boundary contract\n\nThe current engine solves and verifies all 24 centers, but it does not claim to solve the full 4×4 yet. A valid request returns \`ok: false\`, an empty final \`solution\`, and one verified partial stage:\n\n\`\`\`json\n{\n  "ok": false,\n  "status": "partial",\n  "reason": "444_REDUCTION_INCOMPLETE",\n  "solution": "",\n  "moveCount": 0,\n  "verified": false,\n  "stages": [\n    {\n      "id": "centers",\n      "name": "Centers",\n      "solution": "...",\n      "moveCount": 24,\n      "verified": true\n    }\n  ]\n}\n\`\`\`\n\nExpired deadlines return \`444_DEADLINE_REACHED\`; invalid notation returns \`444_INVALID_SCRAMBLE\`. The verified center stage is never promoted to a complete solution or fallback.`,
  "crate README center contract",
);

replaceOnce(
  "public/solver444-wasm/README.md",
  `- reports readiness and progress events\n\nSearch is intentionally not exposed yet. A valid request returns \`444_NOT_IMPLEMENTED\` with an empty \`solution\`, \`moveCount: 0\`, no stages, and no fallback candidate. Expired deadlines return \`444_DEADLINE_REACHED\` with the same empty-result contract.`,
  `- reports readiness and progress events\n- solves all 24 centers with four exact pruning coordinates\n- returns one independently verified Centers stage\n\nThe full reduction search is intentionally not exposed yet. A valid request returns \`444_REDUCTION_INCOMPLETE\` with an empty final \`solution\` and a verified Centers stage. Expired deadlines return \`444_DEADLINE_REACHED\`; no partial stage is promoted to a complete solution or fallback.`,
  "public README center contract",
);

console.log("Applied 4x4 center integration patches");
