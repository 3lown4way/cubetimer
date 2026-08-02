from pathlib import Path

path = Path("solver/fmcSolver.js")
text = path.read_text()
old = '''      stage("extreme-compact-htr", {
        maxPremoveSets: capPremoves(24),
        enableHtrSkeletons: true,
        enableSliceInsertion: true,
        enableDeepMultiSwitchNiss: true,
      }, 180),'''
new = '''      stage("extreme-compact-htr", {
        maxPremoveSets: capPremoves(24),
        enableHtrSkeletons: true,
        enableSliceInsertion: true,
        enableDeepMultiSwitchNiss: true,
      }, 1500),'''
if old not in text:
    raise SystemExit("compact HTR budget target missing")
path.write_text(text.replace(old, new, 1))

verify_path = Path("tools/verify-benchmark-no-fallback.mjs")
verify = verify_path.read_text()
needle = "  'stage(\"extreme-compact-htr\"',\n"
if needle not in verify:
    raise SystemExit("verify compact HTR token missing")
verify_path.write_text(verify.replace(needle, needle + "  '}, 1500)',\n", 1))

Path("tools/repair-fmc-extreme-target-budget.py").unlink()
