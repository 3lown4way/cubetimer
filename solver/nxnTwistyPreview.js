export const NXN_SOLVER_EVENT_TO_PUZZLE = Object.freeze({
  "222": "2x2x2",
  "333": "3x3x3",
  "333oh": "3x3x3",
  "333bf": "3x3x3",
  "333fm": "3x3x3",
  "333mbf": "3x3x3",
  "444": "4x4x4",
  "444bf": "4x4x4",
  "555": "5x5x5",
  "555bf": "5x5x5",
  "666": "6x6x6",
  "777": "7x7x7",
});

export function resolveNxNSolverPuzzle(eventId) {
  return NXN_SOLVER_EVENT_TO_PUZZLE[String(eventId || "")] || null;
}

export function isNxNSolverPreviewEvent(eventId) {
  return resolveNxNSolverPuzzle(eventId) !== null;
}
