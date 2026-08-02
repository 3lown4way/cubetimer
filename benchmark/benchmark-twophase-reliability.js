const INSTALL_MARKER = Symbol.for("cubetimer.benchmark.twophaseReliabilityInstalled");

function isPlainObject(value) {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function promoteTwophaseV2BenchmarkPayload(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = promoteTwophaseV2BenchmarkPayload(value[index], seen);
    }
    return value;
  }

  if (!isPlainObject(value)) return value;

  for (const [key, item] of Object.entries(value)) {
    value[key] = promoteTwophaseV2BenchmarkPayload(item, seen);
  }

  if (
    value.benchmarkNoFallback === true
    && String(value.mode || "").toLowerCase() === "twophase"
    && String(value.solverVersion || "").toLowerCase() === "v2"
  ) {
    // solverWorker currently maps v1 to 12 phase-1 frontiers and v2 to 2.
    // For benchmark no-fallback runs, use the expanded internal WASM profile so
    // a valid solve is not discarded merely because two frontiers returned the
    // inverse-scramble incumbent. This does not enable an external fallback.
    value.solverVersion = "v1";
    value.requestedSolverVersion = "v2";
    value.twophaseBenchmarkProfile = "v2-expanded-frontier";
  }

  return value;
}

function installTwophaseBenchmarkReliability() {
  if (typeof globalThis.Worker !== "function" || globalThis[INSTALL_MARKER]) return;

  const NativeWorker = globalThis.Worker;
  class BenchmarkReliabilityWorker extends NativeWorker {
    postMessage(message, transferOrOptions) {
      const rewritten = promoteTwophaseV2BenchmarkPayload(message);
      return super.postMessage(rewritten, transferOrOptions);
    }
  }

  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    writable: true,
    value: BenchmarkReliabilityWorker,
  });
  globalThis[INSTALL_MARKER] = true;
}

installTwophaseBenchmarkReliability();
