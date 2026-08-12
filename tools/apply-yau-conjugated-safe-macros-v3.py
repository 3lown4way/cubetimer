from pathlib import Path
import runpy

runpy.run_path('tools/apply-yau-conjugated-safe-macros-v2.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()

# searchTargetEdgeTypes444 keeps the full conjugated macro vocabulary, but a
# Yau caller can require the four protected cross dedges to remain paired after
# every atomic token inside each candidate macro.
old = '''  projectTargetState = false,
  actionPool = null,
) {
'''
new = '''  projectTargetState = false,
  actionPool = null,
  requiredPairedEveryMoveMask = 0,
) {
'''
if old not in s:
    raise SystemExit('searchTarget signature tail not found')
s = s.replace(old, new, 1)

old = '''      for (let actionIndex = 0; actionIndex < searchActions.length; actionIndex += 1) {
        const nextState = applyCompactAction(node.state, searchActions[actionIndex].action, true);
        const pairedMask = pairedEdgeTypeMask(nextState);
'''
new = '''      for (let actionIndex = 0; actionIndex < searchActions.length; actionIndex += 1) {
        const searchAction = searchActions[actionIndex];
        const nextState = requiredPairedEveryMoveMask
          ? applyTokenPathPreservingPairedTypes444(
              node.state,
              splitAlgorithm(searchAction.algorithm),
              model,
              requiredPairedEveryMoveMask,
            )
          : applyCompactAction(node.state, searchAction.action, true);
        if (!nextState) continue;
        const pairedMask = pairedEdgeTypeMask(nextState);
'''
if old not in s:
    raise SystemExit('searchTarget expansion block not found')
s = s.replace(old, new, 1)

# The three Yau target searches are Next-2 first insertion, Next-2 second
# insertion, and the 9->10 Last-3 setup. Pass the cross mask to all three.
needle = '''          yauSeedActions,
        );'''
replacement = '''          yauSeedActions,
          requiredTypeMask,
        );'''
count = s.count(needle)
if count != 2:
    raise SystemExit(f'expected 2 Next-2 Yau calls, found {count}')
s = s.replace(needle, replacement)

needle = '''            yauSeedActions,
          );'''
replacement = '''            yauSeedActions,
            requiredTypeMask,
          );'''
count = s.count(needle)
if count != 1:
    raise SystemExit(f'expected 1 Last-3 Yau call, found {count}')
s = s.replace(needle, replacement, 1)

p.write_text(s)
print('added atomic protected-cross filtering to Yau Next 2 and Last-3 target macros')
