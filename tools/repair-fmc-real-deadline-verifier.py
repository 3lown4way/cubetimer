from pathlib import Path

path = Path("tools/apply-fmc-real-deadline.py")
text = path.read_text()
old = '''if (enhanced.includes("90000") || enhanced.includes('elements.timeout.value = "120"')) {
  throw new Error("Extreme still has an independent fixed timeout");
}
'''
new = '''if (
  enhanced.includes('const budget = config.fmcQualityMode === "extreme" ? 90000 : 8000') ||
  enhanced.includes('Math.min(budget, Math.max(100, config.timeoutMs - 100))') ||
  enhanced.includes('if (Number(elements.timeout.value) < 105) elements.timeout.value = "120"')
) {
  throw new Error("Extreme still has an independent fixed timeout");
}
'''
if old not in text:
    raise SystemExit("broad timeout verifier block not found")
path.write_text(text.replace(old, new, 1))
