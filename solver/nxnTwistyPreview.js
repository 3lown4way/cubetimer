// A solver preview owns one TwistyPlayer, so multi-blind is intentionally excluded.
export const NXN_SOLVER_EVENT_TO_PUZZLE = Object.freeze({
  "222": "2x2x2",
  "333": "3x3x3",
  "333oh": "3x3x3",
  "333bf": "3x3x3",
  "333fm": "3x3x3",
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

function loadSolver444UiActivation() {
  void import("./solver444UiActivation.js?v=20260809-smooth-playback-1")
    .then(({ installSolver444UiActivation }) => installSolver444UiActivation())
    .catch((error) => {
      console.warn("[444 UI] activation failed", error);
    });
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadSolver444UiActivation, { once: true });
  } else {
    queueMicrotask(loadSolver444UiActivation);
  }
}
