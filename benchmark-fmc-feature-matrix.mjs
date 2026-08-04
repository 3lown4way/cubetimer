import { spawnSync } from "node:child_process";

const base = {
  maxPremoveSets: 24,
  searchLevel: 3,
  searchVariant: 0,
  incumbentMoveCount: 40,
};

const cases = [
  ...Array.from({ length: 8 }, (_, searchVariant) => [
    `l0-pm20-v${searchVariant}`,
    {
      maxPremoveSets: 20,
      searchLevel: 0,
      searchVariant,
    },
  ]),
  ["l3-base", {}],
  ["l3-htr", { enableHtrSkeletons: true }],
  ["l3-multi-switch", { enableMultiSwitchNiss: true }],
  ["l3-deep-switch", { enableMultiSwitchNiss: true, enableDeepMultiSwitchNiss: true }],
  ["l3-insertions", { enableMultiInsertion: true, enableSliceInsertion: true }],
  ["l3-full", {
    enableHtrSkeletons: true,
    enableMultiInsertion: true,
    enableSliceInsertion: true,
    enableMultiSwitchNiss: true,
    enableDeepMultiSwitchNiss: true,
  }],
];

const rows = [];
for (const [id, extra] of cases) {
  const child = spawnSync(process.execPath, ["benchmark-fmc-feature-case.mjs"], {
    encoding: "utf8",
    timeout: 30000,
    env: {
      ...process.env,
      FMC_CASE_ID: id,
      FMC_CASE_OPTIONS: JSON.stringify({ ...base, ...extra }),
    },
  });
  const output = `${child.stdout || ""}\n${child.stderr || ""}`;
  const marker = output.split(/\r?\n/).find((line) => line.startsWith("FMC_CASE_RESULT="));
  const row = marker
    ? JSON.parse(marker.slice("FMC_CASE_RESULT=".length))
    : {
        id,
        ok: false,
        reason: child.error?.code === "ETIMEDOUT" ? "TIMEOUT" : "PROCESS_FAILED",
        status: child.status,
        signal: child.signal,
        panic: /panicked|capacity overflow|unreachable/i.test(output),
      };
  rows.push(row);
  console.log(JSON.stringify(row));
}
console.log("FMC_FEATURE_MATRIX=" + JSON.stringify(rows));