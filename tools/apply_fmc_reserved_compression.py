from pathlib import Path

path = Path("solver/fmcSolver.js")
text = path.read_text()

helper_marker = "function buildRoundRobinCandidateOrder("
if helper_marker not in text:
    anchor = '''function pushRankedUniqueCandidate(list, candidate, limit = Infinity) {
  if (!candidate) return;
  const existingIndex = list.findIndex((entry) => entry.solution === candidate.solution);
  if (existingIndex >= 0) {
    if (compareFmcCandidatePriority(candidate, list[existingIndex]) < 0) {
      list[existingIndex] = candidate;
    }
  } else {
    list.push(candidate);
  }
  list.sort(compareFmcCandidatePriority);
  if (Number.isFinite(limit) && limit > 0 && list.length > limit) {
    list.length = limit;
  }
}
'''
    helper = anchor + '''
function buildRoundRobinCandidateOrder(candidateBuckets, fallbackCandidates) {
  const buckets = Array.isArray(candidateBuckets)
    ? candidateBuckets.map((bucket) =>
        Array.isArray(bucket) ? bucket.slice().sort(compareFmcCandidatePriority) : [],
      )
    : [];
  const ordered = [];
  const seen = new Set();
  let depth = 0;
  while (buckets.some((bucket) => depth < bucket.length)) {
    for (const bucket of buckets) {
      const candidate = bucket[depth];
      if (!candidate || seen.has(candidate.solution)) continue;
      seen.add(candidate.solution);
      ordered.push(candidate);
    }
    depth += 1;
  }
  const fallback = Array.isArray(fallbackCandidates)
    ? fallbackCandidates.slice().sort(compareFmcCandidatePriority)
    : [];
  for (const candidate of fallback) {
    if (!candidate || seen.has(candidate.solution)) continue;
    seen.add(candidate.solution);
    ordered.push(candidate);
  }
  return ordered;
}
'''
    if anchor not in text:
        raise SystemExit("pushRankedUniqueCandidate anchor not found")
    text = text.replace(anchor, helper, 1)

old_extreme = '''  if (qualityMode === "extreme") {
    const requestedVariants = Number.isFinite(options.extremeVariantCount)
      ? Math.max(4, Math.min(24, Math.floor(options.extremeVariantCount)))
      : 12;
    const stages = [];
    for (let variant = 0; variant < requestedVariants; variant += 1) {
      // Extreme starts above the baseline-equivalent L0 profile.
      const searchLevel = variant < 2 ? 1 : variant < 7 ? 2 : 3;
      const premoveCap =
        searchLevel === 1 ? 90 : searchLevel === 2 ? 140 : requestedPremoveSets;
      stages.push(
        stage(`human-L${searchLevel}-V${variant}`, {
          maxPremoveSets: capPremoves(premoveCap),
          searchLevel,
          searchVariant: variant,
          rawExplorationLimit: searchLevel === 1 ? 28 : searchLevel === 2 ? 31 : 34,
          enableMultiSwitchNiss: true,
          enableDeepMultiSwitchNiss: searchLevel >= 2,
          enableHtrSkeletons: searchLevel >= 2,
          enableSliceInsertion: searchLevel >= 2,
          enableMultiInsertion: searchLevel >= 3,
        }),
      );
    }
    return stages;
  }
'''
new_extreme = '''  if (qualityMode === "extreme") {
    const requestedVariants = Number.isFinite(options.extremeVariantCount)
      ? Math.max(4, Math.min(24, Math.floor(options.extremeVariantCount)))
      : 12;
    const reservedCompressionVariant = requestedVariants > 7 ? 7 : requestedVariants - 1;
    const reservedCompressionPremoves = Number.isFinite(options.extremeReservedCompressionPremoves)
      ? Math.max(
          12,
          Math.min(requestedPremoveSets, Math.floor(options.extremeReservedCompressionPremoves)),
        )
      : Math.min(requestedPremoveSets, 48);
    const variantOrder = [0, reservedCompressionVariant];
    for (let variant = 1; variant < requestedVariants; variant += 1) {
      if (!variantOrder.includes(variant)) variantOrder.push(variant);
    }

    const stages = [];
    for (const variant of variantOrder) {
      const reservedCompression = variant === reservedCompressionVariant;
      // Reserve multi-insertion immediately after one fast L1 scout. Repeated
      // L2 searches can no longer consume the entire short Extreme budget.
      const searchLevel = reservedCompression ? 3 : variant < 2 ? 1 : variant < 7 ? 2 : 3;
      const premoveCap = reservedCompression
        ? reservedCompressionPremoves
        : searchLevel === 1
          ? 90
          : searchLevel === 2
            ? 140
            : requestedPremoveSets;
      stages.push(
        stage(`human-L${searchLevel}-V${variant}${reservedCompression ? "-reserved" : ""}`, {
          maxPremoveSets: capPremoves(premoveCap),
          searchLevel,
          searchVariant: variant,
          reservedCompression,
          rawExplorationLimit: searchLevel === 1 ? 28 : searchLevel === 2 ? 31 : 34,
          enableMultiSwitchNiss: true,
          enableDeepMultiSwitchNiss: searchLevel >= 2,
          enableHtrSkeletons: searchLevel >= 2,
          enableSliceInsertion: searchLevel >= 2,
          enableMultiInsertion: searchLevel >= 3,
        }),
      );
    }
    return stages;
  }
'''
if "reservedCompressionVariant" not in text:
    if old_extreme not in text:
        raise SystemExit("extreme stage block not found")
    text = text.replace(old_extreme, new_extreme, 1)

if "const extremeStageCandidateBuckets = new Map();" not in text:
    text = text.replace(
        "  const candidates = [];\n",
        "  const candidates = [];\n  const extremeStageCandidateBuckets = new Map();\n",
        1,
    )

if "extremeStageCandidateBuckets: []," not in text:
    text = text.replace(
        "    wasmStages: [],\n",
        "    wasmStages: [],\n    extremeStageCandidateBuckets: [],\n",
        1,
    )

old_destructure = "        const { rawExplorationLimit: _rawExplorationLimit, ...wasmQualityOptions } = qualityStage.options;"
new_destructure = '''        const {
          rawExplorationLimit: _rawExplorationLimit,
          reservedCompression: _reservedCompression,
          ...wasmQualityOptions
        } = qualityStage.options;'''
if old_destructure in text:
    text = text.replace(old_destructure, new_destructure, 1)

if "reservedCompression: qualityStage.options.reservedCompression === true," not in text:
    text = text.replace(
        "          multiInsertion: stageOptions.enableMultiInsertion === true,\n",
        "          multiInsertion: stageOptions.enableMultiInsertion === true,\n          reservedCompression: qualityStage.options.reservedCompression === true,\n",
        1,
    )

old_track = "            if (candidate) trackCandidate(candidate);"
new_track = '''            if (candidate) {
              trackCandidate(candidate);
              if (qualityMode === "extreme") {
                const stageBucket = extremeStageCandidateBuckets.get(qualityStage.name) || [];
                pushRankedUniqueCandidate(stageBucket, candidate, 12);
                extremeStageCandidateBuckets.set(qualityStage.name, stageBucket);
              }
            }'''
if old_track in text:
    text = text.replace(old_track, new_track, 1)

old_sort = '''  candidates.sort(compareFmcCandidatePriority);
  diagnostics.candidateCounts.beforeVerification = candidates.length;
'''
new_sort = '''  candidates.sort(compareFmcCandidatePriority);
  const verificationCandidates =
    qualityMode === "extreme"
      ? buildRoundRobinCandidateOrder([...extremeStageCandidateBuckets.values()], candidates)
      : candidates;
  diagnostics.extremeStageCandidateBuckets = [...extremeStageCandidateBuckets.entries()].map(
    ([name, bucket]) => ({
      name,
      candidateCount: bucket.length,
      bestMoveCount: bucket.length ? bucket[0].moveCount : null,
    }),
  );
  diagnostics.candidateCounts.beforeVerification = candidates.length;
'''
if "const verificationCandidates =" not in text:
    if old_sort not in text:
        raise SystemExit("candidate sort anchor not found")
    text = text.replace(old_sort, new_sort, 1)

text = text.replace(
    "  const verifyLimit = Math.min(candidates.length, requestedVerifyLimit);",
    "  const verifyLimit = Math.min(verificationCandidates.length, requestedVerifyLimit);",
    1,
)
text = text.replace(
    "    const candidate = candidates[i];\n    if (await verifyCandidate(null, candidate, { cache: verificationCache, scrambleString: scramble })) {",
    "    const candidate = verificationCandidates[i];\n    if (await verifyCandidate(null, candidate, { cache: verificationCache, scrambleString: scramble })) {",
    1,
)
text = text.replace(
    "  if (!validCandidates.length && verifyLimit < candidates.length) {\n    for (let i = verifyLimit; i < candidates.length; i += 1) {\n      const candidate = candidates[i];",
    "  if (!validCandidates.length && verifyLimit < verificationCandidates.length) {\n    for (let i = verifyLimit; i < verificationCandidates.length; i += 1) {\n      const candidate = verificationCandidates[i];",
    1,
)

required = [
    "reservedCompressionVariant",
    "buildRoundRobinCandidateOrder",
    "extremeStageCandidateBuckets",
    "const verificationCandidates =",
]
for marker in required:
    if marker not in text:
        raise SystemExit(f"missing patched marker: {marker}")

path.write_text(text)
