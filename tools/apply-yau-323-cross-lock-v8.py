from pathlib import Path
import re
import runpy

runpy.run_path('tools/apply-yau-323-cross-lock-v7.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()

# Let a caller widen only the difficult Last-3 protected cycle without changing standard 3-2-3.
old = '''  const protectedCenterFaces = Array.isArray(options?.protectedCenterFaces) ? options.protectedCenterFaces : [];
  const requireAllCenters = options?.requireAllCenters !== false;
  const requiredPairedEveryMoveMask = Number(options?.requiredPairedEveryMoveMask) >>> 0;
  const centersOkay = (state) => requireAllCenters
'''
new = '''  const protectedCenterFaces = Array.isArray(options?.protectedCenterFaces) ? options.protectedCenterFaces : [];
  const requireAllCenters = options?.requireAllCenters !== false;
  const requiredPairedEveryMoveMask = Number(options?.requiredPairedEveryMoveMask) >>> 0;
  const beamWidth = Math.max(SLICE_BEAM_WIDTH, Number(options?.beamWidth) || SLICE_BEAM_WIDTH);
  const centersOkay = (state) => requireAllCenters
'''
if old not in s:
    raise SystemExit('slice beam options anchor not found')
s = s.replace(old, new, 1)
s = s.replace('.slice(0, SLICE_BEAM_WIDTH);', '.slice(0, beamWidth);', 1)

# Replace the Yau 9->10 setup + L2E with a genuine Last-3 9->12 protected slice cycle.
pattern = re.compile(r'''      let finalSetup = null;\n      let beforeL2E = nextTwo;\n      let beforeL2ELockedCount = secondTarget;\n      if \(bitCount\(nextTwo\.mask\) < 10\) \{.*?\n      const beforeL2ETypeCount = bitCount\(pairedEdgeTypeMask\(beforeL2E\.state\)\);\n      const l2e = beforeL2ETypeCount === 12\n        \? \{ state: beforeL2E\.state, moves: \[\] \}\n        : findL2E\(.*?\n          \);\n      if \(!l2e\) \{\n        diagnostics\.l2eFailures \+= 1;\n        continue;\n      \}\n''', re.S)
replacement = '''      let finalSetup = null;
      let beforeL2E = nextTwo;
      let beforeL2ELockedCount = secondTarget;
      let l2e = null;
      if (yauBank) {
        const lastThree = searchSliceCycle(
          nextTwo.state,
          requiredTypeMask,
          12,
          sliceFamily,
          model,
          deadlineTs,
          10,
          requiredSolvedTypeMask,
          { requiredPairedEveryMoveMask: requiredTypeMask, beamWidth: 5200 },
        );
        if (!lastThree) {
          diagnostics.lastThreeFailures += 1;
          continue;
        }
        finalSetup = {
          ...lastThree,
          sliceFamily,
          frameRotation: sliceFamily.rotation,
          workingSlice: sliceFamily.openMoves[0][0],
        };
        beforeL2E = finalSetup;
        beforeL2ELockedCount = 12;
        l2e = { state: finalSetup.state, moves: [] };
      } else {
        if (bitCount(nextTwo.mask) < 10) {
          finalSetup = searchSliceCycleAcrossFrames(
            nextTwo.state,
            secondLockedMask,
            10,
            nextTwo.sliceFamily || sliceFamily,
            model,
            deadlineTs,
            7,
            requiredSolvedTypeMask,
          );
          if (!finalSetup) {
            diagnostics.lastThreeFailures += 1;
            continue;
          }
          const finalLockedMask = chooseProtectedTypeMask(
            finalSetup.mask,
            secondLockedMask,
            10,
          );
          if (bitCount(finalLockedMask) !== 10) {
            diagnostics.lastThreeFailures += 1;
            continue;
          }
          beforeL2ELockedCount = 10;
          beforeL2E = finalSetup;
        }
        const beforeL2ETypeCount = bitCount(pairedEdgeTypeMask(beforeL2E.state));
        l2e = beforeL2ETypeCount === 12
          ? { state: beforeL2E.state, moves: [] }
          : findL2E(beforeL2E.state, model, deadlineTs, requiredSolvedTypeMask);
        if (!l2e) {
          diagnostics.l2eFailures += 1;
          continue;
        }
      }
'''
s2, n = pattern.subn(replacement, s, count=1)
if n != 1:
    raise SystemExit(f'Yau Last 3 direct-cycle replacement count={n}')
s = s2

# Presentation: for Yau the direct final cycle itself is the Last 3, not a fake 10th-edge setup + empty L2E.
old = '''      if (finalSetup) {
        segments.push(buildSegment(
          "edge323Last3Setup",
          "3-2-3 · Last 3 setup",
          finalSetup.moves,
          10,
          10,
        ));
      }
      segments.push(buildSegment(
        "edge323L2E",
        "3-2-3 · L2E",
        l2e.moves,
        beforeL2ELockedCount + 1,
        12,
      ));
'''
new = '''      if (finalSetup) {
        segments.push(buildSegment(
          yauBank ? "edge323Last3" : "edge323Last3Setup",
          yauBank ? "3-2-3 · Last 3" : "3-2-3 · Last 3 setup",
          finalSetup.moves,
          10,
          yauBank ? 12 : 10,
        ));
      }
      if (!yauBank || l2e.moves.length) {
        segments.push(buildSegment(
          "edge323L2E",
          "3-2-3 · L2E",
          l2e.moves,
          beforeL2ELockedCount + 1,
          12,
        ));
      }
'''
if old not in s:
    raise SystemExit('segment presentation anchor not found')
s = s.replace(old, new, 1)
p.write_text(s)
print('Yau Last 3 now searches 9->12 in one protected slice cycle')
