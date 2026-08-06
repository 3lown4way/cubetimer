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
  `    startBackgroundWarmups();\n    if (normalizedEventId === "444") {`,
  `    if (normalizedEventId === "444") {`,
  "route 4x4 before 3x3 warmups",
);

replaceOnce(
  `      ).catch(() => {\n        if (typeof onProgress === "function") {\n          try {\n            void onProgress({\n              type: "444_stage_fail",\n              eventId: "444",\n              stage: "BOUNDARY",\n              reason: "444_DEADLINE_REACHED",\n            });\n          } catch (_) {}\n        }\n        return build444WorkerFailure("444_DEADLINE_REACHED", "timeout", {\n          deadlineTs: effective444DeadlineTs,\n        });\n      });`,
  `      ).catch((error) => {\n        const errorMessage = String(error?.message || error || "444_WORKER_FAILED");\n        const timedOut =\n          Date.now() >= effective444DeadlineTs || /^TIMEOUT_\\d+MS$/.test(errorMessage);\n        const reason = timedOut ? "444_DEADLINE_REACHED" : "444_WORKER_FAILED";\n        const status = timedOut ? "timeout" : "error";\n        if (typeof onProgress === "function") {\n          try {\n            void onProgress({\n              type: "444_stage_fail",\n              eventId: "444",\n              stage: "BOUNDARY",\n              reason,\n            });\n          } catch (_) {}\n        }\n        return build444WorkerFailure(reason, status, {\n          deadlineTs: effective444DeadlineTs,\n          ...(timedOut ? {} : { workerError: errorMessage }),\n        });\n      });`,
  "separate timeout from unexpected worker failure",
);

replaceOnce(
  `      });\n    }\n    if (normalizedEventId === "333" && mode === "twophase") {`,
  `      });\n    }\n    startBackgroundWarmups();\n    if (normalizedEventId === "333" && mode === "twophase") {`,
  "preserve existing warmups for non-4x4 events",
);

fs.writeFileSync(path, source);
console.log("Hardened 4x4 worker routing");
