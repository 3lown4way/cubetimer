const INSTALL_MARKER = Symbol.for("cubetimer.benchmark.twophaseReliabilityInstalled");
const COMLINK_APPLY = "APPLY";
const COMLINK_RAW = "RAW";
const COMLINK_HANDLER = "HANDLER";
const TRIVIAL_INVERSE_REASON = "TWOPHASE_TRIVIAL_INVERSE_REJECTED";

function rawWireValue(value) {
  return { type: COMLINK_RAW, value };
}

function getSolvePayload(message) {
  if (!message || message.type !== COMLINK_APPLY) return null;
  if (!Array.isArray(message.path) || message.path[message.path.length - 1] !== "solve") return null;
  const firstArgument = Array.isArray(message.argumentList) ? message.argumentList[0] : null;
  return firstArgument?.type === COMLINK_RAW && firstArgument.value && typeof firstArgument.value === "object"
    ? firstArgument.value
    : null;
}

export function isTwophaseV2BenchmarkRequest(message) {
  const payload = getSolvePayload(message);
  return !!(
    payload
    && payload.benchmarkNoFallback === true
    && String(payload.mode || "").toLowerCase() === "twophase"
    && String(payload.solverVersion || "").toLowerCase() === "v2"
  );
}

export function createExpandedFrontierRetryMessage(message) {
  const payload = getSolvePayload(message);
  if (!payload) return null;

  const argumentList = (message.argumentList || []).map((argument, index) => {
    if (index === 0) {
      return rawWireValue({
        ...payload,
        solverVersion: "v1",
        requestedSolverVersion: "v2",
        twophaseBenchmarkProfile: "v2-expanded-frontier-retry",
      });
    }
    // The first solve already transferred Comlink callback ports. They cannot
    // be transferred again, and progress is optional for the retry.
    return argument?.type === COMLINK_HANDLER ? rawWireValue(null) : argument;
  });

  return { ...message, argumentList };
}

export function isTrivialInverseFailureResponse(data) {
  const result = data?.type === COMLINK_RAW ? data.value : null;
  return result?.ok === false && String(result?.reason || "") === TRIVIAL_INVERSE_REASON;
}

function installTwophaseBenchmarkReliability() {
  if (typeof globalThis.Worker !== "function" || globalThis[INSTALL_MARKER]) return;

  const NativeWorker = globalThis.Worker;

  class BenchmarkReliabilityWorker extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.twophaseRetryRequests = new Map();
      // Registered before Comlink attaches its response listener, so a rejected
      // first response can be suppressed while the same request id is retried.
      this.addEventListener("message", (event) => {
        const id = event?.data?.id;
        if (!id) return;
        const pending = this.twophaseRetryRequests.get(id);
        if (!pending) return;

        if (!pending.retried && isTrivialInverseFailureResponse(event.data)) {
          event.stopImmediatePropagation();
          pending.retried = true;
          NativeWorker.prototype.postMessage.call(this, pending.retryMessage);
          return;
        }

        this.twophaseRetryRequests.delete(id);
      });
    }

    postMessage(message, transferOrOptions) {
      if (message?.id && isTwophaseV2BenchmarkRequest(message)) {
        const retryMessage = createExpandedFrontierRetryMessage(message);
        if (retryMessage) {
          this.twophaseRetryRequests.set(message.id, {
            retryMessage,
            retried: false,
          });
        }
      }
      return super.postMessage(message, transferOrOptions);
    }

    terminate() {
      this.twophaseRetryRequests.clear();
      return super.terminate();
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
