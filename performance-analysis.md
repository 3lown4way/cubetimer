# CFOP Solver Performance Analysis

## Benchmark Results

```
CFOP (strict mode):
  2623ms OK (11 moves)
   335ms OK (58 moves)
    62ms OK (52 moves)
    58ms OK (52 moves)
   252ms OK (53 moves)
  Avg: 666.0ms

Roux (strict mode):
   116ms OK (21 moves)
    41ms OK (40 moves)
    23ms OK (43 moves)
    10ms OK (39 moves)
    20ms OK (43 moves)
  Avg: 42.0ms

CFOP/Roux ratio: 15.86x slower
```

## Key Performance Bottlenecks Identified

### 1. **singleStageFormulaCaseLibraryCache Rebuild Issue**

**Location**: Line 128-129, 3850-3920

**Problem**: The cache is rebuilt for every puzzle solve when different preference signatures are used:
- Cache key includes `formulaPreferenceSignature` (line 3851-3858)
- Signature is built from `formulaPreferenceMap` (line 3693-3711)
- The preference signature changes based on user solving history/preferences
- Cache limit is only 12 entries (line 129)
- When cache fills, oldest is evicted FIFO (line 3916-3919)

**Cost**: 
- Building the single-stage library involves 4 nested loops (rotations × preAuf × formulas × postAuf)
- For OLL/PLL cases: 4 rotations × 4 AUF × ~100 formulas × 1 postAuf = ~1600 iterations per solve
- Each iteration involves: `invertAlg()`, `tryApplyAlg()`, `splitMoves()`, `normalizeFormulaMatchText()`
- This happens even during pre-warm (lines 2799-2806, 2838-2845) AND during solve (line 3957)

**Evidence**: The cache is small (12 entries) and includes the preference signature in the key, so with different users or preferences, it constantly evicts and rebuilds.

### 2. **F2L Beam Search Formula Overhead** 

**Location**: Lines 4630-4650 (hot loop)

**Problem**: 
- Formula beam search iterates through formulas in a deeply nested loop
- No pre-warm case library for F2L (unlike OLL/PLL), so beam always falls back to runtime formula generation
- The fallback path (lines 4628-4656) iterates: rotations(4) × AUF(4) × formulas(~50-100) = 1600-3200 formula evaluations per pair
- Each formula evaluation includes `buildFormulaCandidate()`, `splitMoves()`, `tryApplyMoves()`
- F2L searches 4 pairs with `beamWidth: 7` → high expansion factor

**Formula Attempt Limits** (line 4373):
- `f2lFormulaMaxAttempts: 240000` (strict mode, line 28)
- Means up to 240K formula candidate evaluations per puzzle solve
- CFOP processes multiple F2L pairs sequentially; Roux processes FB once

### 3. **beamBudgetMs Tuning**

**Location**: Lines 4245-4250

**Current settings**:
- Default fallback: 250ms (line 4247)
- STRICT mode: `f2lFormulaBeamBudgetMs: 50` (line 32)
- FAST mode: `f2lFormulaBeamBudgetMs: 30` (line 45)

**Problem**: 
- 50ms is still substantial for beam search that often exhausts `maxAttempts` before timeout
- Beam search explores solutions exhaustively up to depth limit, then times out
- The timeout causes fallback to compact IDA* (which is faster, lines 4812-4813)
- Wasting time in beam search before falling back is inefficient

### 4. **F2L Case Library Pre-Warming Gap**

**Location**: Lines 2849-2850 (F2L vs OLL/PLL pre-warm at 2799-2845)

**Problem**:
- OLL and PLL have pre-warmed single-stage case libraries (lines 2799-2806)
- ZBLS and ZBLL have pre-warmed case libraries (lines 2838-2845)
- **F2L has NO pre-warming** (line 2849 just returns the promise)
- This means F2L always uses formula beam search fallback path (lines 4628-4656)
- Result: 4 × (runtime formula evaluation) vs Roux's single FB lookup

### 5. **normalizeFormulaMatchText Called Repeatedly**

**Location**: Line 694-699 (function definition), called at lines 1863, 1890, 1891, 3715, 3779, 3802, 3882

**Problem**:
- `normalizeFormulaMatchText()` parses formula text for every preference score lookup
- Calls `splitMoves()` → `normalizeMoveToken()` on every call
- Gets called in hot paths without caching:
  - Line 3715: Inside `getFormulaPreferenceScore()` called per formula evaluation
  - Line 3882: During library building for every candidate formula

**Cost**: Formula text parsing is O(n) where n = formula length

### 6. **DeadlineTs Pressure & Beam Width Throttling**

**Location**: Lines 4376-4385

**Problem**:
- When deadline pressure exists, beam width is reduced (lines 4381, 4384)
- However, F2L search happens BEFORE deadline would typically hit (first of 4 stages)
- Strictness of `nodeLimitHit` checks (line 5000-5001) may reject solutions prematurely

## Architecture Differences: CFOP vs Roux

### CFOP Pipeline:
1. **Cross** (compact IDA*, fast)
2. **F2L Pair 1-4** (formula beam → compact IDA* fallback) ← **Hot path**
3. **OLL** (formula lookup from pre-warmed library, O(1))
4. **PLL** (formula lookup from pre-warmed library, O(1))

### Roux Pipeline:
1. **FB** (compact IDA*, ~22 nodes average)
2. **SB** (compact IDA*, ~1600 nodes average)
3. **CMLL** (formula lookup, O(1))
4. **LSE** (compact IDA*, ~12 nodes average)

**Key Difference**: Roux has ONE formula lookup (CMLL), CFOP has FOUR F2L formula beams + OLL + PLL lookups.

## Root Cause Summary

CFOP is slow because:
1. **F2L has no case library pre-warming** → falls back to expensive formula beam search
2. **Formula beam search iterates ~3200 formulas per pair** with expensive text parsing
3. **Cache invalidation** due to preference signature changes → rebuilds OLL/PLL libraries
4. **Beam budget (50ms)** is spent exploring and timing out, then compact IDA* runs anyway
5. **4 F2L pairs** multiply the overhead compared to Roux's single FB step

## Recommended Optimizations (Priority Order)

### P1: Pre-warm F2L Case Library (10x+ potential speedup)
- Build F2L library during solver initialization like OLL/PLL/ZBLS/ZBLL
- Cache it globally, not per-solve
- Library includes all rotation/AUF combinations
- Reduces F2L lookup from 3200 formula evaluations to O(1) map lookup

### P2: Reduce Beam Search Budget or Disable F2L Beam Entirely (3-5x)
- Current: 50ms budget spent on beam, then fallback to compact IDA*
- Better: Skip formula beam for F2L, go straight to compact IDA*
- OLL/PLL already have O(1) libraries, so only F2L needs change

### P3: Cache normalizeFormulaMatchText Results (1.5-2x)
- Add LRU cache of formula → normalized formula
- Avoid re-parsing same formula text in preference lookups

### P4: Increase singleStageFormulaCaseLibraryCache Size (1.2x)
- Current: 12 entries
- Increase to 32-64 entries
- Reduces cache eviction/rebuild cycles

### P5: Remove Preference Signature from Cache Key (1.1x)
- Preference map changes per-solve; signature bloats cache key
- Store preferences separately from library lookup
