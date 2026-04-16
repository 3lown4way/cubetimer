# Solver Performance Plan: CFOP Latency + FMC Objectives

## Goal

- Reduce CFOP wall-clock latency while keeping the effective search volume the same.
- Do not shrink the main search budget knobs just to make the solver look faster.
- Preserve stage structure, solve policy, and style-aware ranking behavior unless a change is explicitly marked as optional.

## Working Assumption

CFOP is not slow only because it explores many candidates. It is also slow because each explored candidate is relatively expensive.

Current hot-path cost comes from a mix of:

- per-candidate state-key generation and `Map` churn
- repeated mismatch/scoring work in F2L ranking
- allocation-heavy candidate materialization in the beam
- string-heavy cache keys and move-text normalization
- occasional fallback into `KPattern` or transformation-based paths
- first-solve warmup cost for case libraries

This means we can keep roughly the same number of searched candidates and still make the solver materially faster by lowering the cost per candidate.

## Non-Goals

- Do not lower `f2lFormulaBeamWidth`, `f2lFormulaExpansionLimit`, `f2lFormulaMaxAttempts`, `f2lSearchMaxDepth`, or `f2lNodeLimit` as the primary optimization.
- Do not remove retries just to improve benchmark numbers.
- Do not weaken F2L style ranking, LL prediction, or downstream scoring by default.
- Do not replace CFOP with a different method or a hidden external fallback.

## Main Bottlenecks To Target

### 1. F2L beam search constant-factor cost

Hot path references:

- [solver/cfop3x3.js](/home/jhkang/cubetimer/solver/cfop3x3.js:4639)
- [solver/cfop3x3.js](/home/jhkang/cubetimer/solver/cfop3x3.js:4691)
- [solver/cfop3x3.js](/home/jhkang/cubetimer/solver/cfop3x3.js:4822)
- [solver/cfop3x3.js](/home/jhkang/cubetimer/solver/cfop3x3.js:4844)
- [solver/cfop3x3.js](/home/jhkang/cubetimer/solver/cfop3x3.js:4985)

Why it matters:

- F2L is where most of the CFOP runtime is spent.
- The implementation already uses compact transforms, but the hot path still performs expensive bookkeeping and allocates heavily for surviving candidates.

### 2. F2L case-library startup and representation overhead

Reference:

- [solver/cfop3x3.js](/home/jhkang/cubetimer/solver/cfop3x3.js:3098)

Why it matters:

- The library build is already cached, but it is still a large one-time cost and the in-memory representation is not yet optimized purely for beam-scan throughput.

### 3. Single-stage library warmup and lookup overhead

References:

- [solver/cfop3x3.js](/home/jhkang/cubetimer/solver/cfop3x3.js:3007)
- [solver/cfop3x3.js](/home/jhkang/cubetimer/solver/cfop3x3.js:4235)

Why it matters:

- OLL, PLL, ZBLS, and ZBLL are much cheaper than F2L, but they still contribute startup latency and cache-warmup variance.

### 4. Worker-level cold-start and orchestration overhead

Reference:

- [solver/solverWorker.js](/home/jhkang/cubetimer/solver/solverWorker.js:1)

Why it matters:

- Part of the observed latency gap is not search itself, but when and how data is prepared before the hot loop begins.

## Proposed Work

### Phase 0. Instrumentation Before Optimization

Add high-signal timing and counters before changing behavior.

- Record per-stage wall time, especially `Cross`, `F2L`, `OLL`, `PLL`, `ZBLS`, and `ZBLL`.
- Record F2L `attemptsRef.count`, beam-depth progression, candidate scan count, and final node count.
- Record cache hit rates for `metricsCache`, style penalty cache, transition cache, and downstream cache.
- Record how often the solver falls back to non-compact paths.
- Record first-solve vs warm-solve latency separately.

Success criterion:

- We can prove after each optimization that search volume stayed effectively unchanged and only per-candidate cost went down.

### Phase 1. Make F2L Hot Path Fully Numeric

Target files:

- [solver/cfop3x3.js](/home/jhkang/cubetimer/solver/cfop3x3.js)

Changes:

- Replace string-heavy F2L cache keys in the hot path with packed numeric keys where possible.
- Replace `${currentStateKey}::${nextStateKey}` transition-cache keys with a numeric composite key or a two-level numeric map.
- Avoid `String(nextStateKey)` in downstream cache when the key is already numeric.
- Introduce a dedicated hot-path key builder for F2L beam nodes instead of reusing more general stage-key logic when the general form is not needed.

Expected impact:

- Less string allocation.
- Better `Map` locality.
- Lower GC pressure.

### Phase 2. Precompute More Of The Ranking Cost

Target files:

- [solver/cfop3x3.js](/home/jhkang/cubetimer/solver/cfop3x3.js)

Changes:

- Precompute per-formula style metadata in the F2L case library.
- Store move count, rotation count, AUF count, and wide-turn count per entry so `stylePenaltyForMoves()` does not have to derive them repeatedly.
- Cache direct style penalty on the entry for common style presets.
- Precompute any ranking fields that depend only on the entry and not on the current node.

Expected impact:

- Same candidate ordering.
- Less work done for every candidate that survives matching.

### Phase 3. Remove Allocation Pressure Inside F2L Beam Expansion

Target files:

- [solver/cfop3x3.js](/home/jhkang/cubetimer/solver/cfop3x3.js)

Changes:

- Stop copying four typed arrays for every provisional candidate inside `considerCore()`.
- Keep compact state in reusable buffers or pooled slabs and only materialize copied state for final beam survivors.
- Reuse ranking objects or store ranking fields in flat arrays instead of allocating a fresh object per candidate.
- Reuse candidate containers between beam layers.

Expected impact:

- Same search tree.
- Fewer short-lived objects.
- Lower GC pauses and lower per-layer overhead.

### Phase 4. Eliminate Remaining Slow F2L Escape Paths From The Common Case

Target files:

- [solver/cfop3x3.js](/home/jhkang/cubetimer/solver/cfop3x3.js)

Changes:

- Guarantee that all F2L library entries needed in normal operation have `compactTransform`.
- Keep `tryApplyTransformation()` and lazy `KPattern` reconstruction as a true last resort instead of a realistic hot-path possibility.
- Audit candidate generation so `startPattern.applyAlg(node.moves.join(' '))` never runs on healthy compact-library flows.

Expected impact:

- Same search volume.
- Smaller constant factor for each attempted formula.

### Phase 5. Improve F2L Matching Data Layout

Target files:

- [solver/cfop3x3.js](/home/jhkang/cubetimer/solver/cfop3x3.js)

Changes:

- Repack `entries` in `getF2LCaseLibrary()` for scan efficiency.
- Group anchor-bucket entries in cache-friendly order.
- Store corner and edge match data in flat typed arrays instead of nested JS arrays where practical.
- Replace variable-length per-entry loops with compact fixed-layout matching for the common entry shapes.

Expected impact:

- Same entries scanned.
- Lower per-entry matching cost in the scan loop.

### Phase 6. Warm Libraries Earlier And More Predictably

Target files:

- [solver/cfop3x3.js](/home/jhkang/cubetimer/solver/cfop3x3.js)
- [solver/solverWorker.js](/home/jhkang/cubetimer/solver/solverWorker.js)

Changes:

- Warm F2L, OLL, PLL, ZBLS, and ZBLL libraries when the worker initializes or immediately after the first context load.
- Separate cold-start cost from solve cost in benchmarks.
- Consider building a versioned serialized artifact for heavy formula libraries if startup remains a large slice of latency.

Expected impact:

- Lower p95 latency for the first solve.
- Less benchmark variance.

### Phase 7. Parallelize Independent Preparation Work

Target files:

- [solver/solverWorker.js](/home/jhkang/cubetimer/solver/solverWorker.js)

Changes:

- Overlap case-library warmup with other initialization tasks.
- If color-neutral probing remains enabled, isolate the probe work from the main solve path and parallelize only the truly independent setup parts.
- Keep the solve semantics identical; only overlap independent preparation.

Expected impact:

- Same search behavior.
- Less idle wall-clock time.

## Optional Work

These changes should be gated because they preserve search volume but can alter result ordering or engineering complexity.

- Add a native or WASM fast path for F2L state transforms and ranking primitives.
- Store F2L library artifacts in a binary format instead of reconstructing JS objects at runtime.
- Add a dedicated worker for library preparation and handoff.

## Verification Plan

### Correctness

- Use a fixed scramble set and compare `ok`, stage sequence, final solution validity, and failure reasons before and after optimization.
- Require the same solve mode behavior for `strict` and `zb`.
- Verify that stage labels and metadata are unchanged.

### Search-Volume Parity

- Compare F2L `attemptsRef.count`, compact IDA node count, stage bound, and retry count before and after.
- Treat any large drop in explored candidates as a plan violation unless it is explicitly approved.
- Add a benchmark mode that prints both latency and search counters together.

### Performance

- Measure cold-start and warm-start separately.
- Report p50, p95, and max latency for strict CFOP.
- Compare Roux and CFOP again after each phase to confirm the gap is closing without shrinking CFOP search budgets.

## Implementation Order

1. Add instrumentation and baseline reports.
2. Make hot-path keys numeric.
3. Remove allocation-heavy candidate materialization.
4. Expand compact-only coverage in F2L.
5. Repack F2L library layout.
6. Move library warmup earlier.
7. Re-benchmark and confirm search-volume parity.

## Definition Of Done

- CFOP is measurably faster on the same benchmark set.
- F2L search counters remain materially unchanged.
- No regression in stage correctness or mode semantics.
- The latency improvement comes from lower per-candidate cost, not from silently searching less.

## FMC Extension: Fast Low-Move FMC Without Kociemba

### FMC Goals

- FMC mode must not rely on Kociemba-style full-cube fallback paths.
- Reverse-engineering and reimplementing the core FMC ideas used by Kociemba is allowed.
- The shipped FMC solver must still run on our own implementation and must not call Kociemba directly at runtime.
- NISS, premoves, insertions, and inverse-side reasoning remain valid search techniques, but they are separate from the reverse-engineering allowance above.
- The exact inverse scramble must still remain invalid as the final submitted answer, matching the current FMC rule check in [solver/fmcSolver.js](/home/jhkang/cubetimer/solver/fmcSolver.js:946).
- FMC should reduce wall-clock latency.
- FMC should reduce final move count.

### FMC Ranking Objective

FMC should optimize candidates in this order:

1. Valid non-reverse solution.
2. Lower move count.
3. Lower wall-clock time within the same move-count band.
4. Simpler and more insertion-friendly structure as a tiebreaker.

### FMC Current Blockers

#### 1. Generic Kociemba-style fallback is still present

References:

- [solver/fmcSolver.js](/home/jhkang/cubetimer/solver/fmcSolver.js:457)
- [solver/fmcSolver.js](/home/jhkang/cubetimer/solver/fmcSolver.js:517)
- [solver/solverWorker.js](/home/jhkang/cubetimer/solver/solverWorker.js:493)
- [solver/solverWorker.js](/home/jhkang/cubetimer/solver/solverWorker.js:537)

Why it matters:

- `solveFmcEO()` still falls back to `FMC_PHASE1_PHASE2`.
- `solverWorker` still has an `FMC Safety Phase` path that returns a phase-solver result if FMC fails.
- This makes FMC faster to return something, but it violates the intended method boundary and weakens FMC-specific optimization incentives.

#### 2. Kociemba-inspired FMC core reimplementation is not yet treated as a first-class target

References:

- [solver/fmcSolver.js](/home/jhkang/cubetimer/solver/fmcSolver.js:214)
- [solver/fmcSolver.js](/home/jhkang/cubetimer/solver/fmcSolver.js:222)
- [solver/fmcSolver.js](/home/jhkang/cubetimer/solver/fmcSolver.js:609)
- [solver/fmcSolver.js](/home/jhkang/cubetimer/solver/fmcSolver.js:946)

Why it matters:

- The code already supports inverse handling, reverse-scramble rejection, and EO/DR/P2-style building blocks.
- But the plan should explicitly allow us to study and reconstruct Kociemba-style FMC logic in native code instead of framing the allowance as “reverse scramble is okay.”
- Direct, inverse, NISS, premove sweep, and insertion passes still do too much duplicated work relative to the quality of candidates they produce.

#### 3. FMC spends time finding valid candidates that are not move-count competitive enough

Reference:

- [solver/fmcSolver.js](/home/jhkang/cubetimer/solver/fmcSolver.js:552)

Why it matters:

- Current budgeting is mostly stage- and attempt-oriented.
- We need a stronger move-count-first search portfolio so time is spent where it most improves FMC quality.

## FMC Proposed Work

### FMC Phase 0. Instrumentation And Baseline

- Record latency for direct, NISS, premove sweep, scout, and insertion passes separately.
- Record candidate counts before verification and after reverse-aware filtering.
- Record move-count distribution, not just best move count.
- Record how often FMC currently succeeds only because of `FMC_PHASE1_PHASE2` or `FMC Safety Phase`.

Success criterion:

- We can distinguish “fast because of generic fallback” from “fast because the FMC-native search improved.”

### FMC Phase 1. Remove Generic Kociemba-Style Full-Cube Fallback

Target files:

- [solver/fmcSolver.js](/home/jhkang/cubetimer/solver/fmcSolver.js)
- [solver/solverWorker.js](/home/jhkang/cubetimer/solver/solverWorker.js)

Changes:

- Remove the `FMC_PHASE1_PHASE2` fallback path from `solveFmcEO()`.
- Remove or gate off the worker-level `FMC Safety Phase` result path for `mode: "fmc"`.
- Keep explicit failure reasons so FMC misses are visible instead of being silently converted into a phase-solver answer.

Expected impact:

- FMC semantics become method-pure.
- Any later speed or move-count gain will come from the FMC portfolio itself.

### FMC Phase 2. Reimplement Kociemba-Inspired FMC Core Without Runtime Dependency

Target files:

- [solver/fmcSolver.js](/home/jhkang/cubetimer/solver/fmcSolver.js)

Changes:

- Treat reverse-engineering of Kociemba's FMC strategy as allowed design input.
- Reconstruct the useful core ideas in native code using our own EO-axis, DR/domino, phase-2, skeleton, and insertion pipeline.
- Keep `invertAlg()` and NISS-style composition as search tools where they help, but do not treat them as the main point of the allowance.
- Continue rejecting the exact inverse scramble as a final answer.

Expected impact:

- Better candidate quality for the same time budget.
- More FMC-native short solutions without a generic fallback.
- A clear path to “Kociemba-inspired but not Kociemba-dependent” FMC behavior.

### FMC Phase 3. Spend Time On Move-Count-Productive Search

Target files:

- [solver/fmcSolver.js](/home/jhkang/cubetimer/solver/fmcSolver.js)

Changes:

- Rebalance budgets around likely move-count improvement, not just stage coverage.
- Give more time to EO-axis diversity when it improves move-count outcomes.
- Give more time to NISS and reflected continuations when they improve move-count outcomes.
- Give more time to premove sets that create insertion-friendly skeletons.
- Give more time to short replacement windows and insertion opportunities with strong cancellation potential.
- Stop spending equal effort on search branches that are fast but rarely beat the current best length.

Expected impact:

- Better average and p50 move count.
- Lower wasted time on low-value branches.

### FMC Phase 4. Reuse More Search State Across Passes

Target files:

- [solver/fmcSolver.js](/home/jhkang/cubetimer/solver/fmcSolver.js)

Changes:

- Reuse verified pattern states, state keys, and insertion frontiers across direct/NISS/premove passes.
- Avoid rebuilding equivalent frontiers when only the view or premove prefix changes slightly.
- Cache small replacement-window and insertion results for repeated skeleton fragments.

Expected impact:

- Faster FMC without shrinking the search portfolio.
- Lower verification overhead.

### FMC Phase 5. Upgrade Skeleton Improvement And Insertion Quality

Target files:

- [solver/fmcSolver.js](/home/jhkang/cubetimer/solver/fmcSolver.js)

Changes:

- Strengthen the current replacement-window pass so it searches more useful insertion patterns first.
- Add better ordering for insertion windows based on cancellation potential and local state structure.
- Prefer transformations that improve both raw length and insertion headroom, not only immediate simplification.

Expected impact:

- Shorter final solutions.
- Better use of the same insertion budget.

### FMC Phase 6. Parallelize Independent FMC Portfolio Pieces

Target files:

- [solver/fmcSolver.js](/home/jhkang/cubetimer/solver/fmcSolver.js)
- [solver/solverWorker.js](/home/jhkang/cubetimer/solver/solverWorker.js)

Changes:

- Run independent FMC candidate generators in parallel when they do not depend on each other.
- Keep candidate verification and dedupe centralized so result semantics remain stable.
- Prefer parallel scout passes over serially exhausting weak branches.

Expected impact:

- Better wall-clock latency while preserving FMC-native breadth.

## FMC Verification Plan

### Correctness

- Verify every returned FMC solution actually solves the scramble.
- Verify that exact inverse-scramble answers are still rejected.
- Verify that reverse-side, NISS, and insertion-generated candidates remain legal and properly normalized.

### Method Purity

- No successful FMC result should report `FMC_PHASE1_PHASE2`.
- No successful FMC result should report `INTERNAL_3X3_PHASE_FMC_SAFETY`.
- The implementation may be Kociemba-inspired or reverse-engineered, but runtime must remain native to this codebase.
- Inversion and NISS may be used internally, but the final answer must remain FMC-valid.

### Performance

- Report cold-start and warm-start latency separately.
- Report p50, p95, and max FMC latency.
- Compare direct-only, direct+NISS, and full-portfolio timings.

### Move Count

- Report best, median, and p90 move count on a fixed scramble set.
- Track how often the best candidate comes from direct, inverse, NISS, premove, or insertion refinement.
- Treat “faster but longer” as a regression unless it is explicitly accepted for a specific profile.

## FMC Definition Of Done

- FMC returns no Kociemba-style fallback result.
- Kociemba-inspired FMC logic may be reimplemented, but the shipped solver remains dependency-free at runtime.
- NISS and inverse-side reasoning remain available as tools, not as a replacement for the native FMC core.
- FMC latency is improved on the benchmark set.
- FMC move count is improved or at least not regressed on the same benchmark set.
- The solver is faster because the FMC-native portfolio got better, not because it quietly stopped searching meaningful candidate families.
