# Pure Roux Solver - Progress Report

## Status: 60% Success Rate (3/5 simple scrambles)

### What Works
✅ **FB (First Block)**: IDA* search with Manhattan distance heuristic - works well
✅ **SB (Second Block)**: Beam search with scoring function - works for simple cases  
✅ **CMLL**: Known algorithm lookup + IDA* fallback
✅ **LSE**: Known algorithm lookup + IDA* fallback
✅ **Stage Extraction**: Correctly splits solution into FB→SB→CMLL→LSE
✅ **Move Simplification**: Cancels redundant moves

### What's Failing
❌ **Complex SB cases**: 2/5 scrambles timeout during SB beam search
   - Scrambles: `U R2 U' R2 U R2 U' R2`, `R U2 R' U' R U' R' U`
   - Issue: Beam search explores 1.3M+ nodes but can't find solution within depth 16
   - These scrambles require longer SB solutions (>14 moves)

### Root Cause Analysis
The SB beam search uses a scoring function that rewards:
- FB corner/edge preservation (15 points each)
- SB corner/edge placement (15 points each)

However, for complex scrambles:
1. The search space is too large (500K+ states for 1x2x3 block)
2. FB-preserving constraint limits available moves
3. Beam width (8K-15K) is insufficient for deep searches
4. Max depth (14-16) may not be enough for some cases

### Current Implementation
```javascript
// FB: IDA* (depth 12, all moves)
// SB: Beam search (depth 14-16, beam 8K-15K, all moves, scoring-based)
// CMLL: Known algs + IDA* (depth 8)
// LSE: Known algs + IDA* (depth 10)
```

### Next Steps to Improve
1. **Increase beam width** for SB (20K-30K)
2. **Add SB-specific heuristic** (better than piece counting)
3. **Optimize beam search** (reduce redundant state exploration)
4. **Add SB algorithm database** (like CMLL/LSE algs)
5. **Consider phase-based approach** for SB (build incrementally)
6. **Test with more scrambles** to understand failure patterns

### Files Modified
- `/solver/roux3x3.js` - Main solver (429 lines)
- `/test-roux-simple.mjs` - Simple test (5 scrambles)
- `/test-roux-comprehensive.mjs` - Comprehensive test (10 scrambles)

### Test Results
```
Simple scrambles (3/5 passed):
✅ R U R' U' - 4 moves, 8ms
✅ R2 U R2 U' R2 - 5 moves, 3059ms  
✅ F2 U F2 U' F2 - 5 moves, 4043ms
❌ U R2 U' R2 U R2 U' R2 - TIMEOUT (31.5s)
❌ R U2 R' U' R U' R' U - TIMEOUT (31.7s)
```

### Architecture
```
Pure Roux Solver (NO external libraries):
├─ FB: IDA* search
│  ├─ Heuristic: Manhattan distance (misplaced pieces / 3)
│  ├─ Max depth: 12
│  └─ All 18 moves
│
├─ SB: Beam search with scoring
│  ├─ Score: FB preservation (75 pts) + SB progress (75 pts)
│  ├─ Max depth: 14-16 (3 attempts)
│  ├─ Beam width: 8K-15K
│  └─ All 18 moves
│
├─ CMLL: Known algs (8) + IDA*
│  ├─ Moves: U, R, L (9 moves)
│  └─ Max depth: 8
│
└─ LSE: Known algs (7) + IDA*
   ├─ Moves: M, U (6 moves)
   └─ Max depth: 10
```

### Dependencies
- ✅ NO Kociemba
- ✅ NO cubing.js solvers
- ✅ NO pattern databases
- ✅ NO external libraries
- ✅ Only uses: beam search, IDA*, heuristics
