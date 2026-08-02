export const FMC_EXTREME_PROFILE = Object.freeze({
  id: "independent-frontier-v3-anytime-widening",
  targetMoveCount: 20,
  defaultTimeBudgetMs: 0,
  maxPremoveSets: 180,
  extremeVariantCount: 24,
  extremeReservedCompressionPremoves: 24,
  continueBelowTarget: false,
  verifyLimit: 32,
  enableInsertions: true,
  insertionCandidateLimit: 6,
  insertionMaxPasses: 5,
  insertionTimeMs: 20000,
  insertionThreshold: 30,
});

export function buildFmcExtremeOptions(overrides = {}) {
  return {
    qualityMode: "extreme",
    targetMoveCount: FMC_EXTREME_PROFILE.targetMoveCount,
    timeBudgetMs: FMC_EXTREME_PROFILE.defaultTimeBudgetMs,
    maxPremoveSets: FMC_EXTREME_PROFILE.maxPremoveSets,
    extremeVariantCount: FMC_EXTREME_PROFILE.extremeVariantCount,
    extremeReservedCompressionPremoves: FMC_EXTREME_PROFILE.extremeReservedCompressionPremoves,
    continueBelowTarget: FMC_EXTREME_PROFILE.continueBelowTarget,
    verifyLimit: FMC_EXTREME_PROFILE.verifyLimit,
    enableInsertions: FMC_EXTREME_PROFILE.enableInsertions,
    insertionCandidateLimit: FMC_EXTREME_PROFILE.insertionCandidateLimit,
    insertionMaxPasses: FMC_EXTREME_PROFILE.insertionMaxPasses,
    insertionTimeMs: FMC_EXTREME_PROFILE.insertionTimeMs,
    insertionThreshold: FMC_EXTREME_PROFILE.insertionThreshold,
    allowCfopFallback: false,
    premoveAllowCfopFallback: false,
    enableCoverageFallback: false,
    preferNonCfop: true,
    requireTargetReached: true,
    ...overrides,
  };
}
