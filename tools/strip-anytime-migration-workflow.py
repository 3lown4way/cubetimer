from pathlib import Path

path = Path("tools/apply-fmc-extreme-anytime-v3.py")
text = path.read_text()
marker = "# Restore and update the permanent CI workflow from main."
if marker not in text:
    raise SystemExit("workflow migration marker missing")
text = text[: text.index(marker)] + '''# The permanent workflow is restored by the GitHub connector after the implementation commit.
Path("tools/apply-fmc-extreme-anytime-v3.py").unlink()
'''
path.write_text(text)
Path("tools/strip-anytime-migration-workflow.py").unlink()
