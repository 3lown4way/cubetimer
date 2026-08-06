import {
  ensureSolver444Ready,
  getSolver444ReadinessStatus,
  solve444 as solve444Internal,
} from "./solver444Internal.js";

const REVERSED_WCA_FACES_444 = new Set(["U", "R", "D", "L"]);

export { ensureSolver444Ready, getSolver444ReadinessStatus };

/**
 * The Rust 96-facelet engine predates the browser WCA notation boundary.
 * Its U/R/D/L quarter-turns are the inverse of cubing.js/WCA notation,
 * while F/B and all half turns agree. This mapping is an involution, so
 * it is used both for public input -> internal input and internal output ->
 * public output. Wide turns use the same face direction as their outer turn.
 */
export function translate444NotationConvention(algorithm) {
  return String(algorithm || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const match = /^([URFDLBurfdlb])([wW]?)(2|')?$/.exec(token);
      if (!match) return token;
      const [, rawFace, explicitWide = "", suffix = ""] = match;
      const face = rawFace.toUpperCase();
      const wide = rawFace === rawFace.toLowerCase() || explicitWide ? "w" : "";
      const normalized = `${face}${wide}${suffix}`;
      if (suffix === "2" || !REVERSED_WCA_FACES_444.has(face)) return normalized;
      return suffix === "'" ? `${face}${wide}` : `${face}${wide}'`;
    })
    .join(" ");
}

function publicStages(stages) {
  return (Array.isArray(stages) ? stages : []).map((stage) => {
    const solution = translate444NotationConvention(stage?.solution);
    return {
      ...stage,
      solution,
      moveCount: solution ? solution.split(/\s+/).filter(Boolean).length : 0,
    };
  });
}

export async function solve444(scramble, onProgress = null, options = {}) {
  const wcaScramble = String(scramble || "").trim();
  const internalScramble = translate444NotationConvention(wcaScramble);
  const result = await solve444Internal(internalScramble, onProgress, options);
  if (!result || typeof result !== "object") return result;

  const stages = publicStages(result.stages);
  const meta = {
    ...(result.meta && typeof result.meta === "object" ? result.meta : {}),
    notationConvention: "WCA",
  };

  if (result.ok !== true || result.verified !== true) {
    return {
      ...result,
      solution: "",
      moveCount: 0,
      verified: false,
      stages,
      meta,
    };
  }

  const solution = translate444NotationConvention(result.solution);
  return {
    ...result,
    solution,
    moveCount: solution ? solution.split(/\s+/).filter(Boolean).length : 0,
    stages,
    meta,
  };
}
