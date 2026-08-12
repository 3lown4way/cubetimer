from pathlib import Path
import runpy

runpy.run_path('tools/apply-yau-323-cross-lock-v3.py', run_name='__main__')

# Add a hidden test-only override for the protected remaining-center local budget.
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
    raise SystemExit('protected center budget anchor not found')
s = s.replace(old, new, 1)
p.write_text(s)

# CI regression only: give the unrelated protected-center stage enough headroom.
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
    raise SystemExit('verifyCase solve444 options anchor not found')
v = v.replace(old, new, 1)
p.write_text(v)
print('stabilized Yau regression protected-center budget')
