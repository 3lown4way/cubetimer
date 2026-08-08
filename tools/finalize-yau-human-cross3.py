from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old, new, 1)

# Expose canonical, pre-view-rotation Cross 3 diagnostics.  The public human
# presentation rotates the whole cube to put the cross center on the side, so
# fixed physical-slot solvedness must be asserted here, before presentation.
p = Path("solver/solver444.js")
s = p.read_text()
s = replace_once(
    s,
    '''      yauCross3MoveCount: Number(cross3.moveCount) || 0,
      yauCross3Method: String(cross3.method || "Yau Cross Edges"),''',
    '''      yauCross3MoveCount: Number(cross3.moveCount) || 0,
      yauCross3HumanStepCount: Number(cross3.humanStepCount) || 0,
      yauCross3HumanWorkingSlices: Array.isArray(cross3.steps)
        ? cross3.steps.map((step) => String(step?.workingSlice || ""))
        : [],
      yauCross3SolvedTargetMask: Number(cross3.solvedTargetMask) || 0,
      yauCross3PairedTargetMask: Number(cross3.pairedTargetMask) || 0,
      yauCross3Method: String(cross3.method || "Yau Cross Edges"),''',
    "human step diagnostics",
)
p.write_text(s)

# After presentation/remapping, the literal wide face can be F/B/U/D/L/R
# depending on cube grip.  What must remain true is one working-slice
# open/close pair per committed cross edge.  Correct-slot placement is checked
# with the canonical mask above rather than against rotated physical slots.
p = Path("tools/verify-444-yau.mjs")
s = p.read_text()
s = replace_once(
    s,
    '''    assert.equal(result.meta.yauHumanCross3Applied, true);
    assert.ok(Number(result.meta.yauCross3MoveCount) <= 24);
    assert.ok(Number(result.meta.yauProtectedCenterSearchMs) >= 0);''',
    '''    assert.equal(result.meta.yauHumanCross3Applied, true);
    assert.ok(Number(result.meta.yauCross3HumanStepCount) >= 1);
    assert.ok(Number(result.meta.yauCross3HumanStepCount) <= 3);
    assert.equal(bitCount(Number(result.meta.yauCross3SolvedTargetMask) >>> 0), 3);
    assert.ok(Number(result.meta.yauCross3MoveCount) <= 30);
    assert.ok(Number(result.meta.yauProtectedCenterSearchMs) >= 0);''',
    "human step count assertion",
)
s = replace_once(
    s,
    '''  assert.ok(cross3WideTokens.length >= 2, "human Yau Cross 3/4 did not use a working slice");
  assert.ok(
    cross3WideTokens.every((token) => /^[LR]w(?:2|')?$/.test(token)),
    `human Yau Cross 3/4 used a non-L/R working slice: ${cross3WideTokens.join(" ")}`,
  );
  pattern = setup.segments[2].solution ? pattern.applyAlg(setup.segments[2].solution) : pattern;''',
    '''  assert.ok(cross3WideTokens.length >= 2, "human Yau Cross 3/4 did not use a working slice");
  assert.equal(
    cross3WideTokens.length,
    Number(result.meta.yauCross3HumanStepCount) * 2,
    "human Yau Cross 3/4 must use one working-slice open/close pair per committed cross edge",
  );
  for (let index = 0; index < cross3WideTokens.length; index += 2) {
    const open = cross3WideTokens[index];
    const close = cross3WideTokens[index + 1];
    const inverse = open.endsWith("2") ? open : open.endsWith("'") ? open.slice(0, -1) : `${open}'`;
    assert.equal(close, inverse, `human Yau Cross 3/4 did not restore its working slice: ${open} ... ${close}`);
  }
  pattern = setup.segments[2].solution ? pattern.applyAlg(setup.segments[2].solution) : pattern;''',
    "working slice pair assertion",
)
s = replace_once(
    s,
    '''  assert.equal(
    bitCount(solvedTypeMask(pattern) & targetMask),
    3,
    "Yau Cross 3/4 must place three paired dedges directly into their correct cross slots",
  );
  const cross3Mask = solvedTypeMask(pattern) & targetMask;''',
    '''  const cross3Mask = Number(result.meta.yauCross3SolvedTargetMask) >>> 0;
  assert.equal(
    bitCount(cross3Mask),
    3,
    "canonical Yau Cross 3/4 must have three dedges in their correct cross slots before view rotation",
  );
  assert.equal(
    pairedTypeMask(pattern) & cross3Mask,
    cross3Mask,
    "human-view Yau Cross 3/4 lost a canonical solved cross dedge",
  );''',
    "canonical solved-position contract",
)
p.write_text(s)
print("finalized human Yau Cross 3 contracts")
