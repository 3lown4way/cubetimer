import fs from "node:fs";

const file = new URL("../solver/cfop3x3.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");

function replaceOnce(label, before, after) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: source block not found`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label}: source block is not unique`);
  }
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
  "capture XCross probe duration",
  `    const probeStage = getStageDefinitions(probeOptions, ctx, modeProfile, solveMode)[0];
    const probeResult = solveStage(pattern, probeStage, ctx);
    const selectedTargetPairs = probeResult?.ok ? 1 : 0;
    const childResult = await solve3x3StrictCfopFromPattern(pattern, {`,
  `    const probeStage = getStageDefinitions(probeOptions, ctx, modeProfile, solveMode)[0];
    const probeResult = solveStage(pattern, probeStage, ctx);
    const probeElapsedMs = Math.max(1, Date.now() - probeStartedAt);
    const selectedTargetPairs = probeResult?.ok ? 1 : 0;
    const childResult = await solve3x3StrictCfopFromPattern(pattern, {`,
);

replaceOnce(
  "use isolated XCross probe duration",
  `          elapsedMs: Math.max(1, Date.now() - probeStartedAt),
          selectedTargetPairs,`,
  `          elapsedMs: probeElapsedMs,
          selectedTargetPairs,`,
);

replaceOnce(
  "preserve successful stage prefix on failure",
  `      return withPerformance({
        ok: false,
        reason: result.reason || \`${'${stage.name.toUpperCase()}'}_FAILED\`,
        stage: stage.name,
        nodes: totalNodes,
        stageDiagnostics,
      });`,
  `      return withPerformance({
        ok: false,
        reason: result.reason || \`${'${stage.name.toUpperCase()}'}_FAILED\`,
        stage: stage.name,
        nodes: totalNodes,
        stages: solvedStages.map((entry) => ({ ...entry })),
        partialSolution: joinMoves(allMoves),
        failureState:
          solveMode === "zb"
            ? {
                stageName: stage.name,
                key: typeof stage.key === "function" ? stage.key(stageStartPattern.patternData) : null,
                corners: {
                  pieces: Array.from(stageStartPattern.patternData.CORNERS.pieces),
                  orientation: Array.from(stageStartPattern.patternData.CORNERS.orientation),
                },
                edges: {
                  pieces: Array.from(stageStartPattern.patternData.EDGES.pieces),
                  orientation: Array.from(stageStartPattern.patternData.EDGES.orientation),
                },
              }
            : null,
        stageDiagnostics,
      });`,
);

fs.writeFileSync(file, source);
console.log("Applied targeted Pure ZB failure diagnostics");
