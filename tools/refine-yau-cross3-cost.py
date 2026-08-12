from pathlib import Path

p = Path('solver/solver444.js')
s = p.read_text()

anchor = '''function viewMoveExecutionCost444(tokens) {
  const faceWeight = { U: 0.7, R: 0.65, F: 0.75, D: 1.05, L: 1.2, B: 2.7 };
  let cost = 0;
  for (const token of tokens) {
    const match = /^([URFDLB])(w)?(2|')?$/.exec(token);
    if (!match) continue;
    cost += faceWeight[match[1]] ?? 1;
    if (match[2]) cost += match[1] === "B" ? 1.0 : 0.35;
    if (match[3] === "2") cost *= 0.985;
  }
  return cost;
}
'''
insert = anchor + '''
function viewYauCrossStepExecutionCost444(tokens) {
  // While the 3-cross is held on R, speedsolvers normally regrip around that
  // axis rather than keep executing repeated L/B turns.  Make that preference
  // explicit only for the individual Cross-3 insertion microsteps.
  const faceWeight = { U: 0.62, R: 0.52, F: 0.62, D: 1.0, L: 2.35, B: 5.2 };
  let cost = 0;
  for (const token of tokens) {
    const match = /^([URFDLB])(w)?(2|')?$/.exec(token);
    if (!match) continue;
    cost += faceWeight[match[1]] ?? 1;
    if (match[2]) cost += match[1] === "B" ? 1.5 : match[1] === "L" ? 0.75 : 0.25;
    if (match[3] === "2") cost += 0.08;
  }
  return cost;
}
'''
if anchor not in s:
    raise SystemExit('view move cost anchor missing')
s = s.replace(anchor, insert, 1)

old_cost = '''        const transition = shortestViewRotationPath444(state.orientation, target);
        const cost = state.cost
          + viewRotationExecutionCost444(transition)
          + viewMoveExecutionCost444(remapped);
'''
new_cost = '''        const transition = shortestViewRotationPath444(state.orientation, target);
        const yauCrossStep = segments[index]?.humanErgonomicMode === "yauCross3Step";
        const transitionCost = viewRotationExecutionCost444(transition) * (yauCrossStep ? 0.42 : 1);
        const moveCost = yauCrossStep
          ? viewYauCrossStepExecutionCost444(remapped)
          : viewMoveExecutionCost444(remapped);
        const cost = state.cost + transitionCost + moveCost;
'''
if old_cost not in s:
    raise SystemExit('DP cost anchor missing')
s = s.replace(old_cost, new_cost, 1)

old_expand = '''        expandedCenterSegments.push({
          ...segment,
          id: `${segment.id}HumanStep${part + 1}`,
          name: `${segment.name} · ${part + 1}/${rawCounts.length}`,
          solution: tokens.slice(cursor, cursor + count).join(" "),
        });
'''
new_expand = '''        expandedCenterSegments.push({
          ...segment,
          id: `${segment.id}HumanStep${part + 1}`,
          name: `${segment.name} · ${part + 1}/${rawCounts.length}`,
          solution: tokens.slice(cursor, cursor + count).join(" "),
          humanErgonomicMode: "yauCross3Step",
        });
'''
if old_expand not in s:
    raise SystemExit('Cross3 microsegment expansion anchor missing')
s = s.replace(old_expand, new_expand, 1)

p.write_text(s)
print('added Cross3-only human execution cost model')
