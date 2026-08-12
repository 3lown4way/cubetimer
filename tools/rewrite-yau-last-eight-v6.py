from pathlib import Path
import runpy

runpy.run_path('tools/rewrite-yau-last-eight-v5.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()
old = '''  if (remainingCount < 6) {
    const makeTen = advanceYauRemainingCount444(
      state, 6, sliceFamily, model, deadlineTs, crossMask, 7, false,
    );
    if (!makeTen) {
      return { ok: false, reason: "444_YAU_LAST8_LAST3_CYCLE_FAILED", solution: "", segments: [] };
    }
    state = makeTen.state;
    last3Moves.push(...makeTen.moves);
  }
'''
new = '''  if (remainingCount < 6) {
    // In real 3-2-3 the last-three cycle may reuse previously paired
    // non-cross edges as buffers. Do not insist on an artificial exact 5->6
    // transition; accept any cross-safe cycle that leaves at least six of the
    // last eight paired, then hand only the genuine final two to L2E.
    const makeTen = searchYauLastEightCycle444(
      state,
      6,
      sliceFamily,
      model,
      deadlineTs,
      crossMask,
      7,
      false,
      false,
    );
    if (!makeTen) {
      return { ok: false, reason: "444_YAU_LAST8_LAST3_CYCLE_FAILED", solution: "", segments: [] };
    }
    state = makeTen.state;
    last3Moves.push(...makeTen.moves);
  }
'''
if old not in s:
    raise SystemExit('v5 Last3 exact cycle block not found')
s = s.replace(old, new, 1)
p.write_text(s)
print('Last 3 now uses one flexible cross-safe Yau cycle before L2E')
