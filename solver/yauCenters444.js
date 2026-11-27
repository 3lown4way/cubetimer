import { puzzles } from "../vendor/cubing/puzzles/index.js";

const FACES = ["U", "R", "F", "D", "L", "B"];
// Where a side moves under a positive y turn, in order.
const SIDES = ["F", "L", "B", "R"];
const SUFFIXES = ["", "'", "2"];
const MASK_BASE = 2 ** 24;
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

// Reverse shortest-path search over just the participating center colors.
// A table records the move back toward its goal. It never evaluates wings or
// other phases, and a table is built only when its own phase needs it.
function getPolicy(model, id, goalA, goalB, createActions, deadlineTs, timing) {
  checkDeadline(deadlineTs);
  if (model.policies.has(id)) return model.policies.get(id);
  const started = Date.now();
  const actions = createActions();
  const goal = goalA + goalB * MASK_BASE;
  const policy = new Map([[goal, null]]);
  const buckets = [[goal]];
  let visited = 0;
  for (let cost = 0; cost < buckets.length; cost += 1) {
    for (const current of buckets[cost] || []) {
      if ((visited++ & 255) === 0) checkDeadline(deadlineTs);
      if (current !== goal && policy.get(current).cost !== cost) continue;
      const a = current % MASK_BASE;
      const b = Math.floor(current / MASK_BASE);
      for (const { destinations, undo, cost: turnCost = 1 } of actions) {
        const next = moveMask(a, destinations) + moveMask(b, destinations) * MASK_BASE;
        const nextCost = cost + turnCost;
        if (next === goal || (policy.get(next)?.cost ?? Infinity) <= nextCost) continue;
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

function centerPath(model, id, startA, goalA, startB, goalB, actions, deadlineTs, timing) {
  let current = startA + startB * MASK_BASE;
  const goal = goalA + goalB * MASK_BASE;
  if (current === goal) return [];
  const policy = getPolicy(model, id, goalA, goalB, actions, deadlineTs, timing);
  const output = [];
  while (current !== goal) {
    const step = policy.get(current);
    if (!step) throw new Error(`444_YAU_CENTER_UNREACHABLE:${id}`);
    output.push(...step.undo);
    current = step.toward;
  }
  return output;
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
  const first = centerPath(model, "first", centerMask(model, pattern, "D"), goals.D, 0, 0,
    () => turnsForLayers(FIRST_CENTER_LAYERS).map((move) => centerAction(model, [move])), deadlineTs, timing);
  const afterFirst = pattern.applyAlg(moveSequence(first));
  if (centerMask(model, afterFirst, "D") !== goals.D) throw new Error("444_YAU_FIRST_CENTER_VERIFY");

  onStage("YAU_OPPOSITE_CENTER");
  const opposite = centerPath(model, "opposite", centerMask(model, afterFirst, "U"), goals.U, 0, 0,
    () => oppositeCenterActions(model), deadlineTs, timing);
  const afterOpposite = afterFirst.applyAlg(moveSequence(opposite));
  if (centerMask(model, afterOpposite, "D") !== goals.D || centerMask(model, afterOpposite, "U") !== goals.U) {
    throw new Error("444_YAU_OPPOSITE_CENTER_VERIFY");
  }
  return { first, opposite, pattern: afterOpposite, ...timing, elapsedMs: Date.now() - started };
}

function sideCenterActions(model) {
  return [...SIDES, "Uw", "2D"].flatMap((layer) => (
    SUFFIXES.map((suffix) => model.action([`${layer}${suffix}`]))
  ));
}

function threeWideTurn(offset) {
  return ["", "3Uw", "3Uw2", "3Uw'"][(offset + 4) % 4];
}

function centerTurnsAtWorkingFace(turns, workingFace) {
  const result = [];
  let offset = 0;
  const gap = SIDES.indexOf(workingFace);
  for (const turn of turns) {
    const side = SIDES.indexOf(turn[0]);
    if (side < 0) {
      // These inner layers commute with the top-three-layer adjustment.
      result.push(turn);
      continue;
    }
    const required = (gap - side + 4) % 4;
    if (required !== offset) result.push(threeWideTurn(required - offset));
    result.push(`${workingFace}${turn.slice(1)}`);
    offset = required;
  }
  if (offset) result.push(threeWideTurn(-offset));
  return result;
}

export async function solveYauSideCenters444(pattern, workingFace, deadlineTs) {
  const model = await getModel();
  const timing = { tableBuildMs: 0 };
  const started = Date.now();
  const { goals } = model;
  const oppositeSides = goals.F | goals.B;
  const groups = centerPath(model, "side-groups", centerMask(model, pattern, "FB"), oppositeSides, 0, 0,
    () => sideCenterActions(model), deadlineTs, timing);
  const groupTurns = centerTurnsAtWorkingFace(groups, workingFace);
  const grouped = pattern.applyAlg(moveSequence(groupTurns));
  const colors = centerPath(model, "side-colors", centerMask(model, grouped, "F"), goals.F,
    centerMask(model, grouped, "R"), goals.R, () => sideCenterActions(model).filter(
      ({ destinations }) => moveMask(oppositeSides, destinations) === oppositeSides,
    ), deadlineTs, timing);
  const colorTurns = centerTurnsAtWorkingFace(colors, workingFace);
  const solved = grouped.applyAlg(moveSequence(colorTurns));
  if (!FACES.every((face) => centerMask(model, solved, face) === goals[face])) {
    throw new Error("444_YAU_SIDE_CENTERS_VERIFY");
  }
  return {
    turns: [...groupTurns, ...colorTurns],
    phaseMoveCounts: [groupTurns.length, colorTurns.length],
    pattern: solved,
    ...timing,
    elapsedMs: Date.now() - started,
  };
}
