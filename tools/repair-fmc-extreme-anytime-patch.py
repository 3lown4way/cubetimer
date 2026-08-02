from pathlib import Path

path = Path("solver/fmcSolver.js")
text = path.read_text()
marker = "  diagnostics.selectedCandidate = {"
first = text.find(marker)
while first >= 0:
    second = text.find(marker, first + len(marker))
    if second < 0:
        break
    candidate = text[first:second]
    if "rejectedForTarget: true" in candidate and "FMC_EXTREME_TARGET_NOT_REACHED" in candidate:
        text = text[:first] + text[second:]
        path.write_text(text)
        Path("tools/repair-fmc-extreme-anytime-patch.py").unlink()
        raise SystemExit(0)
    first = second
raise SystemExit("malformed hard-target block not found")
