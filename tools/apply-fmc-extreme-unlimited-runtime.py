from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing replacement target: {label}")
    return text.replace(old, new, 1)


profile_path = Path("solver/fmcExtremeProfile.js")
profile = profile_path.read_text()
profile = replace_once(profile, 'id: "independent-frontier-v2-compression-first-24",', 'id: "independent-frontier-v2-compression-first-unlimited",', "profile id")
profile = replace_once(profile, "defaultTimeBudgetMs: 300000,", "defaultTimeBudgetMs: 0,", "profile unlimited sentinel")
profile_path.write_text(profile)

solver_path = Path("solver/fmcSolver.js")
solver = solver_path.read_text()
solver = replace_once(
    solver,
    '''  const timeBudgetMs = Number.isFinite(options.timeBudgetMs)\n    ? Math.max(1000, Math.floor(options.timeBudgetMs))\n    : qualityPreset.timeBudgetMs;''',
    '''  const unlimitedTimeBudget = qualityMode === "extreme" && Number(options.timeBudgetMs) === 0;\n  const timeBudgetMs = unlimitedTimeBudget\n    ? Number.POSITIVE_INFINITY\n    : Number.isFinite(options.timeBudgetMs)\n      ? Math.max(1000, Math.floor(options.timeBudgetMs))\n      : qualityPreset.timeBudgetMs;''',
    "solver unlimited time parsing",
)
solver = replace_once(solver, "    totalBudgetMs: timeBudgetMs,", "    totalBudgetMs: Number.isFinite(timeBudgetMs) ? timeBudgetMs : null,\n    internalBudgetUnlimited: unlimitedTimeBudget,", "solver unlimited diagnostics")
solver_path.write_text(solver)

worker_path = Path("benchmark/fmcBenchmarkWorker.js")
worker = worker_path.read_text()
worker = replace_once(
    worker,
    '''    const timeBudgetMs = Number.isFinite(Number(payload.fmcTimeBudgetMs))\n      ? Math.max(100, Math.floor(Number(payload.fmcTimeBudgetMs)))\n      : qualityMode === "extreme"\n        ? 90000\n        : 8000;''',
    '''    const requestedTimeBudgetMs = Number(payload.fmcTimeBudgetMs);\n    const timeBudgetMs = qualityMode === "extreme" &&\n      (!Number.isFinite(requestedTimeBudgetMs) || requestedTimeBudgetMs === 0)\n      ? 0\n      : Number.isFinite(requestedTimeBudgetMs)\n        ? Math.max(100, Math.floor(requestedTimeBudgetMs))\n        : 8000;''',
    "worker unlimited budget",
)
worker_path.write_text(worker)

# Enhanced benchmark frontend.
path = Path("benchmark/benchmark-enhanced.js")
text = path.read_text()
text = replace_once(text, '  timeout: $("timeoutInput"),', '  timeout: $("timeoutInput"),\n  timeoutUnit: $("timeoutUnit"),', "enhanced timeout unit")
text = replace_once(
    text,
    '''function isFmc(mode = elements.mode.value) {\n  return mode === "fmc";\n}\n''',
    '''function isFmc(mode = elements.mode.value) {\n  return mode === "fmc";\n}\n\nfunction isUnlimitedExtreme(config = null) {\n  const mode = config?.mode ?? elements.mode.value;\n  const qualityMode = config?.fmcQualityMode ?? elements.fmcQuality.value;\n  return mode === "fmc" && qualityMode === "extreme";\n}\n''',
    "enhanced unlimited helper",
)
text = replace_once(
    text,
    '''function updateModeFields() {\n  const visible = isFmc();\n  elements.fmcQualityField.hidden = !visible;\n  elements.fmcTargetField.hidden = !visible;\n}\n''',
    '''function updateModeFields() {\n  const visible = isFmc();\n  const unlimitedExtreme = visible && elements.fmcQuality.value === "extreme";\n  elements.fmcQualityField.hidden = !visible;\n  elements.fmcTargetField.hidden = !visible;\n  elements.timeout.hidden = unlimitedExtreme;\n  elements.timeout.disabled = unlimitedExtreme;\n  if (elements.timeoutUnit) {\n    elements.timeoutUnit.textContent = unlimitedExtreme ? "무제한 · 목표 도달 또는 중지까지" : "초";\n  }\n}\n''',
    "enhanced unlimited UI",
)
text = replace_once(text, '    payload.fmcTimeBudgetMs = Math.max(100, config.timeoutMs - 150);', '    payload.fmcTimeBudgetMs = isUnlimitedExtreme(config)\n      ? 0\n      : Math.max(100, config.timeoutMs - 150);', "enhanced unlimited payload")
text = replace_once(
    text,
    '''  const timeoutPromise = new Promise((_, reject) => {\n    timeoutId = window.setTimeout(() => reject(new Error("BENCHMARK_TIMEOUT")), config.timeoutMs);\n  });\n\n  try {\n    const result = await Promise.race([api.solve(buildPayload(config, scramble), onProgress), timeoutPromise]);''',
    '''  const unlimitedExtreme = isUnlimitedExtreme(config);\n  const timeoutPromise = unlimitedExtreme\n    ? null\n    : new Promise((_, reject) => {\n        timeoutId = window.setTimeout(() => reject(new Error("BENCHMARK_TIMEOUT")), config.timeoutMs);\n      });\n\n  try {\n    const solvePromise = api.solve(buildPayload(config, scramble), onProgress);\n    const result = unlimitedExtreme\n      ? await solvePromise\n      : await Promise.race([solvePromise, timeoutPromise]);''',
    "enhanced external timeout",
)
text = replace_once(text, '''  } finally {\n    window.clearTimeout(timeoutId);\n  }''', '''  } finally {\n    if (timeoutId) window.clearTimeout(timeoutId);\n  }''', "enhanced cleanup")
text = replace_once(
    text,
    '''elements.fmcQuality.addEventListener("change", syncFmcDefaults);\nelements.fmcTarget.addEventListener("change", () => {\n  if (Number(elements.fmcTarget.value) < 20) elements.fmcQuality.value = "extreme";\n  if (elements.fmcQuality.value === "extreme" && Number(elements.timeout.value) < 105) elements.timeout.value = "120";\n});''',
    '''elements.fmcQuality.addEventListener("change", () => {\n  syncFmcDefaults();\n  updateModeFields();\n});\nelements.fmcTarget.addEventListener("change", () => {\n  if (Number(elements.fmcTarget.value) < 20) elements.fmcQuality.value = "extreme";\n  updateModeFields();\n});''',
    "enhanced events",
)
path.write_text(text)

# Legacy benchmark frontend.
path = Path("benchmark/benchmark.js")
text = path.read_text()
text = replace_once(text, 'const timeoutInput = document.getElementById("timeoutInput");', 'const timeoutInput = document.getElementById("timeoutInput");\nconst timeoutUnit = document.getElementById("timeoutUnit");', "legacy timeout unit")
text = replace_once(
    text,
    '''function setWorkerStatus(text, state = "idle") {''',
    '''function isUnlimitedExtreme(config = null) {\n  const mode = config?.mode ?? modeSelect.value;\n  const qualityMode = config?.fmcQualityMode ?? fmcQualitySelect.value;\n  return mode === "fmc" && qualityMode === "extreme";\n}\n\nfunction setWorkerStatus(text, state = "idle") {''',
    "legacy unlimited helper",
)
text = replace_once(
    text,
    '''function updateModeFields() {\n  const isFmc = modeSelect.value === "fmc";\n  fmcQualityField.hidden = !isFmc;\n  fmcTargetField.hidden = !isFmc;\n  if (!isFmc) return;\n  if (fmcQualitySelect.value === "sweetSpot" && Number(fmcTargetSelect.value) < 20) {\n    fmcQualitySelect.value = "extreme";\n  }\n}\n''',
    '''function updateModeFields() {\n  const isFmc = modeSelect.value === "fmc";\n  if (isFmc && fmcQualitySelect.value === "sweetSpot" && Number(fmcTargetSelect.value) < 20) {\n    fmcQualitySelect.value = "extreme";\n  }\n  const unlimitedExtreme = isFmc && fmcQualitySelect.value === "extreme";\n  fmcQualityField.hidden = !isFmc;\n  fmcTargetField.hidden = !isFmc;\n  timeoutInput.hidden = unlimitedExtreme;\n  timeoutInput.disabled = unlimitedExtreme;\n  if (timeoutUnit) timeoutUnit.textContent = unlimitedExtreme ? "무제한 · 목표 도달 또는 중지까지" : "초";\n}\n''',
    "legacy unlimited UI",
)
text = replace_once(
    text,
    '''    const defaultBudget = config.fmcQualityMode === "extreme" ? 90000 : 8000;\n    payload.fmcQualityMode = config.fmcQualityMode;\n    payload.fmcTargetMoveCount = config.fmcTargetMoveCount;\n    payload.fmcTimeBudgetMs = Math.max(\n      100,\n      Math.min(defaultBudget, Math.max(100, config.timeoutMs - 100)),\n    );''',
    '''    payload.fmcQualityMode = config.fmcQualityMode;\n    payload.fmcTargetMoveCount = config.fmcTargetMoveCount;\n    payload.fmcTimeBudgetMs = isUnlimitedExtreme(config)\n      ? 0\n      : Math.max(100, Math.min(8000, Math.max(100, config.timeoutMs - 100)));''',
    "legacy unlimited payload",
)
text = replace_once(
    text,
    '''  const timeoutPromise = new Promise((_, reject) => {\n    timeoutId = window.setTimeout(() => reject(new Error("BENCHMARK_TIMEOUT")), config.timeoutMs);\n  });\n\n  try {\n    const result = await Promise.race([\n      api.solve(buildSolvePayload(config, scramble), onProgress),\n      timeoutPromise,\n    ]);''',
    '''  const unlimitedExtreme = isUnlimitedExtreme(config);\n  const timeoutPromise = unlimitedExtreme\n    ? null\n    : new Promise((_, reject) => {\n        timeoutId = window.setTimeout(() => reject(new Error("BENCHMARK_TIMEOUT")), config.timeoutMs);\n      });\n\n  try {\n    const solvePromise = api.solve(buildSolvePayload(config, scramble), onProgress);\n    const result = unlimitedExtreme\n      ? await solvePromise\n      : await Promise.race([solvePromise, timeoutPromise]);''',
    "legacy external timeout",
)
text = replace_once(text, '''  } finally {\n    window.clearTimeout(timeoutId);\n  }''', '''  } finally {\n    if (timeoutId) window.clearTimeout(timeoutId);\n  }''', "legacy cleanup")
text = replace_once(
    text,
    '''fmcQualitySelect.addEventListener("change", syncFmcTargetToQuality);\nfmcTargetSelect.addEventListener("change", () => {\n  if (Number(fmcTargetSelect.value) < 20) fmcQualitySelect.value = "extreme";\n});''',
    '''fmcQualitySelect.addEventListener("change", () => {\n  syncFmcTargetToQuality();\n  updateModeFields();\n});\nfmcTargetSelect.addEventListener("change", () => {\n  if (Number(fmcTargetSelect.value) < 20) fmcQualitySelect.value = "extreme";\n  updateModeFields();\n});''',
    "legacy events",
)
path.write_text(text)

index_path = Path("benchmark/index.html")
index = index_path.read_text()
index = replace_once(index, "              <span>초</span>", '              <span id="timeoutUnit">초</span>', "timeout unit id")
index_path.write_text(index)

policy_test_path = Path("benchmark/benchmark-no-fallback-policy.test.mjs")
policy_test = policy_test_path.read_text().replace('extremeProfileId: "independent-frontier-v2-compression-first-24"', 'extremeProfileId: "independent-frontier-v2-compression-first-unlimited"')
policy_test_path.write_text(policy_test)

contract_path = Path("benchmark-fmc-extreme-contract.mjs")
contract = contract_path.read_text()
contract = replace_once(contract, 'const siteOptions = buildFmcExtremeOptions({ timeBudgetMs: 1000, targetMoveCount: 20 });', 'const siteOptions = buildFmcExtremeOptions({ targetMoveCount: 20 });', "contract shared options")
contract = replace_once(contract, 'assert.equal(FMC_EXTREME_PROFILE.id, "independent-frontier-v2-compression-first-24");', 'assert.equal(FMC_EXTREME_PROFILE.id, "independent-frontier-v2-compression-first-unlimited");\nassert.equal(siteOptions.timeBudgetMs, 0);', "contract profile")
contract = replace_once(contract, 'assert.equal(result?.extremeProfileId || diagnostics.extremeProfileId, FMC_EXTREME_PROFILE.id);', 'assert.equal(result?.extremeProfileId || diagnostics.extremeProfileId, FMC_EXTREME_PROFILE.id);\nassert.equal(diagnostics.internalBudgetUnlimited, true);\nassert.equal(diagnostics.totalBudgetMs, null);', "contract diagnostics")
contract_path.write_text(contract)

verify_path = Path("tools/verify-benchmark-no-fallback.mjs")
verify = verify_path.read_text().replace('id: "independent-frontier-v2-compression-first-24"', 'id: "independent-frontier-v2-compression-first-unlimited"')
verify = verify.replace('"extremeReservedCompressionPremoves: 24",', '"extremeReservedCompressionPremoves: 24",\n  "defaultTimeBudgetMs: 0",')
verify = replace_once(
    verify,
    '''if (!enhanced.includes('payload.fmcTimeBudgetMs = Math.max(100, config.timeoutMs - 150)')) {\n  throw new Error("site per-run timeout is not propagated");\n}\n''',
    '''for (const source of [enhanced, legacy]) {\n  if (!source.includes("payload.fmcTimeBudgetMs = isUnlimitedExtreme(config)")) {\n    throw new Error("Extreme unlimited payload is missing");\n  }\n  if (!source.includes("const result = unlimitedExtreme")) {\n    throw new Error("Extreme still uses the external Promise.race timeout");\n  }\n  if (!source.includes("목표 도달 또는 중지까지")) {\n    throw new Error("Extreme unlimited UI indicator is missing");\n  }\n}\nif (!fmcWorker.includes("requestedTimeBudgetMs === 0") || !fmcSolver.includes("unlimitedTimeBudget")) {\n  throw new Error("Extreme unlimited sentinel is not preserved end-to-end");\n}\n''',
    "unlimited static verification",
)
verify_path.write_text(verify)

Path("tools/apply-fmc-extreme-unlimited-runtime.py").unlink()
