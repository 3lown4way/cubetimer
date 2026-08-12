from pathlib import Path
import runpy

runpy.run_path('tools/rewrite-yau-last-eight-v2.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()
old = '''  // 3: try to close the final three in one Yau slice cycle.  If that is not
  // available, pair one more edge with a cycle and use only the standard L2E
  // algorithm for the actual final two edges.
  let last3Moves = [];
  remainingCount = bitCount(yauRemainingPairedMask444(state, crossMask));
  if (remainingCount < 8) {
    const directLast3 = advanceYauRemainingCount444(state, 8, sliceFamily, model, deadlineTs, crossMask, 9);
    if (directLast3) {
      state = directLast3.state;
      last3Moves = directLast3.moves;
    } else {
      if (remainingCount < 6 && !deadlineReached(deadlineTs)) {
        const makeTen = advanceYauRemainingCount444(state, 6, sliceFamily, model, deadlineTs, crossMask, 7);
        if (!makeTen) {
          return { ok: false, reason: "444_YAU_LAST8_LAST3_CYCLE_FAILED", solution: "", segments: [] };
        }
        state = makeTen.state;
        last3Moves.push(...makeTen.moves);
      }
      if (bitCount(yauRemainingPairedMask444(state, crossMask)) < 8) {
        const l2e = findL2E(state, model, deadlineTs, crossMask, null, crossMask);
        if (!l2e) {
          return { ok: false, reason: "444_YAU_LAST8_L2E_FAILED", solution: "", segments: [] };
        }
        state = l2e.state;
        last3Moves.push(...l2e.moves);
      }
    }
  }
'''
new = '''  // 3: true 3-2-3 finish. Pair one of the last three with one more clean
  // Yau slice cycle, leaving exactly the final two edges for a standard L2E.
  // Do not waste the solve budget searching for an artificial 5->8 jump.
  let last3Moves = [];
  remainingCount = bitCount(yauRemainingPairedMask444(state, crossMask));
  if (remainingCount < 6) {
    const makeTen = advanceYauRemainingCount444(
      state, 6, sliceFamily, model, deadlineTs, crossMask, 7,
    );
    if (!makeTen) {
      return { ok: false, reason: "444_YAU_LAST8_LAST3_CYCLE_FAILED", solution: "", segments: [] };
    }
    state = makeTen.state;
    last3Moves.push(...makeTen.moves);
  }
  if (bitCount(yauRemainingPairedMask444(state, crossMask)) < 8) {
    const l2e = findL2E(state, model, deadlineTs, crossMask, null, crossMask);
    if (!l2e) {
      return { ok: false, reason: "444_YAU_LAST8_L2E_FAILED", solution: "", segments: [] };
    }
    state = l2e.state;
    last3Moves.push(...l2e.moves);
  }
'''
if old not in s:
    raise SystemExit('last3 block not found after v2 rewrite')
s = s.replace(old, new, 1)
p.write_text(s)
print('refined Yau Last 3 to 5->6 cycle + L2E')
