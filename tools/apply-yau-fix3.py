from pathlib import Path


def rep(s, old, new, label):
    assert old in s, f"missing {label}"
    return s.replace(old, new, 1)

p = Path("solver/edgePairing444.js")
s = p.read_text()
anchor = '''export async function solveTargetEdgeTypes444(
'''
insert = '''export async function debugEdge323Frames444() {
  const model = await getPlannerModel();
  return model.sliceFamilies.map((family) => ({
    rotation: family.rotation,
    bankMask: family.bankMask,
    openMoves: [...family.openMoves],
  }));
}

'''
s = rep(s, anchor, insert + anchor, "debug frames")
p.write_text(s)

p = Path("solver/solver444.js")
s = p.read_text()
old = '''  if (!remainingEdges?.ok) {
    return yauFailure444(reduction, "444_YAU_EDGE_PAIRING_FAILED", remainingEdges?.reason || remainingEdges?.detail, deadlineTs);
  }'''
new = '''  if (!remainingEdges?.ok) {
    let frameDiagnostics = [];
    try {
      frameDiagnostics = await edgeModule.debugEdge323Frames444();
    } catch (_) {}
    const detail = JSON.stringify({
      reason: remainingEdges?.reason || remainingEdges?.detail || null,
      diagnostics: remainingEdges?.meta?.diagnostics || null,
      targetTypeMask,
      frames: frameDiagnostics,
    });
    return yauFailure444(reduction, "444_YAU_EDGE_PAIRING_FAILED", detail, deadlineTs);
  }'''
s = rep(s, old, new, "edge failure diagnostics")
p.write_text(s)
print("Yau 3-2-3 diagnostics added")
