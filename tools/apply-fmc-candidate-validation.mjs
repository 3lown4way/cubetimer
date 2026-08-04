import fs from "node:fs";

const path = "solver/wasmSolver.js";
const before = fs.readFileSync(path, "utf8");
let source = before;

if (!source.includes("invalidCandidateCount:")) {
  const oldText = `    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || parsed.ok === undefined) return null;
    return parsed;
  } catch (err) {
    console.warn("[solveFmcWasm] error:", err);`;
  const newText = `    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || parsed.ok === undefined) return null;
    if (parsed.ok !== true) return parsed;

    // The public FMC verifier is the source of truth for the exact solution
    // string returned to callers. Filter every ranked candidate at this final
    // boundary so an invalid premove/NISS flattening can never become the best
    // displayed solution or seed a downstream insertion pass.
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

    const validCandidates = [];
    for (const candidate of parsed.candidates) {
      const solution = String(candidate?.solution || "");
      if (!solution) continue;
      let verification = null;
      try {
        const verifyRaw = api.verifyFmcSolutionWasm(String(scramble), solution);
        verification = typeof verifyRaw === "string" ? JSON.parse(verifyRaw) : verifyRaw;
      } catch (_) {
        verification = null;
      }
      if (verification?.ok === true && verification.solved === true) {
        validCandidates.push(candidate);
      }
    }

    const invalidCandidateCount = parsed.candidates.length - validCandidates.length;
    if (validCandidates.length === 0) {
      return {
        ...parsed,
        ok: false,
        reason: "FMC_NO_VERIFIED_SOLUTION",
        solution: "",
        moveCount: 0,
        candidates: [],
        invalidCandidateCount,
      };
    }

    const best = validCandidates[0];
    return {
      ...parsed,
      solution: String(best.solution),
      moveCount: Number(best.moveCount || 0),
      candidates: validCandidates,
      invalidCandidateCount,
    };
  } catch (err) {
    console.warn("[solveFmcWasm] error:", err);`;

  const first = source.indexOf(oldText);
  if (first < 0) throw new Error("Missing solveFmcWasm return boundary");
  if (source.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error("Ambiguous solveFmcWasm return boundary");
  }
  source = source.slice(0, first) + newText + source.slice(first + oldText.length);
}

if (source !== before) fs.writeFileSync(path, source);
console.log(source === before ? "FMC candidate boundary validation already applied" : "Applied FMC candidate boundary validation");
