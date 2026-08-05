from pathlib import Path

path = Path("benchmark-inverse-output-contract.mjs")
text = path.read_text()
replacements = [
    (
        r'assert.match(workerSource, /isLiteralInverseSolution\(scramble,\s*searched\.solution\)/);',
        r'assert.match(workerSource, /shouldRejectLiteralInverseSolution\(scramble,\s*searched\.solution\)/);',
    ),
    (
        r'assert.match(workerSource, /isLiteralInverseSolution\(scramble,\s*solution\)/);',
        r'assert.match(workerSource, /shouldRejectLiteralInverseSolution\(scramble,\s*solution\)/);',
    ),
]
for old, new in replacements:
    if text.count(old) != 1:
        raise SystemExit(f"expected one marker match: {old}")
    text = text.replace(old, new, 1)
path.write_text(text)
Path("tools/fix-short-inverse-benchmark-markers.py").unlink(missing_ok=True)
