import { spawnSync } from "node:child_process";

const cases = [
  ["stage-boundary", 1],
  ["complementary-mitm", 2],
  ["complementary-normal", 4],
  ["pre-eo", 8],
  ["all", 15],
];

const rows = [];
for (const [id, mask] of cases) {
  // Use a fresh process per mask so WASM initialization and deep-table warmup
  // remain explicit instead of leaking cached state from the previous case.
  const child = spawnSync(process.execPath, ["benchmark-fmc-deep-component-case.mjs"], {
    encoding: "utf8",
    timeout: 30000,
    env: {
      ...process.env,
      FMC_DEEP_CASE_ID: id,
      FMC_DEEP_COMPONENT_MASK: String(mask),
    },
  });
  const output = `${child.stdout || ""}\n${child.stderr || ""}`;
  const marker = output
    .split(/\r?\n/)
    .find((line) => line.startsWith("FMC_DEEP_COMPONENT_RESULT="));
  if (!marker || child.status !== 0) {
    throw new Error(
      `FMC_DEEP_COMPONENT_PROCESS_FAILED:${id}:${child.status}:${child.signal || ""}\n${output}`,
    );
  }
  const row = JSON.parse(marker.slice("FMC_DEEP_COMPONENT_RESULT=".length));
  rows.push(row);
  console.log(JSON.stringify(row));
}

// This matrix deliberately runs without the premove frontier, so an isolated
// component (including ALL) may produce no complete solution. The preceding
// feature and repeat benchmarks own correctness; this step only profiles cost.
if (rows.some((row) => !Number.isFinite(row.elapsedMs) || row.elapsedMs < 0)) {
  throw new Error("FMC_DEEP_COMPONENT_TIMING_INVALID");
}
if (rows.some((row) => !Number.isFinite(row.warmMs) || row.warmMs < 0)) {
  throw new Error("FMC_DEEP_COMPONENT_WARM_TIMING_INVALID");
}
console.log("FMC_DEEP_COMPONENTS=" + JSON.stringify(rows));
