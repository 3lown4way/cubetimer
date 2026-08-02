from pathlib import Path


def replace_if_needed(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"missing replacement target: {label}")
    return text.replace(old, new, 1)


# Legacy benchmark must surface the same anytime-round progress event as the
# enhanced benchmark page.
legacy_path = Path("benchmark/benchmark.js")
legacy = legacy_path.read_text()
round_anchor = '''  if (progress.type === "fallback_start") return `fallback ${stageName || "시작"}`;
'''
round_block = '''  if (progress.type === "quality_round_start") {
    const best = Number.isFinite(progress.bestMoveCount) ? ` · 현재 ${progress.bestMoveCount}수` : "";
    return `${stageName || "FMC Extreme 다음 라운드"}${best}`;
  }
'''
if 'progress.type === "quality_round_start"' not in legacy:
    if round_anchor not in legacy:
        raise SystemExit("missing legacy round-progress anchor")
    legacy = legacy.replace(round_anchor, round_block + round_anchor, 1)
legacy_path.write_text(legacy)


# Update the static no-fallback/site-parity verifier to the v3 anytime profile.
path = Path("tools/verify-benchmark-no-fallback.mjs")
text = path.read_text()
text = replace_if_needed(
    text,
    'id: "independent-frontier-v2-compression-first-unlimited"',
    'id: "independent-frontier-v3-anytime-widening"',
    "Extreme profile id",
)
text = replace_if_needed(
    text,
    'stage(`human-L${searchLevel}-V${variant}',
    'stage(`human-L${searchLevel}${roundSuffix}-V${searchVariant}',
    "Extreme stage template",
)
text = text.replace(
    'independent-frontier-v2 token missing',
    'independent-frontier-v3 token missing',
)

anchor = '  "FMC_EXTREME_TARGET_NOT_REACHED",\n'
if '  "extremeMaxRounds",\n' not in text:
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
progress_check = '''  if (!source.includes('progress.type === "quality_round_start"')) {
    throw new Error("Extreme anytime round progress is missing");
  }
'''
if progress_check not in text:
    if site_anchor not in text:
        raise SystemExit("missing site round-progress anchor")
    text = text.replace(site_anchor, site_anchor + progress_check, 1)

text = text.replace(
    'benchmark no-fallback routing and FMC Extreme site parity verified',
    'benchmark no-fallback routing and FMC Extreme anytime site parity verified',
)
path.write_text(text)
