import fs from "node:fs";

const path = "solver/wasmSolver.js";
const before = fs.readFileSync(path, "utf8");
let source = before;

const oldBlock = `    const optionsJson = JSON.stringify({
      maxPremoveSets: options.maxPremoveSets ?? 120,
      forceRzp: options.forceRzp ?? false,
      enableMultiInsertion: options.enableMultiInsertion === true,
      enableHtrSkeletons: options.enableHtrSkeletons === true,
      enableSliceInsertion: options.enableSliceInsertion === true,
      enableMultiSwitchNiss: options.enableMultiSwitchNiss === true,
      enableDeepMultiSwitchNiss: options.enableDeepMultiSwitchNiss === true,
      deepComponentMask: Number.isFinite(options.deepComponentMask)
        ? Math.max(0, Math.min(15, Math.floor(options.deepComponentMask)))
        : 15,
      searchLevel: Number.isFinite(options.searchLevel) ? Math.max(0, Math.min(3, Math.floor(options.searchLevel))) : 0,
      searchVariant: Number.isFinite(options.searchVariant) ? Math.max(0, Math.floor(options.searchVariant)) : 0,
      incumbentMoveCount: Number.isFinite(options.incumbentMoveCount)
        ? Math.max(1, Math.min(40, Math.floor(options.incumbentMoveCount)))
        : 40,
    });
    const raw = api.solveFmcWasm(scramble, optionsJson);
    if (!raw) return null;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || parsed.ok === undefined) return null;
    if (parsed.ok !== true) return parsed;
`;

const newBlock = `    const explicitSearchLevel = Number.isFinite(options.searchLevel);
    const normalizedOptions = {
      maxPremoveSets: options.maxPremoveSets ?? 120,
      forceRzp: options.forceRzp ?? false,
      enableMultiInsertion: options.enableMultiInsertion === true,
      enableHtrSkeletons: options.enableHtrSkeletons === true,
      enableSliceInsertion: options.enableSliceInsertion === true,
      enableMultiSwitchNiss: options.enableMultiSwitchNiss === true,
      enableDeepMultiSwitchNiss: options.enableDeepMultiSwitchNiss === true,
      deepComponentMask: Number.isFinite(options.deepComponentMask)
        ? Math.max(0, Math.min(15, Math.floor(options.deepComponentMask)))
        : 15,
      searchLevel: explicitSearchLevel ? Math.max(0, Math.min(3, Math.floor(options.searchLevel))) : 0,
      searchVariant: Number.isFinite(options.searchVariant) ? Math.max(0, Math.floor(options.searchVariant)) : 0,
      incumbentMoveCount: Number.isFinite(options.incumbentMoveCount)
        ? Math.max(1, Math.min(40, Math.floor(options.incumbentMoveCount)))
        : 40,
    };
    const invokeFmc = (requestOptions) => {
      const raw = api.solveFmcWasm(scramble, JSON.stringify(requestOptions));
      if (!raw) return null;
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    };

    let parsed = invokeFmc(normalizedOptions);
    if (!parsed || parsed.ok === undefined) return null;
    let levelEscalationUsed = false;
    let initialReason = null;
    // Unspecified raw callers use a very cheap L0 probe first. If that probe has
    // no frontier, run one bounded L3 portfolio with the same premove budget.
    // Explicit site quality stages retain their requested level unchanged.
    if (parsed.ok !== true && !explicitSearchLevel) {
      initialReason = String(parsed.reason || "FMC_NO_SOLUTION");
      const escalated = invokeFmc({
        ...normalizedOptions,
        maxPremoveSets: Math.max(20, Number(normalizedOptions.maxPremoveSets) || 0),
        searchLevel: 3,
      });
      if (escalated && escalated.ok !== undefined) {
        parsed = escalated;
        levelEscalationUsed = true;
      }
    }
    if (parsed.ok !== true) {
      return {
        ...parsed,
        levelEscalationUsed,
        initialReason,
      };
    }
`;

if (!source.includes("const explicitSearchLevel = Number.isFinite(options.searchLevel);")) {
  if (!source.includes(oldBlock)) throw new Error("Missing solveFmcWasm options block");
  source = source.replace(oldBlock, newBlock);
}

const noVerifiedBlock = `    if (validCandidates.length === 0) {
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
`;
const escalatedNoVerifiedBlock = `    if (validCandidates.length === 0) {
      if (!explicitSearchLevel) {
        const escalated = await solveFmcWasm(scramble, {
          ...options,
          maxPremoveSets: Math.max(20, Number(normalizedOptions.maxPremoveSets) || 0),
          searchLevel: 3,
        });
        if (escalated?.ok === true) {
          return {
            ...escalated,
            levelEscalationUsed: true,
            initialReason: "FMC_NO_VERIFIED_SOLUTION",
            initialInvalidCandidateCount: invalidCandidateCount,
          };
        }
      }
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
      };
    }
`;
if (!source.includes("initialInvalidCandidateCount: invalidCandidateCount")) {
  if (!source.includes(noVerifiedBlock)) throw new Error("Missing no-verified-candidate block");
  source = source.replace(noVerifiedBlock, escalatedNoVerifiedBlock);
}

const returnAnchor = `      repairedPremoveNissCandidateCount,
    };`;
const returnReplacement = `      repairedPremoveNissCandidateCount,
      levelEscalationUsed,
      initialReason,
    };`;
if (!source.includes("levelEscalationUsed,\n      initialReason,")) {
  const last = source.lastIndexOf(returnAnchor, source.indexOf("export async function optimizeInsertionWasm"));
  if (last < 0) throw new Error("Missing verified FMC return anchor");
  source = source.slice(0, last) + returnReplacement + source.slice(last + returnAnchor.length);
}

if (!source.includes("const explicitSearchLevel = Number.isFinite(options.searchLevel);")) {
  throw new Error("Bounded FMC level escalation was not applied");
}
if (!source.includes("initialInvalidCandidateCount: invalidCandidateCount")) {
  throw new Error("Unverified FMC frontier escalation was not applied");
}

if (source !== before) fs.writeFileSync(path, source);
console.log(source === before ? "Bounded FMC level escalation already applied" : "Applied bounded FMC level escalation");
