import { puzzles } from "../vendor/cubing/puzzles/index.js";

const FACES = ["U", "R", "F", "D", "L", "B"];
// Where a side moves under a positive y turn, in order.
const SIDES = ["F", "L", "B", "R"];
const SUFFIXES = ["", "'", "2"];
const MASK_BASE = 2 ** 24;
const GAP_BASE = MASK_BASE ** 2;
// In the front-center grip, canonical D faces the player and canonical F
// is on top. Use the front face to align a bar and the wide turns to join it.
const FIRST_CENTER_LAYERS = ["D", "F", "Fw", "R", "Rw", "L", "Lw"];
const OPPOSITE_CENTER_LAYERS = ["U", "Uw", "R", "Rw", "L", "Lw"];

let modelPromise;

function inverseTurn(turn) {
  if (turn.endsWith("2")) return turn;
  return turn.endsWith("'") ? turn.slice(0, -1) : `${turn}'`;
}

function moveSequence(turns) {
  return turns.join(" ");
}

function moveMask(mask, destinations) {
  let output = 0;
  while (mask) {
    const bit = mask & -mask;
    output |= 1 << destinations[31 - Math.clz32(bit)];
    mask ^= bit;
  }
  return output;
}

function checkDeadline(deadlineTs) {
  if (deadlineTs > 0 && Date.now() >= deadlineTs) throw new Error("444_DEADLINE_REACHED");
}

async function buildModel() {
  const kpuzzle = await puzzles["4x4x4"].kpuzzle();
  const solved = kpuzzle.defaultPattern();
  const goals = {};
  const colorByPiece = new Map();
  for (const face of FACES) {
    const { permutation } = kpuzzle.moveToTransformation(face).transformationData.CENTERS;
    goals[face] = permutation.reduce((mask, source, position) => {
      if (source === position) return mask;
      colorByPiece.set(solved.patternData.CENTERS.pieces[position], face);
      return mask | (1 << position);
    }, 0);
  }

  function action(moves) {
    const { permutation } = kpuzzle.algToTransformation(moveSequence(moves)).transformationData.CENTERS;
    const destinations = new Uint8Array(24);
    permutation.forEach((source, destination) => { destinations[source] = destination; });
    return { destinations, undo: moves.slice().reverse().map(inverseTurn) };
  }

  return { goals, colorByPiece, action, policies: new Map() };
}

async function getModel() {
  modelPromise ??= buildModel().catch((error) => {
    modelPromise = null;
    throw error;
  });
  return modelPromise;
}

function centerMask(model, pattern, colors) {
  return pattern.patternData.CENTERS.pieces.reduce((mask, piece, position) => (
    colors.includes(model.colorByPiece.get(piece)) ? mask | (1 << position) : mask
  ), 0);
}

function centerState(maskA, maskB = 0, gap = 0) {
  return maskA + maskB * MASK_BASE + gap * GAP_BASE;
}

// Reverse shortest paths on center colors and, for the last four centers,
// the position of the one cross slot that can be used for side turns.
function getPolicy(model, id, goals, createActionSets, deadlineTs, timing) {
  checkDeadline(deadlineTs);
  if (model.policies.has(id)) return model.policies.get(id);
  const started = Date.now();
  const actionSets = createActionSets();
  const policy = new Map(goals.map((goal) => [goal, null]));
  const buckets = [[...goals]];
  let visited = 0;
  for (let cost = 0; cost < buckets.length; cost += 1) {
    for (const current of buckets[cost] ?? []) {
      if ((visited++ & 255) === 0) checkDeadline(deadlineTs);
      const entry = policy.get(current);
      if (entry && entry.cost !== cost) continue;
      const a = current % MASK_BASE;
      const b = Math.floor(current / MASK_BASE) % MASK_BASE;
      const gap = Math.floor(current / GAP_BASE);
      for (const { destinations, undo, cost: turnCost, gapShift = 0 } of actionSets[gap]) {
        const next = centerState(moveMask(a, destinations), moveMask(b, destinations), (gap + gapShift) % 4);
        const nextCost = cost + turnCost;
        const previous = policy.get(next);
        if (previous === null || (previous?.cost ?? Infinity) <= nextCost) continue;
        policy.set(next, { toward: current, undo, cost: nextCost });
        (buckets[nextCost] ??= []).push(next);
      }
    }
  }
  checkDeadline(deadlineTs);
  model.policies.set(id, policy);
  timing.tableBuildMs += Date.now() - started;
  return policy;
}

function centerPath(model, id, start, goals, actions, deadlineTs, timing) {
  if (goals.includes(start)) return { turns: [], gap: Math.floor(start / GAP_BASE) };
  const policy = getPolicy(model, id, goals, actions, deadlineTs, timing);
  let current = start;
  const turns = [];
  while (true) {
    const step = policy.get(current);
    if (step === null) return { turns, gap: Math.floor(current / GAP_BASE) };
    if (!step) throw new Error(`444_YAU_CENTER_UNREACHABLE:${id}`);
    turns.push(...step.undo);
    current = step.toward;
  }
}

function turnsForLayers(layers) {
  return layers.flatMap((layer) => SUFFIXES.map((suffix) => `${layer}${suffix}`));
}

function centerAction(model, moves) {
  const action = model.action(moves);
  const cost = moves.reduce((sum, turn) => sum + (turn[1] === "w" ? 11 : 8), 0);
  return { ...action, cost };
}

function oppositeCenterActions(model) {
  const turns = turnsForLayers(OPPOSITE_CENTER_LAYERS);
  const setups = turnsForLayers(["Rw", "Lw"]);
  const topTurns = turnsForLayers(["U", "Uw"]);
  const candidates = [
    ...turns.map((move) => [move]),
    ...setups.flatMap((open) => topTurns.map((turn) => [open, turn, inverseTurn(open)])),
  ];
  const actions = new Map();
  for (const moves of candidates) {
    const action = centerAction(model, moves);
    if (moveMask(model.goals.D, action.destinations) !== model.goals.D) continue;
    const key = action.destinations.join(",");
    if ((actions.get(key)?.cost ?? Infinity) > action.cost) actions.set(key, action);
  }
  return [...actions.values()];
}

export async function solveYauFirstCenters444(pattern, deadlineTs, onStage) {
  const model = await getModel();
  const started = Date.now();
  const timing = { tableBuildMs: 0 };
  const { goals } = model;
  checkDeadline(deadlineTs);

  onStage("YAU_FIRST_CENTER");
  const { turns: first } = centerPath(model, "first", centerMask(model, pattern, "D"), [goals.D],
    () => [turnsForLayers(FIRST_CENTER_LAYERS).map((move) => centerAction(model, [move]))], deadlineTs, timing);
  const afterFirst = pattern.applyAlg(moveSequence(first));
  if (centerMask(model, afterFirst, "D") !== goals.D) throw new Error("444_YAU_FIRST_CENTER_VERIFY");

  onStage("YAU_OPPOSITE_CENTER");
  const { turns: opposite } = centerPath(model, "opposite", centerMask(model, afterFirst, "U"), [goals.U],
    () => [oppositeCenterActions(model)], deadlineTs, timing);
  const afterOpposite = afterFirst.applyAlg(moveSequence(opposite));
  if (centerMask(model, afterOpposite, "D") !== goals.D || centerMask(model, afterOpposite, "U") !== goals.U) {
    throw new Error("444_YAU_OPPOSITE_CENTER_VERIFY");
  }
  return { first, opposite, pattern: afterOpposite, ...timing, elapsedMs: Date.now() - started };
}

function sideCenterActionSets(model, preserveMask = 0) {
  const common = turnsForLayers(["Uw", "Dw", "D"]).map((move) => {
    const amount = move.endsWith("2") ? 2 : move.endsWith("'") ? 3 : 1;
    return { ...model.action([move]), cost: move[0] === "D" && move[1] !== "w" ? 4 : 3,
      gapShift: move[0] === "D" ? 4 - amount : 0 };
  });
  const preservesGroup = ({ destinations }) => !preserveMask || moveMask(preserveMask, destinations) === preserveMask;
  const shifts = common.filter(preservesGroup);
  return SIDES.map((face) => [
    ...shifts,
    ...turnsForLayers([face]).map((move) => ({ ...model.action([move]), cost: 2 })),
  ]);
}

export async function solveYauSideCenters444(pattern, workingFace, deadlineTs) {
  const model = await getModel();
  const timing = { tableBuildMs: 0 };
  const started = Date.now();
  const { goals } = model;
  const initialGap = SIDES.indexOf(workingFace);
  const oppositeSides = goals.F | goals.B;
  // The cross can stay at the angle where the first group is finished. Only
  // the final center checkpoint needs it back in its original alignment.
  const groupGoals = SIDES.map((_, gap) => centerState(oppositeSides, 0, gap));
  const group = centerPath(model, "side-groups", centerState(centerMask(model, pattern, "FB"), 0, initialGap),
    groupGoals, () => sideCenterActionSets(model), deadlineTs, timing);
  const grouped = pattern.applyAlg(moveSequence(group.turns));

  const colorStart = centerState(centerMask(model, grouped, "F"), centerMask(model, grouped, "R"), group.gap);
  const colorGoal = centerState(goals.F, goals.R, initialGap);
  const colors = centerPath(model, `side-colors:${workingFace}`, colorStart, [colorGoal],
    () => sideCenterActionSets(model, oppositeSides), deadlineTs, timing);
  const solved = grouped.applyAlg(moveSequence(colors.turns));
  if (!FACES.every((face) => centerMask(model, solved, face) === goals[face])) {
    throw new Error("444_YAU_SIDE_CENTERS_VERIFY");
  }
  return {
    turns: [...group.turns, ...colors.turns],
    phaseMoveCounts: [group.turns.length, colors.turns.length],
    pattern: solved,
    ...timing,
    elapsedMs: Date.now() - started,
  };
}
