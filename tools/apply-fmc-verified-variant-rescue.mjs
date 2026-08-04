import fs from "node:fs";

const path = "solver/wasmSolver.js";
const before = fs.readFileSync(path, "utf8");
let source = before;

const marker = "const validateCandidateFrontier = (candidateResult) => {";
const rescuePortfolioMarker = "const verifiedVariantRescueOffsets = [2, 16];";

const validationHelperAndState = `    const validateCandidateFrontier = (candidateResult) => {
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

`;

const rescueState = `    let validation = validateCandidateFrontier(parsed);
    let invalidCandidateCount = validation.invalidCandidateCount;
    let repairedPremoveNissCandidateCount = validation.repairedPremoveNissCandidateCount;
    let verifiedVariantRescueAttempted = false;
    let verifiedVariantRescueUsed = false;
    let verifiedVariantRescueVariant = null;
    const verifiedVariantRescueVariantsTried = [];
    const verifiedVariantRescueOffsets = [2, 16];

    // Raw default callers first keep the cheap base frontier. If every completed
    // candidate fails the public verifier, try a small independent FMC portfolio.
    // Explicit site quality stages retain the exact requested search variant.
    if (validation.validCandidates.length === 0 && !explicitSearchLevel) {
      verifiedVariantRescueAttempted = true;
      for (const offset of verifiedVariantRescueOffsets) {
        const rescueVariant = Math.max(
          0,
          Math.floor(Number(normalizedOptions.searchVariant) || 0) + offset,
        );
        verifiedVariantRescueVariantsTried.push(rescueVariant);
        const rescueParsed = invokeFmc({
          ...normalizedOptions,
          maxPremoveSets: Math.max(20, Number(normalizedOptions.maxPremoveSets) || 0),
          searchLevel: 3,
          searchVariant: rescueVariant,
        });
        if (rescueParsed?.ok !== true || !Array.isArray(rescueParsed.candidates)) {
          continue;
        }
        const rescueValidation = validateCandidateFrontier(rescueParsed);
        invalidCandidateCount += rescueValidation.invalidCandidateCount;
        repairedPremoveNissCandidateCount +=
          rescueValidation.repairedPremoveNissCandidateCount;
        if (rescueValidation.validCandidates.length === 0) continue;
        parsed = rescueParsed;
        validation = rescueValidation;
        verifiedVariantRescueUsed = true;
        verifiedVariantRescueVariant = rescueVariant;
        break;
      }
    }

    const validCandidates = validation.validCandidates;
`;

if (!source.includes(marker)) {
  const startAnchor = "    const validCandidates = [];\n";
  const endAnchor = "    const best = validCandidates[0];\n";
  const start = source.indexOf(startAnchor);
  const end = source.indexOf(endAnchor, start);
  if (start < 0 || end < 0) {
    throw new Error("Missing inline FMC candidate validation anchors");
  }
  source =
    source.slice(0, start) +
    validationHelperAndState +
    rescueState +
    `    if (validCandidates.length === 0) {
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
        verifiedVariantRescueVariantsTried,
      };
    }

` +
    source.slice(end);
} else if (!source.includes(rescuePortfolioMarker)) {
  const stateStartAnchor = "    let validation = validateCandidateFrontier(parsed);\n";
  const stateEndAnchor = "    const validCandidates = validation.validCandidates;\n";
  const stateStart = source.indexOf(stateStartAnchor);
  const stateEndStart = source.indexOf(stateEndAnchor, stateStart);
  if (stateStart < 0 || stateEndStart < 0) {
    throw new Error("Missing verified FMC rescue state anchors");
  }
  const stateEnd = stateEndStart + stateEndAnchor.length;
  source = source.slice(0, stateStart) + rescueState + source.slice(stateEnd);

  const failureNeedle = `        verifiedVariantRescueUsed,
        verifiedVariantRescueVariant,
      };`;
  const failureReplacement = `        verifiedVariantRescueUsed,
        verifiedVariantRescueVariant,
        verifiedVariantRescueVariantsTried,
      };`;
  if (source.includes(failureNeedle)) {
    source = source.replace(failureNeedle, failureReplacement);
  }
}

const successBaseAnchor = `      repairedPremoveNissCandidateCount,
      levelEscalationUsed,
      initialReason,
    };`;
const successSingleRescueAnchor = `      repairedPremoveNissCandidateCount,
      levelEscalationUsed,
      initialReason,
      verifiedVariantRescueAttempted,
      verifiedVariantRescueUsed,
      verifiedVariantRescueVariant,
    };`;
const successReplacement = `      repairedPremoveNissCandidateCount,
      levelEscalationUsed,
      initialReason,
      verifiedVariantRescueAttempted,
      verifiedVariantRescueUsed,
      verifiedVariantRescueVariant,
      verifiedVariantRescueVariantsTried,
    };`;
if (source.includes(successSingleRescueAnchor)) {
  source = source.replace(successSingleRescueAnchor, successReplacement);
} else if (source.includes(successBaseAnchor)) {
  source = source.replace(successBaseAnchor, successReplacement);
}

if (!source.includes(marker)) throw new Error("Verified FMC frontier helper was not applied");
if (!source.includes(rescuePortfolioMarker)) {
  throw new Error("Verified FMC rescue portfolio was not applied");
}
if (!source.includes("searchVariant: rescueVariant")) {
  throw new Error("Verified FMC rescue request was not applied");
}
if (!source.includes(successReplacement)) {
  throw new Error("Verified FMC success diagnostics were not applied");
}

if (source !== before) fs.writeFileSync(path, source);
console.log(source === before
  ? "Verified FMC rescue portfolio already applied"
  : "Applied verified FMC rescue portfolio");
