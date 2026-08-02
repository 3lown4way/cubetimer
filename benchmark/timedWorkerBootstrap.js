const nativePostMessage = globalThis.postMessage.bind(globalThis);
const solveStartedAtById = new Map();

// Register before the target worker imports Comlink so solve requests are timed
// from worker receipt until immediately before the result is posted back.
globalThis.addEventListener("message", (event) => {
  const data = event?.data;
  if (
    data?.id &&
    data.type === "APPLY" &&
    Array.isArray(data.path) &&
    data.path[data.path.length - 1] === "solve"
  ) {
    solveStartedAtById.set(data.id, performance.now());
  }
});

globalThis.postMessage = function timedPostMessage(message, transferables) {
  const startedAt = message?.id ? solveStartedAtById.get(message.id) : null;
  if (Number.isFinite(startedAt)) {
    solveStartedAtById.delete(message.id);
    const benchmarkWorkerSolveMs = Math.max(0, performance.now() - startedAt);
    if (message?.type === "RAW" && message.value && typeof message.value === "object") {
      const existingDiagnostics =
        message.value.performanceDiagnostics && typeof message.value.performanceDiagnostics === "object"
          ? message.value.performanceDiagnostics
          : {};
      message = {
        ...message,
        value: {
          ...message.value,
          performanceDiagnostics: {
            ...existingDiagnostics,
            benchmarkWorkerSolveMs,
            benchmarkTimingSource: "worker_before_postMessage",
          },
        },
      };
    }
  }
  nativePostMessage(message, transferables);
};

const kind = new URL(globalThis.location.href).searchParams.get("kind");
const target = kind === "fmc"
  ? "./fmcBenchmarkWorker.js"
  : kind === "generic"
    ? "../solver/solverWorker.js"
    : "";

if (!target) {
  throw new Error(`UNKNOWN_BENCHMARK_WORKER_KIND:${kind || "missing"}`);
}

await import(target);
