from pathlib import Path

path = Path("tools/verify-benchmark-no-fallback.mjs")
text = path.read_text()
replacements = {
    'id: "independent-frontier-v2-compression-first-unlimited"': 'id: "independent-frontier-v3-anytime-widening"',
    'stage(`human-L${searchLevel}-V${variant}': 'stage(`human-L${searchLevel}${roundSuffix}-V${searchVariant}',
    'independent-frontier-v2 token missing': 'independent-frontier-v3 token missing',
}
for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f"missing contract token: {old}")
    text = text.replace(old, new)
anchor = '  "FMC_EXTREME_TARGET_NOT_REACHED",\n'
if anchor not in text:
    raise SystemExit("missing Extreme target anchor")
text = text.replace(
    anchor,
    '  "extremeMaxRounds",\n  \'type: "quality_round_start"\',\n' + anchor,
    1,
)
site_anchor = '''  if (!source.includes("목표 도달 또는 중지까지")) {
    throw new Error("Extreme unlimited UI indicator is missing");
  }
'''
if site_anchor not in text:
    raise SystemExit("missing site UI anchor")
text = text.replace(
    site_anchor,
    site_anchor + '''  if (!source.includes('progress.type === "quality_round_start"')) {
    throw new Error("Extreme anytime round progress is missing");
  }
''',
    1,
)
text = text.replace(
    'benchmark no-fallback routing and FMC Extreme site parity verified',
    'benchmark no-fallback routing and FMC Extreme anytime site parity verified',
)
path.write_text(text)
Path("tools/update-anytime-no-fallback-contract.py").unlink()
