import fs from "node:fs";

const path = "solver/solverWorker.js";
let source = fs.readFileSync(path, "utf8");

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  const count = source.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected one target, found ${count}`);
  }
  source = source.replace(before, after);
}

replaceOnce(
  `let solver2x2ModulesPromise = null;\nlet solver3x3PhaseModulesPromise = null;`,
  `let solver2x2ModulesPromise = null;\nlet solver444ModulePromise = null;\nlet solver3x3PhaseModulesPromise = null;`,
  "4x4 module promise",
);

replaceOnce(
  `const FMC_333_TIMEOUT_MS = 120000;`,
  `const FMC_333_TIMEOUT_MS = 120000;\nconst SOLVER_444_BOUNDARY_TIMEOUT_MS = 5000;`,
  "4x4 boundary timeout",
);

replaceOnce(
  `function getWasmSolverModule() {\n  if (!wasmSolverModulePromise) {\n    wasmSolverModulePromise = import("./wasmSolver.js");\n  }\n  return wasmSolverModulePromise;\n}`,
  `function getWasmSolverModule() {\n  if (!wasmSolverModulePromise) {\n    wasmSolverModulePromise = import("./wasmSolver.js");\n  }\n  return wasmSolverModulePromise;\n}\n\nfunction getSolver444Module() {\n  if (!solver444ModulePromise) {\n    solver444ModulePromise = import("./solver444.js");\n  }\n  return solver444ModulePromise;\n}\n\nasync function solve444Lazy(scramble, onProgress, options) {\n  const { solve444 } = await getSolver444Module();\n  return solve444(scramble, onProgress, options);\n}\n\nfunction build444WorkerFailure(reason, status = "error", meta = {}) {\n  return {\n    ok: false,\n    eventId: "444",\n    status,\n    reason: String(reason || "444_FAILED"),\n    detail: null,\n    solution: "",\n    moveCount: 0,\n    verified: false,\n    stages: [],\n    source: "WASM_444_BOUNDARY",\n    meta: meta && typeof meta === "object" ? { ...meta } : {},\n  };\n}`,
  "4x4 lazy helpers",
);

replaceOnce(
  `    let benchmarkNoFallback = false;`,
  `    let benchmarkNoFallback = false;\n    let deadlineTs = 0;`,
  "4x4 deadline variable",
);

replaceOnce(
  `      if (Number.isFinite(Number(arg1.fmcTimeBudgetMs))) {\n        fmcTimeBudgetMs = Math.max(1000, Math.floor(Number(arg1.fmcTimeBudgetMs)));\n      }\n      benchmarkNoFallback = arg1.benchmarkNoFallback === true;`,
  `      if (Number.isFinite(Number(arg1.fmcTimeBudgetMs))) {\n        fmcTimeBudgetMs = Math.max(1000, Math.floor(Number(arg1.fmcTimeBudgetMs)));\n      }\n      if (Number.isFinite(Number(arg1.deadlineTs))) {\n        deadlineTs = Math.max(0, Number(arg1.deadlineTs));\n      }\n      benchmarkNoFallback = arg1.benchmarkNoFallback === true;`,
  "4x4 request deadline",
);

replaceOnce(
  `    startBackgroundWarmups();\n    if (normalizedEventId === "333" && mode === "twophase") {`,
  `    startBackgroundWarmups();\n    if (normalizedEventId === "444") {\n      const effective444DeadlineTs = deadlineTs > 0\n        ? deadlineTs\n        : Date.now() + SOLVER_444_BOUNDARY_TIMEOUT_MS;\n      if (Date.now() >= effective444DeadlineTs) {\n        return build444WorkerFailure("444_DEADLINE_REACHED", "timeout", {\n          deadlineTs: effective444DeadlineTs,\n        });\n      }\n      const remaining444Ms = Math.max(\n        1,\n        Math.min(\n          SOLVER_444_BOUNDARY_TIMEOUT_MS,\n          Math.ceil(effective444DeadlineTs - Date.now()),\n        ),\n      );\n      return withTimeout(\n        solve444Lazy(scramble, onProgress, {\n          deadlineTs: effective444DeadlineTs,\n        }),\n        remaining444Ms,\n      ).catch(() => {\n        if (typeof onProgress === "function") {\n          try {\n            void onProgress({\n              type: "444_stage_fail",\n              eventId: "444",\n              stage: "BOUNDARY",\n              reason: "444_DEADLINE_REACHED",\n            });\n          } catch (_) {}\n        }\n        return build444WorkerFailure("444_DEADLINE_REACHED", "timeout", {\n          deadlineTs: effective444DeadlineTs,\n        });\n      });\n    }\n    if (normalizedEventId === "333" && mode === "twophase") {`,
  "4x4 worker route",
);

fs.writeFileSync(path, source);
console.log("Patched 4x4 WASM worker boundary");
