import { solve444 } from "../solver/solver444.js";

const cases = [
  ["D-short", "Rw U2 F' Lw D B2", "D"],
  ["F-regression", "Uw2 Rw F2 Dw' L B' Rw2 U Fw' D2 Lw B2", "F"],
  ["D-frame", "Rw U' F R2 F Bw' Fw' Dw Bw Dw Uw R Bw Fw2 B2 Fw2 B Uw2 Lw Bw2 R' Lw R' L Bw U2 Bw U' Fw2 D Bw' Uw'", "D"],
];

const split = (s) => String(s || "").trim().split(/\s+/).filter(Boolean);
const isRotation = (t) => /^[xyz](?:2|')?$/.test(t);
const face = (t) => (/^([URFDLB])/.exec(t)?.[1] || "");

function metrics(solution) {
  const tokens = split(solution);
  const turns = tokens.filter((t) => !isRotation(t));
  const rotations = tokens.filter(isRotation);
  const wide = turns.filter((t) => /^[URFDLB]w/.test(t));
  const back = turns.filter((t) => face(t) === "B");
  const left = turns.filter((t) => face(t) === "L");
  let faceChanges = 0;
  for (let i = 1; i < turns.length; i += 1) {
    if (face(turns[i]) && face(turns[i - 1]) && face(turns[i]) !== face(turns[i - 1])) faceChanges += 1;
  }
  return {
    tokens: tokens.length,
    turns: turns.length,
    rotations: rotations.length,
    wide: wide.length,
    back: back.length,
    left: left.length,
    faceChanges,
  };
}

for (const [label, scramble, crossColor] of cases) {
  const started = Date.now();
  const result = await solve444(scramble, null, {
    deadlineTs: Date.now() + 60_000,
    crossColor,
    method444: "yau",
    __yauProtectedCenterBudgetMs: 6000,
  });
  console.log(`\n=== ${label} cross=${crossColor} ok=${result.ok} elapsed=${Date.now() - started}ms ===`);
  if (!result.ok) {
    console.log(result.reason, result.detail || "");
    continue;
  }
  for (const stage of result.stages || []) {
    console.log(`\n[${stage.id}] ${stage.name} :: ${JSON.stringify(metrics(stage.solution))}`);
    for (const segment of stage.segments || []) {
      console.log(`  - ${segment.name} :: ${JSON.stringify(metrics(segment.solution))}`);
      console.log(`    ${segment.solution || "(none)"}`);
    }
  }
  console.log("META", JSON.stringify({
    viewpointRotationCount: result.meta?.viewpointRotationCount,
    yauViewpointRotationCount: result.meta?.yauViewpointRotationCount,
    yauCrossRestoreMoveCount: result.meta?.yauCrossRestoreMoveCount,
    yauLastEightOnly: result.meta?.yauLastEightOnly,
    edgeSearchMs: result.meta?.edgeSearchMs,
  }));
}
