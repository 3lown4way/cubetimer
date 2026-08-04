import fs from "node:fs";

const wasmPath = "solver/wasmSolver.js";
const rustPath = "solver-wasm/src/fmc_search.rs";
const before = fs.readFileSync(wasmPath, "utf8");
let source = before;

// Both premove-NISS flattening orders are intentional regression candidates;
// only the public solved-up-to-rotation verifier is allowed to select one.
const helperMarker = "function buildVerifiedPremoveNissAlternates(candidate)";
if (!source.includes(helperMarker)) {
  const helperAnchor = `/**
 * Run the full FMC pipeline (EO→DR→P2, 3 axes, NISS, premove sweep) entirely in WASM.`;
  const helpers = `function normalizeFmcMoveTokens(value) {
  if (Array.isArray(value)) return value.map((move) => String(move || "").trim()).filter(Boolean);
  return String(value || "").trim().split(/\\s+/).filter(Boolean);
}

function invertFmcMoveToken(token) {
  const value = String(token || "").trim();
  if (!value || value.endsWith("2")) return value;
  return value.endsWith("'") ? value.slice(0, -1) : value + "'";
}

function invertFmcMoveSequence(tokens) {
  return normalizeFmcMoveTokens(tokens).reverse().map(invertFmcMoveToken);
}

function simplifyFmcMoveSequence(tokens) {
  const output = [];
  for (const rawToken of normalizeFmcMoveTokens(tokens)) {
    const match = /^([URFDLBMESxyzurfdlb])(2|')?$/.exec(rawToken);
    if (!match) {
      output.push(rawToken);
      continue;
    }
    const face = match[1];
    const amount = match[2] === "2" ? 2 : match[2] === "'" ? 3 : 1;
    const previous = output[output.length - 1];
    const previousMatch = previous ? /^([URFDLBMESxyzurfdlb])(2|')?$/.exec(previous) : null;
    if (!previousMatch || previousMatch[1] !== face) {
      output.push(rawToken);
      continue;
    }
    const previousAmount = previousMatch[2] === "2" ? 2 : previousMatch[2] === "'" ? 3 : 1;
    const combined = (previousAmount + amount) % 4;
    output.pop();
    if (combined === 1) output.push(face);
    else if (combined === 2) output.push(face + "2");
    else if (combined === 3) output.push(face + "'");
  }
  return output;
}

function buildVerifiedPremoveNissAlternates(candidate) {
  const sourceTag = String(candidate?.source || "");
  if (!/^FMC_(?:HTR_)?PREMOVE_NISS_/.test(sourceTag)) return [];

  const pipeline = [
    ...normalizeFmcMoveTokens(candidate?.eoMoves),
    ...normalizeFmcMoveTokens(candidate?.drMoves),
    ...normalizeFmcMoveTokens(candidate?.finishMoves),
  ];
  const premoves = normalizeFmcMoveTokens(candidate?.premoves);
  if (pipeline.length === 0 || premoves.length === 0) return [];

  const inversePipeline = invertFmcMoveSequence(pipeline);
  const inversePremoves = invertFmcMoveSequence(premoves);
  const current = String(candidate?.solution || "").trim();
  const seen = new Set(current ? [current] : []);
  const alternatives = [];
  for (const tokens of [
    [...inversePremoves, ...inversePipeline],
    [...inversePipeline, ...inversePremoves],
  ]) {
    const simplified = simplifyFmcMoveSequence(tokens);
    const solution = simplified.join(" ");
    if (!solution || seen.has(solution)) continue;
    seen.add(solution);
    alternatives.push({ solution, moves: simplified, moveCount: simplified.length });
  }
  return alternatives;
}

`;
  const anchorIndex = source.indexOf(helperAnchor);
  if (anchorIndex < 0) throw new Error("Missing solveFmcWasm helper anchor");
  source = source.slice(0, anchorIndex) + helpers + source.slice(anchorIndex);
}

const enhancedMarker = "repairedPremoveNissCandidateCount";
if (!source.includes(enhancedMarker)) {
  const validationStart = source.indexOf(
    "    // The public FMC verifier is the source of truth for the exact solution",
  );
  const validationEndMarker = `  } catch (err) {
    console.warn("[solveFmcWasm] error:", err);`;
  const validationEnd = source.indexOf(validationEndMarker, validationStart);
  if (validationStart < 0 || validationEnd < 0) {
    throw new Error("Missing existing FMC candidate validation boundary");
  }

  const validationBlock = `    // The public FMC verifier is the source of truth for the exact solution
    // string returned to callers. The Rust search uses internal state frames,
    // so final validity and premove-NISS order repair remain at this boundary.
    if (
      typeof api.verifyFmcSolutionWasm !== "function" ||
      !Array.isArray(parsed.candidates)
    ) {
      return {
        ...parsed,
        ok: false,
        reason: "FMC_CANDIDATE_VERIFIER_UNAVAILABLE",
        solution: "",
        moveCount: 0,
        candidates: [],
      };
    }

    const verifyCandidateSolution = (solution) => {
      if (!solution) return false;
      try {
        const verifyRaw = api.verifyFmcSolutionWasm(String(scramble), String(solution));
        const verification = typeof verifyRaw === "string" ? JSON.parse(verifyRaw) : verifyRaw;
        return verification?.ok === true && verification.solved === true;
      } catch (_) {
        return false;
      }
    };

    const validCandidates = [];
    const seenSolutions = new Set();
    let invalidCandidateCount = 0;
    let repairedPremoveNissCandidateCount = 0;
    for (const candidate of parsed.candidates) {
      const originalSolution = String(candidate?.solution || "").trim();
      let accepted = null;
      if (verifyCandidateSolution(originalSolution)) {
        accepted = candidate;
      } else {
        invalidCandidateCount += 1;
        for (const alternate of buildVerifiedPremoveNissAlternates(candidate)) {
          if (!verifyCandidateSolution(alternate.solution)) continue;
          accepted = {
            ...candidate,
            solution: alternate.solution,
            moves: alternate.moves,
            moveCount: alternate.moveCount,
            repairedPremoveNissOrder: true,
          };
          repairedPremoveNissCandidateCount += 1;
          break;
        }
      }
      if (!accepted) continue;
      const solution = String(accepted.solution || "").trim();
      if (!solution || seenSolutions.has(solution)) continue;
      seenSolutions.add(solution);
      validCandidates.push(accepted);
    }

    validCandidates.sort((left, right) =>
      Number(left?.moveCount || 0) - Number(right?.moveCount || 0),
    );
    if (validCandidates.length === 0) {
      return {
        ...parsed,
        ok: false,
        reason: "FMC_NO_VERIFIED_SOLUTION",
        solution: "",
        moveCount: 0,
        candidates: [],
        invalidCandidateCount,
        repairedPremoveNissCandidateCount,
      };
    }

    const best = validCandidates[0];
    return {
      ...parsed,
      solution: String(best.solution),
      moveCount: Number(best.moveCount || 0),
      candidates: validCandidates,
      invalidCandidateCount,
      repairedPremoveNissCandidateCount,
    };
`;
  source = source.slice(0, validationStart) + validationBlock + source.slice(validationEnd);
}

if (source !== before) fs.writeFileSync(wasmPath, source);

const rustBefore = fs.readFileSync(rustPath, "utf8");
let rustSource = rustBefore;
const narrowFrontier = "    all_candidates.truncate(10);";
const verificationFrontier = `    // Keep a wider raw frontier until the public verifier rejects or repairs
    // malformed premove-NISS flattenings. The caller re-ranks verified results.
    all_candidates.truncate(32);`;
if (!rustSource.includes(verificationFrontier)) {
  const first = rustSource.indexOf(narrowFrontier);
  if (first < 0) throw new Error("Missing FMC raw candidate frontier limit");
  if (rustSource.indexOf(narrowFrontier, first + narrowFrontier.length) >= 0) {
    throw new Error("Ambiguous FMC raw candidate frontier limit");
  }
  rustSource = rustSource.slice(0, first) + verificationFrontier + rustSource.slice(first + narrowFrontier.length);
}
if (rustSource !== rustBefore) fs.writeFileSync(rustPath, rustSource);

const changed = source !== before || rustSource !== rustBefore;
console.log(changed ? "Applied FMC candidate repair and verification frontier" : "FMC candidate repair and verification frontier already applied");
