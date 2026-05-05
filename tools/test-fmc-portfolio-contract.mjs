#!/usr/bin/env node
import { solveWithFMCSearch } from "../solver/fmcSolver.js";

const SCRAMBLE = "R B2 U' L2 D L2 F2 U' B2 F2 L2 F D F2 L B U' B' D' R2";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const result = await solveWithFMCSearch(SCRAMBLE);

  assert(result?.ok === true, `Expected ok=true, got ok=${result?.ok}`);
  assert(Array.isArray(result?.candidates) && result.candidates.length > 0, "Expected non-empty result.candidates");
  assert(result.candidates.some((candidate) => candidate?.rzpUsed === true), "Expected at least one candidate with rzpUsed=true");

  console.log(`Contract ok: candidates=${result.candidates.length}`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
