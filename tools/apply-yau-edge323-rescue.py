from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old, new, 1)


p = Path("solver/solver444.js")
s = p.read_text()

old = '''  const remainingEdges = await edgeModule.solveEdgePairing323(
    publicScramble,
    yauSetupPublic,
    {
      deadlineTs,
      requiredTypeMask: targetTypeMask,
    },
  );
  if (!remainingEdges?.ok) {
    let frameDiagnostics = [];
    try {
      frameDiagnostics = await edgeModule.debugEdge323Frames444();
    } catch (_) {}
    const detail = JSON.stringify({
      reason: remainingEdges?.reason || remainingEdges?.detail || null,
      diagnostics: remainingEdges?.meta || remainingEdges?.detail || null,
      targetTypeMask,
      frames: frameDiagnostics,
    });
    return yauFailure444(reduction, "444_YAU_EDGE_PAIRING_FAILED", detail, deadlineTs);
  }
'''

new = '''  let remainingEdges = await edgeModule.solveEdgePairing323(
    publicScramble,
    yauSetupPublic,
    {
      deadlineTs,
      requiredTypeMask: targetTypeMask,
    },
  );
  let yauEdge323ProtectedCrossBank = true;
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

  if (!remainingEdges?.ok) {
    let frameDiagnostics = [];
    try {
      frameDiagnostics = await edgeModule.debugEdge323Frames444();
    } catch (_) {}
    const detail = JSON.stringify({
      reason: remainingEdges?.reason || remainingEdges?.detail || null,
      diagnostics: remainingEdges?.meta || remainingEdges?.detail || null,
      protectedBankFailure: yauEdge323ProtectedBankFallbackReason,
      targetTypeMask,
      frames: frameDiagnostics,
    });
    return yauFailure444(reduction, "444_YAU_EDGE_PAIRING_FAILED", detail, deadlineTs);
  }
'''

s = replace_once(s, old, new, "Yau edge pairing rescue")

old_meta = '''      yauCrossRestoreMoveCount: Number(crossRestore.moveCount) || 0,
      yauPureCenterMoveCount: publicCenterMoves.length,
'''
new_meta = '''      yauCrossRestoreMoveCount: Number(crossRestore.moveCount) || 0,
      yauEdge323ProtectedCrossBank,
      yauEdge323ProtectedBankFallbackReason,
      yauPureCenterMoveCount: publicCenterMoves.length,
'''
s = replace_once(s, old_meta, new_meta, "Yau edge rescue metadata")

p.write_text(s)
