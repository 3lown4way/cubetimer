const NativeWorker = globalThis.Worker;
const bootstrapUrl = new URL("./timedWorkerBootstrap.js", import.meta.url);

function classifyBenchmarkWorker(url) {
  try {
    const resolved = new URL(String(url), globalThis.location.href);
    if (resolved.pathname.endsWith("/solver/solverWorker.js")) return "generic";
    if (resolved.pathname.endsWith("/benchmark/fmcBenchmarkWorker.js")) return "fmc";
  } catch (_) {}
  return "";
}

function BenchmarkWorker(url, options) {
  const kind = classifyBenchmarkWorker(url);
  if (!kind) return new NativeWorker(url, options);
  const timedUrl = new URL(bootstrapUrl);
  timedUrl.searchParams.set("kind", kind);
  return new NativeWorker(timedUrl, options);
}

BenchmarkWorker.prototype = NativeWorker.prototype;
Object.setPrototypeOf(BenchmarkWorker, NativeWorker);
Object.defineProperty(BenchmarkWorker, "name", { value: "Worker" });

globalThis.Worker = BenchmarkWorker;
