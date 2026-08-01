import fs from "node:fs";

const path = "solver/cfop3x3.js";
let source = fs.readFileSync(path, "utf8");

const insertBefore = `    const fallbackKeys =
      typeof stage.getFallbackFormulaKeys === "function"`;
const rescueBlock = `    // The bundled ZBLL set is incomplete for a small number of legal EO-LL
    // states. Keep the direct ZBLL lookup/formula scan as the primary path,
    // then compose a human OLL + PLL rescue only for those uncovered states.
    if (stage.name === "ZBLL" && stage.allowOllPllRescue !== false) {
      const ollStage = {
        ...stage,
        name: "OLL",
        displayName: "OLL",
        formulaKeys: ["OLL"],
        getFormulaKeys: undefined,
        getFallbackFormulaKeys: undefined,
        getFormulaPreferenceMap: undefined,
        zbllKey: undefined,
        formulaPostAufList: [""],
        formulaAttemptLimit: 0,
        maxDepth: Math.max(stage.maxDepth || 0, 22),
        isSolved: isOLLSolved,
        acceptFormulaResult(nextPattern) {
          return isOLLSolved(nextPattern.patternData, ctx);
        },
        key(data) {
          const f2lC = buildKeyForOrbit(data.CORNERS, ctx.f2lCornerPositions, true, true);
          const f2lE = buildKeyForOrbit(data.EDGES, ctx.f2lEdgePositions, true, true);
          const ollC = buildKeyForOrbit(data.CORNERS, ctx.topCornerPositions, false, true);
          const ollE = buildKeyForOrbit(data.EDGES, ctx.topEdgePositions, false, true);
          return \`FC:\${f2lC}|FE:\${f2lE}|OC:\${ollC}|OE:\${ollE}\`;
        },
      };
      const ollResult = isOLLSolved(startPattern.patternData, ctx)
        ? { ok: true, moves: [], depth: 0, nodes: 0, bound: 0 }
        : solveWithFormulaDbSingleStage(startPattern, ollStage, ctx);
      if (ollResult?.ok) {
        const afterOll = ollResult.moves?.length
          ? tryApplyMoves(startPattern, ollResult.moves)
          : startPattern;
        if (afterOll) {
          const pllStage = {
            ...stage,
            name: "PLL",
            displayName: "PLL",
            formulaKeys: ["PLL"],
            getFormulaKeys: undefined,
            getFallbackFormulaKeys: undefined,
            getFormulaPreferenceMap: undefined,
            zbllKey: undefined,
            formulaAttemptLimit: 0,
            maxDepth: Math.max(stage.maxDepth || 0, 22),
            isSolved: isPLLSolved,
            acceptFormulaResult(nextPattern) {
              return isPLLSolved(nextPattern.patternData, ctx);
            },
          };
          const pllResult = isPLLSolved(afterOll.patternData, ctx)
            ? { ok: true, moves: [], depth: 0, nodes: 0, bound: 0 }
            : solveWithFormulaDbSingleStage(afterOll, pllStage, ctx);
          if (pllResult?.ok) {
            const moves = [...(ollResult.moves || []), ...(pllResult.moves || [])];
            return {
              ok: true,
              moves,
              depth: moves.length,
              nodes: (ollResult.nodes || 0) + (pllResult.nodes || 0),
              bound: moves.length,
              formulaKey: "ZBLL_OLL_PLL_RESCUE",
              method: "oll_pll_rescue",
            };
          }
        }
      }
    }

`;

if (!source.includes(rescueBlock.trim())) {
  if (!source.includes(insertBefore)) throw new Error("ZBLL rescue insertion point not found");
  source = source.replace(insertBefore, rescueBlock + insertBefore);
}

const currentSearchBlock = `      searchMaxDepth: normalizeDepth(
        options.zbllSearchMaxDepth,
        useZbLL ? 14 : profile.pllMaxDepth,
      ),
      nodeLimit: normalizeDepth(options.zbllNodeLimit, useZbLL ? 2500000 : 0),
      // Pure ZB keeps the formula database as the primary path. If both the
      // precompiled index and exhaustive formula validation miss, finish the
      // already-oriented last layer with the stage-local face-turn search.
      disableSearchFallback: false,`;
const finalSearchBlock = `      searchMaxDepth: normalizeDepth(
        options.zbllSearchMaxDepth,
        useZbLL ? 10 : profile.pllMaxDepth,
      ),
      nodeLimit: normalizeDepth(options.zbllNodeLimit, useZbLL ? 180000 : 0),
      // Pure ZB uses direct ZBLL first and the bounded OLL+PLL rescue above;
      // never fall through to the expensive generic full-state IDA* search.
      disableSearchFallback: useZbLL,`;
if (source.includes(currentSearchBlock)) {
  source = source.replace(currentSearchBlock, finalSearchBlock);
} else if (!source.includes(finalSearchBlock)) {
  throw new Error("ZBLL stage-search block not found");
}

fs.writeFileSync(path, source);
console.log("Applied bounded OLL+PLL rescue for uncovered ZBLL states.");
