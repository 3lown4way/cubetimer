from pathlib import Path

solver = Path('solver/solver444.js')
s = solver.read_text()
old = '''  let yauEdge323ProtectedCrossBank = true;
  let yauEdge323ProtectedBankFallbackReason = null;

  // Prefer a true Yau 4-cross bank, but do not fail the whole solve merely
  // because that bounded 3-2-3 search cannot find a plan from this exact
  // frame. Retry the same human 3-2-3 planner with a freely chosen bank; all
  // centers remain solved, all 12 dedges are verified at the end, and the
  // completed cross is restored immediately afterwards.
  if (!remainingEdges?.ok && !deadlineReached(deadlineTs)) {
    yauEdge323ProtectedBankFallbackReason =
      remainingEdges?.detail || remainingEdges?.reason || "444_323_NO_PLAN";
    let rescue = null;
    try {
      rescue = await edgeModule.solveEdgePairing323(
        publicScramble,
        yauSetupPublic,
        { deadlineTs },
      );
    } catch (error) {
      rescue = {
        ok: false,
        reason: "444_YAU_EDGE_323_RESCUE_FAILED",
        detail: String(error?.message || error),
      };
    }
    if (rescue?.ok) {
      remainingEdges = {
        ...rescue,
        meta: {
          ...(rescue.meta && typeof rescue.meta === "object" ? rescue.meta : {}),
          yauProtectedCrossBank: false,
          yauProtectedBankFallbackReason: yauEdge323ProtectedBankFallbackReason,
        },
      };
      yauEdge323ProtectedCrossBank = false;
    }
  }
'''
new = '''  const yauEdge323ProtectedCrossBank = true;
  const yauEdge323ProtectedBankFallbackReason = null;
'''
if old not in s:
    raise SystemExit('free-bank fallback block not found')
s = s.replace(old, new, 1)
solver.write_text(s)

verify = Path('tools/verify-444-yau.mjs')
v = verify.read_text()
old = '''  assert.equal(edge.segments[0].name, "Yau Cross Bank 4/12");
  assert.equal(edge.segments[0].alreadyPaired, true);
  assert.equal(edge.segments.at(-1).pairEnd, 12);
  pattern = edge.solution ? pattern.applyAlg(edge.solution) : pattern;
  assert.equal(bitCount(pairedTypeMask(pattern)), 12, "Yau remaining edge stage did not pair all dedges");
  assert.equal((solvedTypeMask(pattern) & targetMask), targetMask, "Yau 3-2-3 disturbed the solved cross");
'''
new = '''  assert.equal(edge.segments[0].name, "Yau Cross Bank 4/12");
  assert.equal(edge.segments[0].alreadyPaired, true);
  assert.equal(edge.segments.at(-1).pairEnd, 12);
  assert.equal(result.meta.yauEdge323ProtectedCrossBank, true, "Yau must keep the four-cross bank");
  assert.equal(result.meta.yauEdge323ProtectedBankFallbackReason, null);
  let atomicBreak = null;
  for (const segment of edge.segments) {
    const tokens = String(segment.solution || "").trim().split(/\\s+/).filter(Boolean);
    for (const token of tokens) {
      pattern = pattern.applyAlg(token);
      if ((pairedTypeMask(pattern) & targetMask) !== targetMask && !atomicBreak) {
        atomicBreak = { segment: segment.name, token };
      }
    }
  }
  console.log(`[Yau ${crossColor}] protected bank atomic break:`, atomicBreak || "none");
  assert.equal(bitCount(pairedTypeMask(pattern)), 12, "Yau remaining edge stage did not pair all dedges");
  assert.equal((solvedTypeMask(pattern) & targetMask), targetMask, "Yau 3-2-3 disturbed the solved cross");
'''
if old not in v:
    raise SystemExit('verifier edge block not found')
v = v.replace(old, new, 1)
verify.write_text(v)
print('removed only the free-bank fallback and enabled atomic diagnostic')
