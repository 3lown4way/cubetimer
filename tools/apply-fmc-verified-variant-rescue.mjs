import fs from "node:fs";

const path = "solver/wasmSolver.js";
const before = fs.readFileSync(path, "utf8");
let source = before;

const marker = "const validateCandidateFrontier = (candidateResult) => {";
if (!source.includes(marker)) {
  const startAnchor = "    const validCandidates = [];\n";
  const endAnchor = "    const best = validCandidates[0];\n";
  const start = source.indexOf(startAnchor);
  const end = source.indexOf(endAnchor, start);
  if (start < 0 || end < 0) {
    throw new Error("Missing inline FMC candidate validation anchors");
  }

  const newBlock = `    const validateCandidateFrontier = (candidateResult) => {
      const validCandidates = [];
      const seenSolutions = new Set();
      let invalidCandidateCount = 0;
      let repairedPremoveNissCandidateCount = 0;
      for (const candidate of Array.isArray(candidateResult?.candidates)
        ? candidateResult.candidates
        : []) {
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
      return {
        validCandidates,
        invalidCandidateCount,
        repairedPremoveNissCandidateCount,
      };
    };

    let validation = validateCandidateFrontier(parsed);
    let invalidCandidateCount = validation.invalidCandidateCount;
    let repairedPremoveNissCandidateCount = validation.repairedPremoveNissCandidateCount;
    let verifiedVariantRescueAttempted = false;
    let verifiedVariantRescueUsed = false;
    let verifiedVariantRescueVariant = null;

    // A raw default caller may reach an L3 frontier whose internally completed
    // candidates all fail the public verifier. Try one independent FMC variant
    // before reporting failure. Explicit quality-stage requests remain exact.
    if (validation.validCandidates.length === 0 && !explicitSearchLevel) {
      verifiedVariantRescueAttempted = true;
      verifiedVariantRescueVariant = Math.max(
        0,
        Math.floor(Number(normalizedOptions.searchVariant) || 0) + 2,
      );
      const rescueParsed = invokeFmc({
        ...normalizedOptions,
        maxPremoveSets: Math.max(20, Number(normalizedOptions.maxPremoveSets) || 0),
        searchLevel: 3,
        searchVariant: verifiedVariantRescueVariant,
      });
      if (rescueParsed?.ok === true && Array.isArray(rescueParsed.candidates)) {
        const rescueValidation = validateCandidateFrontier(rescueParsed);
        invalidCandidateCount += rescueValidation.invalidCandidateCount;
        repairedPremoveNissCandidateCount +=
          rescueValidation.repairedPremoveNissCandidateCount;
        if (rescueValidation.validCandidates.length > 0) {
          parsed = rescueParsed;
          validation = rescueValidation;
          verifiedVariantRescueUsed = true;
        }
      }
    }

    const validCandidates = validation.validCandidates;
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
        levelEscalationUsed,
        initialReason,
        verifiedVariantRescueAttempted,
        verifiedVariantRescueUsed,
        verifiedVariantRescueVariant,
      };
    }

`;

  source = source.slice(0, start) + newBlock + source.slice(end);
}

const successAnchor = `      repairedPremoveNissCandidateCount,
      levelEscalationUsed,
      initialReason,
    };`;
const successReplacement = `      repairedPremoveNissCandidateCount,
      levelEscalationUsed,
      initialReason,
      verifiedVariantRescueAttempted,
      verifiedVariantRescueUsed,
      verifiedVariantRescueVariant,
    };`;
if (source.includes(successAnchor)) {
  source = source.replace(successAnchor, successReplacement);
}

if (!source.includes(marker)) throw new Error("Verified FMC frontier helper was not applied");
if (!source.includes("searchVariant: verifiedVariantRescueVariant")) {
  throw new Error("Verified FMC variant rescue request was not applied");
}
if (!source.includes(successReplacement)) {
  throw new Error("Verified FMC success diagnostics were not applied");
}

if (source !== before) fs.writeFileSync(path, source);
console.log(source === before
  ? "Verified FMC variant rescue already applied"
  : "Applied verified FMC variant rescue");
