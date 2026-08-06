import fs from "node:fs";

function replaceOnce(path, before, after, label) {
  const source = fs.readFileSync(path, "utf8");
  if (source.includes(after)) return;
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one target, found ${count}`);
  fs.writeFileSync(path, source.replace(before, after));
}

replaceOnce(
  "solver/solver444.js",
  `  if (centerStage && result.meta?.centersSolved === true) {\n    emitProgress(onProgress, {\n      type: "444_stage_done",\n      eventId: "444",\n      stage: "CENTERS",\n      stageName: "Centers",\n      moveCount: Number(centerStage.moveCount) || 0,\n      tableBuildMs: Number(result.meta.centerTableBuildMs) || 0,\n      searchMs: Number(result.meta.centerSearchMs) || 0,\n    });\n  }\n\n  emitProgress(onProgress, {`,
  `  if (centerStage && result.meta?.centersSolved === true) {\n    emitProgress(onProgress, {\n      type: "444_stage_done",\n      eventId: "444",\n      stage: "CENTERS",\n      stageName: "Centers",\n      moveCount: Number(centerStage.moveCount) || 0,\n      tableBuildMs: Number(result.meta.centerTableBuildMs) || 0,\n      searchMs: Number(result.meta.centerSearchMs) || 0,\n    });\n  }\n\n  const edgeStage = Array.isArray(result.stages)\n    ? result.stages.find((stage) => stage?.id === "edges" && stage?.verified === true)\n    : null;\n  if (edgeStage && result.meta?.edgesPaired === true) {\n    emitProgress(onProgress, {\n      type: "444_stage_done",\n      eventId: "444",\n      stage: "EDGES",\n      stageName: "Edge Pairing",\n      moveCount: Number(edgeStage.moveCount) || 0,\n      tableBuildMs: Number(result.meta.edgeTableBuildMs) || 0,\n      searchMs: Number(result.meta.edgeSearchMs) || 0,\n    });\n  }\n\n  emitProgress(onProgress, {`,
  "edge progress event",
);

const verifierPath = "tools/verify-444-worker-boundary.mjs";
let verifier = fs.readFileSync(verifierPath, "utf8");
verifier = verifier
  .replace(`{ deadlineTs: Date.now() + 10_000 },`, `{ deadlineTs: Date.now() + 30_000 },`)
  .replace(`assert.equal(valid.stages.length, 1);`, `assert.equal(valid.stages.length, 2);`)
  .replace(
    `assert.equal(valid.stages[0].moveCount, valid.meta.centerMoveCount);\nassert.equal(valid.meta.centersSolved, true);`,
    `assert.equal(valid.stages[0].moveCount, valid.meta.centerMoveCount);\nassert.equal(valid.stages[1].id, "edges");\nassert.equal(valid.stages[1].name, "Edge Pairing");\nassert.equal(valid.stages[1].verified, true);\nassert.equal(valid.stages[1].moveCount, valid.meta.edgeMoveCount);\nassert.equal(valid.meta.centersSolved, true);\nassert.equal(valid.meta.edgesPaired, true);`,
  )
  .replaceAll(`444-centers-v1`, `444-edges-v1`)
  .replace(
    `assert.ok(progress.some((update) => update.type === "444_stage_done" && update.stage === "CENTERS"));`,
    `assert.ok(progress.some((update) => update.type === "444_stage_done" && update.stage === "CENTERS"));\nassert.ok(progress.some((update) => update.type === "444_stage_done" && update.stage === "EDGES"));`,
  );
if (!verifier.includes(`assert.equal(valid.stages[1].id, "edges");`)) {
  throw new Error("worker verifier edge contract was not applied");
}
fs.writeFileSync(verifierPath, verifier);

const engineReadme = `# 4×4 solver engine

This crate is the correctness-first foundation and browser boundary for the cubetimer 4×4 reduction solver.

## Available now

- 96-facelet reference state in \`U R F D L B\` order
- outer and two-layer wide turns for all six faces
- WCA-style \`Rw\` notation and lowercase wide aliases
- color, corner, wing, and center inventory validation
- four exact center pruning coordinates with 753,311 total abstract states
- independently verified Centers stage generation
- oriented 24-wing coordinate derived from the 96-facelet geometry
- eight sequential exact edge-pair distance tables
- an exact 40,320-state last-four-edge table, including L2E handling
- independently verified Edge Pairing stage generation
- \`wasm-bindgen\` browser exports and absolute-deadline checks
- lazy worker routing, progress, and readiness reporting

## Boundary contract

The engine solves and independently verifies all centers and all twelve edge pairs. It does not claim a complete 4×4 solution until parity normalization and the virtual 3×3 bridge are implemented. A valid request returns \`ok: false\`, an empty final \`solution\`, and two verified partial stages:

\`\`\`json
{
  "ok": false,
  "status": "partial",
  "reason": "444_REDUCTION_INCOMPLETE",
  "solution": "",
  "moveCount": 0,
  "verified": false,
  "stages": [
    { "id": "centers", "name": "Centers", "solution": "...", "verified": true },
    { "id": "edges", "name": "Edge Pairing", "solution": "...", "verified": true }
  ]
}
\`\`\`

Each stage is reapplied to the independent 96-facelet model before exposure. Expired deadlines and invalid notation preserve the empty final-result contract. No stage is promoted to a complete solution or fallback.

## Still to implement

- parity normalization
- virtual 3×3 conversion and existing Two-Phase bridge
- final independent full-solution verification
- user-facing 4×4 solver activation

## Build

\`\`\`bash
wasm-pack build solver444-wasm \\
  --target web \\
  --out-dir ../public/solver444-wasm \\
  --out-name solver444_wasm \\
  --release
\`\`\`
`;
fs.writeFileSync("solver444-wasm/README.md", engineReadme);

const browserReadme = `# 4×4 solver browser package

This directory contains the checked-in browser package generated from \`solver444-wasm\`.

## Available now

- lazy loading only for \`eventId === "444"\`
- WCA-style 4×4 parsing and 96-facelet physical validation
- exact and independently verified Centers stage
- exact sequential edge pairing with a 40,320-state last-four-edge table
- independently verified Edge Pairing stage, including L2E handling
- absolute deadline, readiness, and progress reporting

## Boundary contract

The package returns two verified partial stages while keeping the final 4×4 result closed:

\`\`\`json
{
  "ok": false,
  "status": "partial",
  "reason": "444_REDUCTION_INCOMPLETE",
  "solution": "",
  "moveCount": 0,
  "verified": false,
  "stages": [
    { "id": "centers", "name": "Centers", "solution": "...", "verified": true },
    { "id": "edges", "name": "Edge Pairing", "solution": "...", "verified": true }
  ]
}
\`\`\`

The partial stages are never promoted to a complete solution or fallback. Parity normalization, virtual 3×3 conversion, the Two-Phase bridge, and final full-solution verification remain closed.

## Exports

\`\`\`js
solve_444_json(requestJson)
solver_444_api_version()
\`\`\`

## Rebuild

\`\`\`bash
wasm-pack build solver444-wasm \\
  --target web \\
  --out-dir ../public/solver444-wasm \\
  --out-name solver444_wasm \\
  --release
\`\`\`
`;
fs.writeFileSync("public/solver444-wasm/README.md", browserReadme);

console.log("Applied 4x4 edge runtime integration");
