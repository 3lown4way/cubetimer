#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_DOWNSTREAM_INPUT = path.join(ROOT_DIR, "vendor-data", "reco", "reco-3x3-f2l-ll-prediction.json");
const DEFAULT_MIXED_INPUT = path.join(ROOT_DIR, "vendor-data", "reco", "reco-3x3-top10-mixed-cfop-profile.json");
const DEFAULT_OUTPUT = path.join(ROOT_DIR, "vendor-data", "reco", "reco-3x3-ll-family-calibration.json");
const SCHEMA_VERSION = "reco-ll-family-calibration.v1";

const STAGE3_TEMPERATURES = [1.0, 1.15, 1.3, 1.45, 1.6, 1.8];
const STAGE4_TEMPERATURES = [0.95, 1.1, 1.25, 1.4, 1.55, 1.7];
const CAP_SCALES = [0.55, 0.7, 0.85, 1.0, 1.15];

function clampRate01(value, fallback = null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function hashStringToUnitInterval(text) {
  const source = String(text || "");
  if (!source) return 0.5;
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const unsigned = hash >>> 0;
  return unsigned / 4294967295;
}

function normalizeLlCaseFamilyLabel(label) {
  const text = String(label || "").trim().toUpperCase();
  if (!text) return "OTHER";
  if (text.includes("NOT ZBLL")) return "OLL";
  if (text.includes("4TH PAIR/ZBLS") || text.includes("ZBLS")) return "ZBLS";
  if (text.includes("EO+ZBLL") || text.includes("ZBLL")) return "ZBLL";
  if (text.includes("EPLL") || text.includes("PLL")) return "PLL";
  if (text.includes("OLL")) return "OLL";
  if (text.includes("F2L")) return "F2L";
  return "OTHER";
}

function deriveCaseBiasFromMixedSummary(summary) {
  const xcrossRate = clampRate01(summary?.firstStageXCrossRate ?? summary?.xcrossRate, null);
  const xxcrossRate = clampRate01(summary?.firstStageXXCrossRate ?? summary?.xxcrossRate, null);
  const zbllRate = clampRate01(summary?.zbllRate, null);
  const zblsRate = clampRate01(summary?.zblsRate, null);

  if (xcrossRate === null && xxcrossRate === null && zbllRate === null && zblsRate === null) {
    return {
      xcrossWeight: 5,
      xxcrossWeight: 2,
      zbllWeight: 3,
      zblsWeight: 2,
    };
  }

  return {
    xcrossWeight: xcrossRate >= 0.4 ? 6 : xcrossRate >= 0.28 ? 5 : xcrossRate >= 0.16 ? 4 : 2,
    xxcrossWeight: xxcrossRate >= 0.08 ? 3 : xxcrossRate >= 0.03 ? 2 : 1,
    zbllWeight: zbllRate >= 0.16 ? 4 : zbllRate >= 0.08 ? 3 : 2,
    zblsWeight: zblsRate >= 0.06 ? 2 : 1,
  };
}

function normalizeCaseBiasRecord(caseBias) {
  if (!caseBias || typeof caseBias !== "object") return null;
  const xcrossWeight = Number(caseBias.xcrossWeight);
  const xxcrossWeight = Number(caseBias.xxcrossWeight);
  const zbllWeight = Number(caseBias.zbllWeight);
  const zblsWeight = Number(caseBias.zblsWeight);
  if (
    !Number.isFinite(xcrossWeight) ||
    !Number.isFinite(xxcrossWeight) ||
    !Number.isFinite(zbllWeight) ||
    !Number.isFinite(zblsWeight)
  ) {
    return null;
  }
  return {
    xcrossWeight: Math.max(1, Math.min(12, Math.round(xcrossWeight))),
    xxcrossWeight: Math.max(1, Math.min(12, Math.round(xxcrossWeight))),
    zbllWeight: Math.max(1, Math.min(12, Math.round(zbllWeight))),
    zblsWeight: Math.max(1, Math.min(12, Math.round(zblsWeight))),
  };
}

function applyCaseBiasToStyleProfile(baseProfile, caseBias, mixedSummary = null, crossSamplingCalibration = null) {
  const base = baseProfile && typeof baseProfile === "object" ? baseProfile : null;
  if (!base) return null;
  const bias = normalizeCaseBiasRecord(caseBias);
  if (!bias) return { ...base };
  const historicalZbllRate = clampRate01(mixedSummary?.zbllRate, null);
  const historicalZblsRate = clampRate01(mixedSummary?.zblsRate, null);
  const historicalXCrossRate = clampRate01(mixedSummary?.xcrossRate, null);
  const historicalXXCrossRate = clampRate01(mixedSummary?.xxcrossRate, null);
  const zbllRateCap =
    historicalZbllRate === null ? null : Math.max(0.03, Math.min(0.5, Number((historicalZbllRate * 1.35).toFixed(6))));
  const zblsRateCap =
    historicalZblsRate === null ? null : Math.max(0.02, Math.min(0.45, Number((historicalZblsRate * 1.4).toFixed(6))));
  const xcrossRateOffset = Number(crossSamplingCalibration?.xcrossRateOffset);
  const xxcrossRateOffset = Number(crossSamplingCalibration?.xxcrossRateOffset);
  const adjustRotation = Math.round((bias.xcrossWeight - 1) * 0.25 + (bias.xxcrossWeight - 1) * 0.35);
  const adjustAuf = Math.round((bias.zbllWeight - 1) * 0.25 + (bias.zblsWeight - 1) * 0.15);
  const adjustWide = Math.round((bias.xcrossWeight - 1) * 0.2 + (bias.xxcrossWeight - 1) * 0.1);
  return {
    preset: base.preset || "mixed",
    rotationWeight: Math.max(0, Math.min(12, Math.round(base.rotationWeight + adjustRotation))),
    aufWeight: Math.max(0, Math.min(12, Math.round(base.aufWeight + adjustAuf))),
    wideTurnWeight: Math.max(0, Math.min(12, Math.round(base.wideTurnWeight + adjustWide))),
    caseBiasPreset: "case-bias",
    caseBias: bias,
    xcrossWeight: bias.xcrossWeight,
    xxcrossWeight: bias.xxcrossWeight,
    zbllWeight: bias.zbllWeight,
    zblsWeight: bias.zblsWeight,
    historicalXCrossRate,
    historicalXXCrossRate,
    historicalZbllRate,
    historicalZblsRate,
    zbllRateCap,
    zblsRateCap,
    xcrossRateOffset: Number.isFinite(xcrossRateOffset) ? xcrossRateOffset : 0,
    xxcrossRateOffset: Number.isFinite(xxcrossRateOffset) ? xxcrossRateOffset : 0,
  };
}

function parseArgv(argv) {
  const out = {
    downstream: DEFAULT_DOWNSTREAM_INPUT,
    mixed: DEFAULT_MIXED_INPUT,
    output: DEFAULT_OUTPUT,
    holdout: 0.2,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--downstream" && i + 1 < argv.length) {
      out.downstream = argv[++i];
      continue;
    }
    if (arg === "--mixed" && i + 1 < argv.length) {
      out.mixed = argv[++i];
      continue;
    }
    if (arg === "--output" && i + 1 < argv.length) {
      out.output = argv[++i];
      continue;
    }
    if (arg === "--holdout" && i + 1 < argv.length) {
      const value = Number(argv[++i]);
      if (Number.isFinite(value) && value >= 0 && value < 1) {
        out.holdout = value;
      }
      continue;
    }
  }
  return out;
}

function buildFamilyCounts(stateEntry) {
  const counts = {
    OLL: 0,
    PLL: 0,
    ZBLL: 0,
    ZBLS: 0,
    OTHER: 0,
  };
  const topCases = Array.isArray(stateEntry?.topCases) ? stateEntry.topCases : [];
  for (let i = 0; i < topCases.length; i++) {
    const entry = topCases[i];
    const label = Array.isArray(entry) ? entry[0] : entry?.label;
    const count = Number(Array.isArray(entry) ? entry[1] : entry?.count);
    if (!Number.isFinite(count) || count <= 0) continue;
    const family = normalizeLlCaseFamilyLabel(label);
    counts[family] = (counts[family] || 0) + count;
  }
  return counts;
}

function scoreStateFamilies(stateEntry, mixedCaseBias) {
  const familyCounts = buildFamilyCounts(stateEntry);
  const formulaFamilyCounts = stateEntry?.formulaFamilyCounts && typeof stateEntry.formulaFamilyCounts === "object"
    ? stateEntry.formulaFamilyCounts
    : null;
  const sampleCount = Number(stateEntry?.sampleCount) || 0;
  const deltaExpectedLlMoves = Number(stateEntry?.deltaExpectedLlMoves);
  const biasZbllRate = clampRate01(mixedCaseBias?.zbllRate) ?? 0;
  const biasZblsRate = clampRate01(mixedCaseBias?.zblsRate) ?? 0;
  const biasScale = Math.log1p(Math.max(1, sampleCount || 1));
  const scores = {
    OLL: familyCounts.OLL + familyCounts.OTHER * 0.15,
    PLL: familyCounts.PLL + familyCounts.OTHER * 0.12,
    ZBLL: familyCounts.ZBLL + biasZbllRate * biasScale * 0.18,
    ZBLS: familyCounts.ZBLS + biasZblsRate * biasScale * 0.18,
    OTHER: familyCounts.OTHER,
  };

  if (formulaFamilyCounts) {
    scores.OLL += Number(formulaFamilyCounts.OLL || 0) * 0.1;
    scores.PLL += Number(formulaFamilyCounts.PLL || 0) * 0.1;
    scores.ZBLL += Number(formulaFamilyCounts.ZBLL || 0) * 0.1;
    scores.ZBLS += Number(formulaFamilyCounts.ZBLS || 0) * 0.1;
  }

  if (Number.isFinite(deltaExpectedLlMoves) && deltaExpectedLlMoves !== 0) {
    if (deltaExpectedLlMoves < 0) {
      scores.ZBLL += Math.min(2.2, -deltaExpectedLlMoves * 1.35);
    } else {
      scores.OLL += Math.min(1.6, deltaExpectedLlMoves * 1.1);
      scores.PLL += Math.min(1.5, deltaExpectedLlMoves * 0.85);
    }
  }

  return scores;
}

function softmaxProbability(scoreA, scoreB, temperature) {
  const temp = Math.max(0.6, Math.min(3.5, Number(temperature) || 1.5));
  const weightA = Math.pow(Math.max(1e-6, Number(scoreA) || 0), 1 / temp);
  const weightB = Math.pow(Math.max(1e-6, Number(scoreB) || 0), 1 / temp);
  const denom = weightA + weightB;
  if (!Number.isFinite(denom) || denom <= 0) return 0.5;
  return weightB / denom;
}

function stageProbabilityWithCap(probability, cap) {
  const base = Math.max(0, Math.min(1, Number(probability) || 0));
  const normalizedCap = clampRate01(cap, null);
  if (normalizedCap === null) return base;
  const capBlend = normalizedCap < 0.1 ? 0.55 : normalizedCap < 0.2 ? 0.45 : 0.35;
  return Math.max(0, Math.min(1, base * (1 - capBlend) + normalizedCap * capBlend));
}

function evaluateCalibrationCandidate(states, mixedCaseBias, params) {
  let loss = 0;
  let weight = 0;
  for (let i = 0; i < states.length; i++) {
    const stateEntry = states[i];
    const scores = scoreStateFamilies(stateEntry, mixedCaseBias);
    const oll = Number(scores.OLL) || 0;
    const pll = Number(scores.PLL) || 0;
    const zbll = Number(scores.ZBLL) || 0;
    const zbls = Number(scores.ZBLS) || 0;

    const cfopStage3Total = oll + zbll;
    if (cfopStage3Total > 0) {
      const target = zbll / cfopStage3Total;
      const probability = stageProbabilityWithCap(
        softmaxProbability(oll, zbll, params.stage3Temperature),
        params.stage3ZbllCap,
      );
      loss += cfopStage3Total * (-target * Math.log(Math.max(1e-9, probability)) - (1 - target) * Math.log(Math.max(1e-9, 1 - probability)));
      weight += cfopStage3Total;
    }

    const cfopStage4Total = pll + zbll;
    if (cfopStage4Total > 0) {
      const target = zbll / cfopStage4Total;
      const probability = stageProbabilityWithCap(
        softmaxProbability(pll, zbll, params.stage4Temperature),
        params.stage4ZbllCap,
      );
      loss += cfopStage4Total * (-target * Math.log(Math.max(1e-9, probability)) - (1 - target) * Math.log(Math.max(1e-9, 1 - probability)));
      weight += cfopStage4Total;
    }

    const zbStage3Total = oll + zbls;
    if (zbStage3Total > 0) {
      const target = zbls / zbStage3Total;
      const probability = stageProbabilityWithCap(
        softmaxProbability(oll, zbls, params.stage3Temperature),
        params.stage3ZblsCap,
      );
      loss += zbStage3Total * (-target * Math.log(Math.max(1e-9, probability)) - (1 - target) * Math.log(Math.max(1e-9, 1 - probability)));
      weight += zbStage3Total;
    }
  }
  return weight > 0 ? loss / weight : Number.POSITIVE_INFINITY;
}

function chooseBestCalibration(states, mixedCaseBias) {
  let best = {
    stage3Temperature: 1.4,
    stage4Temperature: 1.25,
    zbllScale: 1,
    zblsScale: 1,
    loss: Number.POSITIVE_INFINITY,
  };

  for (let i = 0; i < STAGE3_TEMPERATURES.length; i++) {
    for (let j = 0; j < STAGE4_TEMPERATURES.length; j++) {
      for (let k = 0; k < CAP_SCALES.length; k++) {
        for (let l = 0; l < CAP_SCALES.length; l++) {
          const candidate = {
            stage3Temperature: STAGE3_TEMPERATURES[i],
            stage4Temperature: STAGE4_TEMPERATURES[j],
            zbllScale: CAP_SCALES[k],
            zblsScale: CAP_SCALES[l],
            stage3ZbllCap: clampRate01((clampRate01(mixedCaseBias?.zbllRate) ?? 0) * CAP_SCALES[k]),
            stage3ZblsCap: clampRate01((clampRate01(mixedCaseBias?.zblsRate) ?? 0) * CAP_SCALES[l]),
            stage4ZbllCap: clampRate01((clampRate01(mixedCaseBias?.zbllRate) ?? 0) * CAP_SCALES[k]),
          };
          const loss = evaluateCalibrationCandidate(states, mixedCaseBias, candidate);
          if (loss < best.loss) {
            best = {
              ...candidate,
              loss,
            };
          }
        }
      }
    }
  }

  return best;
}

function splitTrainHoldout(states, solverName, holdoutRatio) {
  const train = [];
  const holdout = [];
  for (let i = 0; i < states.length; i++) {
    const state = states[i];
    const key = String(state?.key ?? "");
    const roll = hashStringToUnitInterval(`${solverName}|${key}`);
    if (roll < holdoutRatio) {
      holdout.push(state);
    } else {
      train.push(state);
    }
  }
  return { train, holdout };
}

function pickBestCandidateWithFallback(states, mixedCaseBias, solverName, holdoutRatio) {
  const { train, holdout } = splitTrainHoldout(states, solverName, holdoutRatio);
  const trainingStates = train.length >= 8 ? train : states;
  const validationStates = holdout.length >= 4 ? holdout : states;
  const candidate = chooseBestCalibration(trainingStates, mixedCaseBias);
  const validationLoss = evaluateCalibrationCandidate(validationStates, mixedCaseBias, candidate);
  return {
    ...candidate,
    validationLoss,
    trainStateCount: trainingStates.length,
    validationStateCount: validationStates.length,
  };
}

function main() {
  const args = parseArgv(process.argv.slice(2));
  const downstream = JSON.parse(fs.readFileSync(args.downstream, "utf8"));
  const mixed = JSON.parse(fs.readFileSync(args.mixed, "utf8"));
  const downstreamPlayers = Array.isArray(downstream.playerDownstreamProfiles)
    ? downstream.playerDownstreamProfiles
    : [];
  const mixedPlayers = Array.isArray(mixed.playerMixedCfopProfiles)
    ? mixed.playerMixedCfopProfiles
    : [];
  const mixedBySolver = new Map(
    mixedPlayers
      .filter((entry) => entry && typeof entry.solver === "string")
      .map((entry) => [String(entry.solver).trim(), entry]),
  );

  const globalMixedSummary =
    mixed.globalMixedCfopSummary ||
    mixed.globalMixedCfopProfile?.mixedCfopSummary ||
    mixedPlayers[0]?.mixedCfopSummary ||
    null;

  const playerLlFamilyCalibrationProfiles = [];
  for (let i = 0; i < downstreamPlayers.length; i++) {
    const entry = downstreamPlayers[i];
    const solver = String(entry?.solver || "").trim();
    if (!solver) continue;
    const mixedEntry = mixedBySolver.get(solver) || null;
    const mixedSummaryRates =
      mixedEntry?.mixedCfopSummary ||
      mixedEntry?.mixedCfopStats ||
      mixedEntry?.summary ||
      globalMixedSummary;
    const states = Array.isArray(entry.states) ? entry.states : [];
    const best = pickBestCandidateWithFallback(states, mixedSummaryRates, solver, args.holdout);
    playerLlFamilyCalibrationProfiles.push({
      solver,
      solveCount: Number(entry.solveCount) || states.length,
      stateCount: states.length,
      trainStateCount: best.trainStateCount,
      validationStateCount: best.validationStateCount,
      stage3Temperature: Number(best.stage3Temperature.toFixed(3)),
      stage4Temperature: Number(best.stage4Temperature.toFixed(3)),
      zbllScale: Number(best.zbllScale.toFixed(3)),
      zblsScale: Number(best.zblsScale.toFixed(3)),
      stage3ZbllCap: Number(((clampRate01(mixedSummaryRates?.zbllRate) ?? 0) * best.zbllScale).toFixed(6)),
      stage3ZblsCap: Number(((clampRate01(mixedSummaryRates?.zblsRate) ?? 0) * best.zblsScale).toFixed(6)),
      stage4ZbllCap: Number(((clampRate01(mixedSummaryRates?.zbllRate) ?? 0) * best.zbllScale).toFixed(6)),
      validationLoss: Number(best.validationLoss.toFixed(8)),
      mixedSummary: {
        solveCount: Number(mixedSummaryRates?.solveCount) || 0,
        zbllRate: clampRate01(mixedSummaryRates?.zbllRate, null),
        zblsRate: clampRate01(mixedSummaryRates?.zblsRate, null),
      },
    });
  }

  const stage3Temperatures = playerLlFamilyCalibrationProfiles.map((entry) => entry.stage3Temperature).filter(Number.isFinite);
  const stage4Temperatures = playerLlFamilyCalibrationProfiles.map((entry) => entry.stage4Temperature).filter(Number.isFinite);
  const zbllScales = playerLlFamilyCalibrationProfiles.map((entry) => entry.zbllScale).filter(Number.isFinite);
  const zblsScales = playerLlFamilyCalibrationProfiles.map((entry) => entry.zblsScale).filter(Number.isFinite);
  const avg = (values) => (values.length ? values.reduce((acc, value) => acc + value, 0) / values.length : 0);

  const output = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sourceDownstreamInput: path.resolve(args.downstream),
    sourceMixedInput: path.resolve(args.mixed),
    holdoutRatio: args.holdout,
    globalLlFamilyCalibration: {
      stage3Temperature: Number(avg(stage3Temperatures).toFixed(3)) || 1.4,
      stage4Temperature: Number(avg(stage4Temperatures).toFixed(3)) || 1.25,
      zbllScale: Number(avg(zbllScales).toFixed(3)) || 1,
      zblsScale: Number(avg(zblsScales).toFixed(3)) || 1,
    },
    playerLlFamilyCalibrationProfiles,
  };

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(output, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        output: path.resolve(args.output),
        players: playerLlFamilyCalibrationProfiles.length,
        global: output.globalLlFamilyCalibration,
      },
      null,
      2,
    ),
  );
}

main();
