from pathlib import Path
import runpy

runpy.run_path('tools/rewrite-yau-last-eight-v9.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()

old = '''        if (
          remaining === targetRemainingCount &&
          maskContains(closedMask, lockedMask) &&
'''
new = '''        if (
          remaining >= targetRemainingCount &&
          maskContains(closedMask, lockedMask) &&
'''
if old not in s:
    raise SystemExit('collector exact goal anchor missing')
s = s.replace(old, new, 1)

old = '''      if (goals.size >= goalLimit) break;
      beam = [...seen.values()]
'''
new = '''      // Human lookahead: once the shortest outer-depth yields legal Next-2
      // arrangements, keep those alternatives and stop. Do not burn the solve
      // budget trying to fill an arbitrary candidate quota at deeper depths.
      if (goals.size > 0) break;
      beam = [...seen.values()]
'''
if old not in s:
    raise SystemExit('collector stop anchor missing')
s = s.replace(old, new, 1)

# Keep only a small frontier at call sites.
s = s.replace('''      7,
      10,
    );
''', '''      7,
      6,
    );
''', 1)
s = s.replace('''          if (next2Candidates.length >= 10) break;
''', '''          if (next2Candidates.length >= 6) break;
''', 1)
s = s.replace('''        if (next2Candidates.length >= 10) break;
''', '''        if (next2Candidates.length >= 6) break;
''', 1)

p.write_text(s)
print('Yau lookahead now keeps only shortest-depth Next-2 alternatives and accepts natural overshoot')
