from pathlib import Path

path = Path("benchmark-rotation-count-contract.mjs")
text = path.read_text()
old = '''  if (verifyStageSum) {\n    const stageSum = (result.stages || []).reduce((sum, stage) => sum + Number(stage.moveCount || 0), 0);\n    assert.equal(stageSum, result.moveCount, `${label}: stage counts include rotations`);\n  }\n'''
new = '''  if (verifyStageSum) {\n    const rotationStages = (result.stages || []).filter((stage) =>\n      tokens(stage.solution).some((token) => ROTATION_RE.test(token)),\n    );\n    assert.ok(rotationStages.length >= 1, `${label}: no rotation-bearing stage found`);\n    for (const stage of rotationStages) {\n      assert.equal(\n        Number(stage.moveCount || 0),\n        metricCount(stage.solution),\n        `${label} ${stage.name}: x/y/z affected stage count`,\n      );\n      if (Number.isFinite(stage.depth)) {\n        assert.equal(stage.depth, metricCount(stage.solution), `${label} ${stage.name}: x/y/z affected depth`);\n      }\n    }\n  }\n'''
if old not in text:
    raise SystemExit("stage-sum assertion target missing")
path.write_text(text.replace(old, new, 1))
Path("tools/repair-rotation-count-contract.py").unlink()
