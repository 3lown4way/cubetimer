from pathlib import Path

path = Path("tools/apply-human-viewpoint-cfop.py")
text = path.read_text()
old = '''old_stage_entry = \'\'\'        nodes: result.nodes,\n      });\n\'\'\'\nnew_stage_entry = \'\'\'        nodes: result.nodes,\n        humanViewpoint: humanViewpointDiagnostics,\n      });\n\'\'\'\n# There are two matching generic stage-entry blocks. Update both.\nif text.count(old_stage_entry) < 2:\n    raise SystemExit("missing generic stage-entry targets")\ntext = text.replace(old_stage_entry, new_stage_entry, 2)\n'''
new = '''old_generic_entries = \'\'\'      } else if (outputMoves.length || stage.omitIfNoMoves !== true || stage.includeWhenEmpty === true) {\n        stageEntries.push({\n          name: solvedStageLabel,\n          solution: joinMoves(outputMoves),\n          moveCount: countMetricMoves(outputMoves),\n          depth: countMetricMoves(outputMoves),\n          nodes: result.nodes,\n        });\n      }\n    } else if (outputMoves.length || stage.omitIfNoMoves !== true || stage.includeWhenEmpty === true) {\n      stageEntries.push({\n        name: solvedStageLabel,\n        solution: joinMoves(outputMoves),\n        moveCount: countMetricMoves(outputMoves),\n        depth: countMetricMoves(outputMoves),\n        nodes: result.nodes,\n      });\n    }\n\'\'\'\nnew_generic_entries = \'\'\'      } else if (outputMoves.length || stage.omitIfNoMoves !== true || stage.includeWhenEmpty === true) {\n        stageEntries.push({\n          name: solvedStageLabel,\n          solution: joinMoves(outputMoves),\n          moveCount: countMetricMoves(outputMoves),\n          depth: countMetricMoves(outputMoves),\n          nodes: result.nodes,\n          humanViewpoint: humanViewpointDiagnostics,\n        });\n      }\n    } else if (outputMoves.length || stage.omitIfNoMoves !== true || stage.includeWhenEmpty === true) {\n      stageEntries.push({\n        name: solvedStageLabel,\n        solution: joinMoves(outputMoves),\n        moveCount: countMetricMoves(outputMoves),\n        depth: countMetricMoves(outputMoves),\n        nodes: result.nodes,\n        humanViewpoint: humanViewpointDiagnostics,\n      });\n    }\n\'\'\'\ntext = replace_once(text, old_generic_entries, new_generic_entries, "generic stage viewpoint diagnostics")\n'''
if old not in text:
    raise SystemExit("integrator repair target missing")
text = text.replace(old, new, 1)
text = text.replace(
    '    const isHalfTurn = match[3].includes("2");',
    '    const suffix = match[3] || "";\n    const isHalfTurn = suffix.includes("2");',
    1,
)
text = text.replace(
    '  return `${mappedFace}${match[2]}${match[3]}`;',
    '  return `${mappedFace}${match[2]}${match[3] || ""}`;',
    1,
)
path.write_text(text)
Path("tools/repair-human-viewpoint-integrator.py").unlink()
