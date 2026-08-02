from pathlib import Path

path = Path("benchmark/benchmark-no-fallback-policy.test.mjs")
text = path.read_text()
profile = 'extremeProfileId: "independent-frontier-v2-24", '

old_target_miss = 'result: { ok: true, source: "FMC_WASM", qualityMode: "extreme", qualityTargetReached: false, qualityDowngraded: false, moveCount: 22 },'
new_target_miss = f'result: {{ ok: true, source: "FMC_WASM", qualityMode: "extreme", {profile}qualityTargetReached: false, qualityDowngraded: false, moveCount: 22 }},'
if old_target_miss not in text:
    raise SystemExit("target-miss policy fixture missing")
text = text.replace(old_target_miss, new_target_miss, 1)

old_success = 'result: { ok: true, source: "FMC_WASM", qualityMode: "extreme", qualityTargetReached: true, qualityDowngraded: false, moveCount: 20 },'
new_success = f'result: {{ ok: true, source: "FMC_WASM", qualityMode: "extreme", {profile}qualityTargetReached: true, qualityDowngraded: false, moveCount: 20 }},'
if old_success in text:
    text = text.replace(old_success, new_success, 1)
elif new_success not in text:
    raise SystemExit("success policy fixture missing")

path.write_text(text)
Path("tools/repair-fmc-extreme-site-parity-tests.py").unlink()
