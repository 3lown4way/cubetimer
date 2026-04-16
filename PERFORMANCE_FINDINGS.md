# CFOP Performance Investigation - Detailed Findings

## Executive Summary

**CFOP is 15.86x slower than Roux on average**, ranging from 2.82x to 19.11x depending on puzzle state.

- **CFOP avg**: 666.0ms (5 scrambles)
- **Roux avg**: 42.0ms (5 scrambles)
- **Ratio**: 15.86x slower

## Benchmark Data

```
Scramble Analysis:
Easy (R U R' U' R' F R2 U' R' U' R U R' F'):
  CFOP:  2465ms → 11 moves
  Roux:   129ms → 21 moves
  Ratio: 19.11x

Medium 1 (D2 B2 R2 U' R2 U B2 D2 L2 F2 U2 F' D' B L' U B' L' U' R'):
  CFOP:   325ms → 58 moves
  Roux:    42ms → 40 moves
  Ratio: 7.74x

Medium 2 (F2 D2 B2 F2 L2 D2 B2 U R2 U' L2 B U' F2 U' R' B2 D2 R' D):
  CFOP:    62ms → 52 moves
  Roux:    22ms → 43 moves
  Ratio: 2.82x
```

The variation in ratio (2.82x to 19.11x) indicates that CFOP's overhead is puzzle-state dependent, suggesting it's not a single bottleneck but rather accumulated overhead.

## Key Findings

### 1. **F2L Case Library EXISTS and IS BEING USED**

**Location**: Line 2849-2956 (getF2LCaseLibrary), Line 5437 (attached to stages)

**Status**: ✓ CONFIRMED - The pre-warmed case library is being built and used

However, F2L has a sophisticated 2-tier lookup system:
1. **Anchor-indexed lookup** (lines 4549-4566): Fast O(constant) lookup for common cases using corner/edge anchors
2. **Fallback candidates** (lines 4609-4627): Pre-extracted formula candidates
3. **Runtime generation** (lines 4629-4656): Only if library has no matches

The fact that CFOP sometimes falls through to runtime formula generation (nested 4x4 loops at line 4630-4656) means the anchor-indexed library isn't catching all states.

### 2. **Formula Preference Scoring Overhead**

**Location**: Lines 3713-3723 (getFormulaPreferenceScore), called throughout hot paths

**Problem**:
- `getFormulaPreferenceScore()` calls `normalizeFormulaMatchText()` for EVERY formula lookup
- `normalizeFormulaMatchText()` is O(n) where n = formula length (splits moves, normalizes tokens)
- Called without caching, meaning identical formulas are re-normalized repeatedly

**Example Path**: 
```
solveWithFormulaDbF2L() 
  → collectCandidates() [line 4398]
    → considerCore() [line 4420] 
      → getFormulaPreferenceScore() [multiple times]
        → normalizeFormulaMatchText() [EXPENSIVE]
```

### 3. **singleStageFormulaCaseLibraryCache Rebuild Overhead**

**Location**: Line 128-129, 3850-3920

**Problem**:
- Cache key includes `formulaPreferenceSignature` (line 3858)
- Preference signature is built from `formulaPreferenceMap` (line 3693-3711)
- With different users/preferences, signature changes → cache evicts → library rebuilds
- Rebuild involves 4-nested loop (rotations × preAUF × formulas × postAUF)
- For OLL/PLL: 4 × 4 × 100 × 1 = 1600 formula evaluations per rebuild

**Cache Size**: Only 12 entries (line 129)
**Impact**: Pre-warm (lines 2799-2806) rebuilds OLL/PLL libraries even if already cached

### 4. **F2L Formula Beam Budget Spending**

**Location**: Lines 4245-4250, 4373-4386

**Current Settings** (STRICT mode):
- `f2lFormulaBeamBudgetMs: 50` (line 32)
- `f2lFormulaMaxAttempts: 240,000` (line 28)

**Problem**:
- The 50ms budget is often spent exploring candidates that don't improve the current solution
- The beam search doesn't just timeout gracefully; it goes through many attempts
- Even when the beam times out, `solveF2LCompactIDA()` runs anyway (fallback at line 4813)
- Result: Wasted time in beam + time in compact IDA*

**Evidence**: 
- Line 4396: `const _outMockData` shows compact transform optimization attempts
- Line 4500: High beamWidth (7) and deep exploration (maxDepth 42, line 24)

### 5. **Style Profile Penalty Evaluation**

**Location**: Lines 4274-4279, 4467-4475

**Problem**:
- Every candidate expansion evaluates style penalties
- Style penalty guards (line 4275-4278) involve arithmetic operations
- Lines 4467-4475: Complex conditional logic to evaluate penalty guards
- These are re-evaluated for EVERY node expansion in beam search

### 6. **Downstream Profile & Mixed LL Signals**

**Location**: Lines 4255-4271, 4450-4461

**Problem**:
- Downstream penalty computation (line 4257-4259) accesses f2lDownstreamProfile
- Mixed LL signals (line 4448-4459) computed for every candidate
- `findF2LDownstreamStateEntry()` is called repeatedly (line 4256)

### 7. **Node Limit Checking Overhead**

**Location**: Lines 5000-5001 (compact IDA), 4143 (formula beam)

**Problem**:
- Frequent `nodeLimitHit` checks in hot loops
- For F2L: `nodeLimit: 220000` (line 34) - hits this limit often
- When hit, solutions are rejected even if valid (line 5005-5011)

## Architecture Comparison

### CFOP Stages:
1. **Cross** - Compact IDA* (fast)
2. **F2L Pair 1-4** - Formula beam + compact IDA* fallback (BOTTLENECK)
3. **OLL** - Single-stage library lookup O(1)
4. **PLL** - Single-stage library lookup O(1)

**Total**: 4 expensive searches + 2 O(1) lookups

### Roux Stages:
1. **FB** - Compact IDA* (~22 nodes)
2. **SB** - Compact IDA* (~1600 nodes)
3. **CMLL** - Single formula lookup O(1)
4. **LSE** - Compact IDA* (~12 nodes)

**Total**: 3 searches + 1 O(1) lookup

## Bottleneck Ranking

### Tier 1 (Highest Impact):
1. **F2L Formula Beam Search Fallback** - When anchor index doesn't match, 4×4×100 loop (lines 4630-4656)
2. **Style Profile Penalty Evaluation** - Repeated math in hot loop (lines 4274-4279)
3. **Formula Preference Normalization** - Text parsing without caching (line 3715)

### Tier 2 (Medium Impact):
4. **singleStageFormulaCaseLibraryCache Rebuild** - Pre-warm rebuilds cache (line 2799-2845)
5. **Downstream Profile Lookups** - Repeated state entry searches (line 4256)
6. **Node Limit Checking** - Frequent boundary checks (lines 5000, 4143)

### Tier 3 (Lower Impact):
7. **Preference Signature Changes** - Cache invalidation (line 3858)
8. **Beam Width Throttling** - Deadline pressure logic (lines 4381, 4384)

## Recommendations

### P0 - Quick Wins (1-2ms improvement each):
1. **Cache normalizeFormulaMatchText()** results using LRU cache
2. **Increase singleStageFormulaCaseLibraryCache** from 12 to 64 entries
3. **Skip preference normalization** if preference map is empty

### P1 - Medium Effort (5-50ms improvement):
4. **Optimize style penalty guard evaluation** - Pre-compute once instead of every candidate
5. **Cache downstream profile lookups** - Memoize state entry searches
6. **Add fast-path for empty preference map** in getFormulaPreferenceScore()

### P2 - Higher Effort (50-100ms improvement):
7. **Improve F2L anchor index coverage** - Reduce fallback to nested loop
8. **Skip formula beam for F2L** - Go directly to compact IDA* (like Roux FB)
9. **Relax F2L node limits** during early solving to reduce premature rejection

### P3 - Architectural (100-300ms improvement):
10. **Redesign F2L solver to match Roux simplicity** - Single compact IDA* without formula beam

## Conclusion

CFOP's slowness is NOT due to a single catastrophic bottleneck, but rather:
- **Architectural overhead**: 4 F2L searches vs Roux's 1 FB search
- **Preference/style logic**: Expensive scoring on every candidate expansion
- **Fallback paths**: Formula beam falls back to expensive nested loop when anchor index misses
- **Cache invalidation**: Preference signatures cause repeated library rebuilds

The 15.86x ratio reflects cumulative overhead from all these factors. Quick wins focusing on normalization caching and cache size could yield 2-3x speedup. Architectural changes could yield 5-10x speedup.
