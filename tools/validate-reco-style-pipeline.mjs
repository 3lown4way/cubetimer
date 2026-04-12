#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  MIXED_ACTIVATION_THRESHOLD,
  estimateMixedActivationScore,
  normalizeCaseBiasRecord,
  normalizeMixedCfopSummaryRecord,
  resolvePlayerRecommendedF2LMethod,
} from "../solver/mixed-cfop-activation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const STRICT_BENCH = path.join(ROOT_DIR, "vendor-data", "reco", "reco-3x3-style-benchmark-strict.json");
const ZB_BENCH = path.join(ROOT_DIR, "vendor-data", "reco", "reco-3x3-style-benchmark-zb.json");
const MERGED_BENCH = path.join(ROOT_DIR, "vendor-data", "reco", "reco-3x3-style-benchmark.json");
const LEARNED = path.join(ROOT_DIR, "vendor-data", "reco", "reco-3x3-learned-style-weights.json");
const MIXED = path.join(ROOT_DIR, "vendor-data", "reco", "reco-3x3-mixed-cfop-profile.json");
const MAIN_JS = path.join(ROOT_DIR, "main.js");

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Input not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getPlayers(payload) {
  if (Array.isArray(payload?.playerMixedCfopProfiles)) return payload.playerMixedCfopProfiles;
  if (Array.isArray(payload?.players)) return payload.players;
  return [];
}

function buildMixedDecisionRows(mixedPayload) {
  return getPlayers(mixedPayload)
    .map((player) => {
      const mixedProfile =
        player?.mixedCfopStyleProfile ||
        player?.mixedStyleProfile ||
        player?.learnedStyleProfile ||
        player?.recommendedStyleProfile ||
        null;
      const mixedSummary = normalizeMixedCfopSummaryRecord(
        player?.mixedCfopSummary || player?.mixedCfopStats || player?.summary,
      );
      const caseBias = normalizeCaseBiasRecord(player?.caseBias);
      const activationScore = estimateMixedActivationScore(player, mixedProfile, mixedSummary, caseBias);
      const mixedEligible = activationScore >= MIXED_ACTIVATION_THRESHOLD;
      const recommendation = resolvePlayerRecommendedF2LMethod({
        ...player,
        mixedEligible,
        mixedCfopStyleProfile: mixedProfile,
        mixedCfopSummary: mixedSummary,
        caseBias,
      });
      return {
        solver: String(player?.solver || "").trim(),
        activationScore,
        mixedEligible,
        recommendation,
      };
    })
    .filter((row) => row.solver)
    .sort((a, b) => b.activationScore - a.activationScore || a.solver.localeCompare(b.solver));
}

function main() {
  const strict = loadJson(STRICT_BENCH);
  const zb = loadJson(ZB_BENCH);
  const merged = loadJson(MERGED_BENCH);
  const learned = loadJson(LEARNED);
  const mixed = loadJson(MIXED);
  const mainSource = fs.readFileSync(MAIN_JS, "utf8");

  assert(Number(strict.sampleCount) === 5629, `strict sampleCount expected 5629, got ${strict.sampleCount}`);
  assert(Number(zb.sampleCount) === 5629, `zb sampleCount expected 5629, got ${zb.sampleCount}`);
  assert(Array.isArray(strict.summariesByMode?.strict) && strict.summariesByMode.strict.length === 4, "strict summaries length expected 4");
  assert(Array.isArray(zb.summariesByMode?.zb) && zb.summariesByMode.zb.length === 4, "zb summaries length expected 4");
  assert(Array.isArray(merged.runsByMode?.strict) || typeof merged.runsByMode?.strict === "object", "merged strict mode missing");
  assert(Array.isArray(learned.players) && learned.players.length === 15, `learned players expected 15, got ${learned.players?.length || 0}`);
  assert(Array.isArray(mixed.playerMixedCfopProfiles) && mixed.playerMixedCfopProfiles.length === 15, `mixed players expected 15, got ${mixed.playerMixedCfopProfiles?.length || 0}`);
  assert(Number(mixed.mixedActivationThreshold) === MIXED_ACTIVATION_THRESHOLD, "mixed activation threshold mismatch");
  assert(mainSource.includes('const VALID_SOLVER_MODES = new Set(["strict", "zb", "roux", "fmc", "optimal"]);'), "main.js solver modes missing roux");
  assert(mainSource.includes("STYLE_PROFILE_LEARNED_DATA_URL"), "main.js learned profile URL missing");
  assert(mainSource.includes("STYLE_PROFILE_MIXED_DATA_URL"), "main.js mixed profile URL missing");

  const rows = buildMixedDecisionRows(mixed);
  const selected = rows.filter((row) => row.recommendation === "mixed");
  const selectedNames = new Set(selected.map((row) => row.solver));
  const expectedSelected = new Set([
    "Bill Wang",
    "Feliks Zemdegs",
    "Kyle Santucci",
    "Leo Borromeo",
    "Matty Hiroto Inaba",
    "Max Park",
    "Seung Hyuk Nahm",
    "Tymon Kolasiński",
    "Xuanyi Geng",
    "Yiheng Wang",
  ]);
  const unexpectedSelected = ["Dylan Miller", "Jayden McNeill", "Luke Garrett", "Ruihang Xu", "Sei Sugama"];
  assert(selectedNames.size === expectedSelected.size, `mixed selected count expected ${expectedSelected.size}, got ${selectedNames.size}`);
  for (const name of expectedSelected) {
    assert(selectedNames.has(name), `expected mixed selection missing: ${name}`);
  }
  for (const name of unexpectedSelected) {
    assert(!selectedNames.has(name), `unexpected mixed selection: ${name}`);
  }

  for (const row of selected) {
    assert(row.activationScore >= MIXED_ACTIVATION_THRESHOLD, `${row.solver} selected below threshold`);
  }

  console.log(`Validation ok: strict=${strict.sampleCount}, zb=${zb.sampleCount}, mixedSelected=${selectedNames.size}/${rows.length}`);
}

try {
  main();
} catch (error) {
  console.error(error?.message || error);
  process.exit(1);
}
