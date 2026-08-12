from pathlib import Path
import runpy

runpy.run_path('tools/apply-yau-safe-wide-macros.py', run_name='__main__')

p = Path('solver/solver444.js')
s = p.read_text()
old = '''      const protectedDeadlineTs = deadlineTs > 0
        ? Math.min(deadlineTs, Date.now() + (options?.__yauFastFrameProbe === true ? 900 : 2200))
        : Date.now() + (options?.__yauFastFrameProbe === true ? 900 : 2200);
'''
new = '''      const defaultProtectedBudgetMs = options?.__yauFastFrameProbe === true ? 900 : 2200;
      const protectedBudgetMs = Math.max(
        defaultProtectedBudgetMs,
        Math.min(8000, Number(options?.__yauProtectedCenterBudgetMs) || defaultProtectedBudgetMs),
      );
      const protectedDeadlineTs = deadlineTs > 0
        ? Math.min(deadlineTs, Date.now() + protectedBudgetMs)
        : Date.now() + protectedBudgetMs;
'''
if old not in s:
    raise SystemExit('protected-center local deadline anchor not found')
s = s.replace(old, new, 1)
p.write_text(s)

p = Path('tools/verify-444-yau.mjs')
v = p.read_text()
old = '''    deadlineTs: Date.now() + 60_000,
    crossColor,
    method444: "yau",
  });
'''
new = '''    deadlineTs: Date.now() + 60_000,
    crossColor,
    method444: "yau",
    __yauProtectedCenterBudgetMs: 6000,
  });
'''
if old not in v:
    raise SystemExit('Yau verifier solve options anchor not found')
v = v.replace(old, new, 1)
p.write_text(v)
print('added test-only protected-center budget headroom')
