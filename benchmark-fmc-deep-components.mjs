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
  if (!marker) {
    throw new Error(
      `FMC_DEEP_COMPONENT_PROCESS_FAILED:${id}:${child.status}:${child.signal || ""}\n${output}`,
    );
  }
  const row = JSON.parse(marker.slice("FMC_DEEP_COMPONENT_RESULT=".length));
  rows.push(row);
  console.log(JSON.stringify(row));
}

if (rows.some((row) => row.ok !== true || row.moveCount <= 0)) {
  throw new Error("FMC_DEEP_COMPONENT_INVALID_RESULT");
}
console.log("FMC_DEEP_COMPONENTS=" + JSON.stringify(rows));
