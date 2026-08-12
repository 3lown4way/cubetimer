from pathlib import Path
import runpy

runpy.run_path('tools/apply-yau-conjugated-safe-macros.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()

# Replay a token path and reject it immediately if any protected dedge splits.
anchor = '''function findL2E(initialState, model, deadlineTs, requiredSolvedTypeMask = 0, actionPool = null) {
'''
helper = '''function applyTokenPathPreservingPairedTypes444(state, moves, model, requiredPairedMask = 0) {
  let current = state;
  for (const move of moves) {
    current = applyCompactAction(current, model.actionFor(move), true);
    if (requiredPairedMask && !maskContains(pairedEdgeTypeMask(current), requiredPairedMask)) return null;
  }
  return current;
}

'''
if anchor not in s:
    raise SystemExit('findL2E anchor not found')
s = s.replace(anchor, helper + anchor, 1)

old = '''function findL2E(initialState, model, deadlineTs, requiredSolvedTypeMask = 0, actionPool = null) {
  const solvedCenters = model.solvedCompact;
'''
new = '''function findL2E(
  initialState,
  model,
  deadlineTs,
  requiredSolvedTypeMask = 0,
  actionPool = null,
  requiredPairedEveryMoveMask = 0,
) {
  const solvedCenters = model.solvedCompact;
'''
if old not in s:
    raise SystemExit('findL2E signature block not found')
s = s.replace(old, new, 1)

old = '''    const setup = L2E_SETUP_PATHS[setupIndex];
    const setupState = applyMovePath(initialState, setup, model);
    const undo = setup.slice().reverse().map(invertMoveToken);
    for (const l2e of l2eActions) {
      let candidate = applyCompactAction(setupState, l2e.action, true);
      candidate = applyMovePath(candidate, undo, model);
      if (
'''
new = '''    const setup = L2E_SETUP_PATHS[setupIndex];
    const setupState = applyMovePath(initialState, setup, model);
    const undo = setup.slice().reverse().map(invertMoveToken);
    for (const l2e of l2eActions) {
      let candidate = requiredPairedEveryMoveMask
        ? applyTokenPathPreservingPairedTypes444(
            setupState,
            splitAlgorithm(l2e.algorithm),
            model,
            requiredPairedEveryMoveMask,
          )
        : applyCompactAction(setupState, l2e.action, true);
      if (!candidate) continue;
      candidate = applyMovePath(candidate, undo, model);
      if (
'''
if old not in s:
    raise SystemExit('findL2E candidate block not found')
s = s.replace(old, new, 1)

old = '''            requiredSolvedTypeMask,
            yauBank ? yauL2EActions : null,
          );
'''
new = '''            requiredSolvedTypeMask,
            yauBank ? yauL2EActions : null,
            yauBank ? requiredTypeMask : 0,
          );
'''
if old not in s:
    raise SystemExit('Yau findL2E call tail not found')
s = s.replace(old, new, 1)
p.write_text(s)
print('added atomic protected-cross filtering to Yau L2E candidates')
