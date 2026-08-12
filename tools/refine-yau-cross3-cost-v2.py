from pathlib import Path

p = Path('solver/edgePairing444.js')
s = p.read_text()
old = '''function humanYauCrossCandidateCost444(moves, setupLength, hasPost) {
  // Human execution cost, not just HTM. Back turns are the strongest smell in
  // a visible Yau solve; left turns are legal but mildly less ergonomic than
  // equivalent R/F triggers. Keep move count dominant so we never choose a
  // much longer line merely to avoid one L move.
  let cost = moves.length * 100 + setupLength * 10 + (hasPost ? 7 : 0);
  for (const move of moves) {
    const token = String(move || "");
    const face = token[0];
    if (face === "B") cost += 24;
    else if (face === "L") cost += 8;
    if (/^Bw/.test(token)) cost += 12;
    else if (/^Lw/.test(token)) cost += 4;
    if (token.endsWith("2")) cost += 2;
  }
  return cost;
}
'''
new = '''function humanYauCrossCandidateCost444(moves, setupLength, hasPost) {
  // Human execution score for the three pre-center cross edges.  The previous
  // weights made one saved HTM worth more than four B turns, which was exactly
  // why the "human" path still looked solver-ish.  Here one extra setup turn
  // may beat a B turn, while two or three gratuitous extra moves still lose.
  let cost = moves.length * 42 + setupLength * 7 + (hasPost ? 5 : 0);
  for (const move of moves) {
    const token = String(move || "");
    const face = token[0];
    if (face === "B") cost += 68;
    else if (face === "L") cost += 17;
    else if (face === "D") cost += 5;
    if (/^Bw/.test(token)) cost += 28;
    else if (/^Lw/.test(token)) cost += 9;
    if (token.endsWith("2")) cost += 2;
  }
  return cost;
}
'''
if old not in s:
    raise SystemExit('current Cross3 candidate cost block missing')
s = s.replace(old, new, 1)
p.write_text(s)
print('rebalanced Cross3 move-count versus B/L ergonomics')
