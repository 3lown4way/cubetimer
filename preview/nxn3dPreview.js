const PREVIEW_MODE_2D = "2D";
const PREVIEW_MODE_3D = "3D";

export const NXN_PREVIEW_MODE_KEY = "cubeTimerNxNPreviewMode";

export const NXN_EVENT_TO_PUZZLE = Object.freeze({
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

const NXN_EVENT_LABELS = Object.freeze({
  "222": "2×2×2",
  "333": "3×3×3",
  "333oh": "3×3×3 OH",
  "333bf": "3×3×3 BLD",
  "333fm": "3×3×3 FMC",
  "333mbf": "3×3×3 MBLD",
  "444": "4×4×4",
  "444bf": "4×4×4 BLD",
  "555": "5×5×5",
  "555bf": "5×5×5 BLD",
  "666": "6×6×6",
  "777": "7×7×7",
});

export function resolveNxNPuzzle(eventId) {
  return NXN_EVENT_TO_PUZZLE[String(eventId || "")] || null;
}

export function normalizeNxNPreviewMode(value) {
  return String(value || "").toUpperCase() === PREVIEW_MODE_2D
    ? PREVIEW_MODE_2D
    : PREVIEW_MODE_3D;
}

function safeStorageGet(storage, key) {
  try {
    return storage?.getItem?.(key) ?? null;
  } catch (_) {
    return null;
  }
}

function safeStorageSet(storage, key, value) {
  try {
    storage?.setItem?.(key, value);
  } catch (_) {
    // Preview preference persistence is non-critical.
  }
}

export function createNxNPreviewController({
  TwistyPlayer,
  twoDPreview,
  threeDHost,
  modeButtons = [],
  puzzleLabel = null,
  modeStatus = null,
  storage = typeof window !== "undefined" ? window.localStorage : null,
} = {}) {
  if (typeof TwistyPlayer !== "function") {
    throw new TypeError("TwistyPlayer constructor is required");
  }
  if (!twoDPreview || !threeDHost) {
    throw new TypeError("Both 2D preview and 3D host elements are required");
  }

  const buttons = Array.from(modeButtons || []);
  let preferredMode = normalizeNxNPreviewMode(
    safeStorageGet(storage, NXN_PREVIEW_MODE_KEY) || PREVIEW_MODE_3D,
  );
  let currentEventId = "333";
  let currentScramble = "";
  let player = null;
  let playerPuzzleId = "";

  function ensurePlayer(puzzleId) {
    if (player && playerPuzzleId === puzzleId) return player;
    player?.pause?.();
    threeDHost.replaceChildren?.();
    player = new TwistyPlayer({
      puzzle: puzzleId,
      visualization: "3D",
      background: "none",
      controlPanel: "none",
      hintFacelets: "none",
      experimentalSetupAnchor: "start",
    });
    playerPuzzleId = puzzleId;
    player.classList?.add?.("scramble-preview-twisty-player");
    threeDHost.append?.(player);
    return player;
  }

  function updateButtons(effectiveMode, supports3D) {
    for (const button of buttons) {
      const buttonMode = normalizeNxNPreviewMode(button?.dataset?.previewMode);
      const active = buttonMode === effectiveMode;
      button.classList?.toggle?.("active", active);
      button.setAttribute?.("aria-pressed", active ? "true" : "false");
      button.disabled = buttonMode === PREVIEW_MODE_3D && !supports3D;
      if (button.disabled) {
        button.title = "NxNxN 큐브 종목에서 사용할 수 있습니다.";
      } else {
        button.removeAttribute?.("title");
      }
    }
  }

  function render() {
    const puzzleId = resolveNxNPuzzle(currentEventId);
    const supports3D = Boolean(puzzleId);
    const effectiveMode = supports3D ? preferredMode : PREVIEW_MODE_2D;

    twoDPreview.setAttribute?.("visualization", "2D");
    twoDPreview.setAttribute?.("event", currentEventId);
    twoDPreview.setAttribute?.("scramble", currentScramble);
    twoDPreview.hidden = effectiveMode !== PREVIEW_MODE_2D;
    threeDHost.hidden = effectiveMode !== PREVIEW_MODE_3D;

    if (puzzleLabel) {
      puzzleLabel.textContent = NXN_EVENT_LABELS[currentEventId] || "스크램블 미리보기";
    }
    if (modeStatus) {
      modeStatus.textContent = supports3D
        ? effectiveMode === PREVIEW_MODE_3D
          ? "드래그하여 회전"
          : "2D 전개도"
        : "이 종목은 2D 미리보기를 사용합니다.";
    }

    updateButtons(effectiveMode, supports3D);

    if (supports3D && effectiveMode === PREVIEW_MODE_3D) {
      const activePlayer = ensurePlayer(puzzleId);
      activePlayer.experimentalSetupAlg = currentScramble;
      activePlayer.alg = "";
      activePlayer.timestamp = "end";
      activePlayer.pause?.();
    }
  }

  function setMode(nextMode, { persist = true } = {}) {
    preferredMode = normalizeNxNPreviewMode(nextMode);
    if (persist) {
      safeStorageSet(storage, NXN_PREVIEW_MODE_KEY, preferredMode);
    }
    render();
  }

  function setScramble(scramble, eventId) {
    currentScramble = String(scramble || "").trim();
    currentEventId = String(eventId || "333");
    render();
  }

  for (const button of buttons) {
    button.addEventListener?.("click", () => {
      if (button.disabled) return;
      setMode(button.dataset?.previewMode || PREVIEW_MODE_3D);
    });
  }

  render();

  return Object.freeze({
    setMode,
    setScramble,
    getMode: () => preferredMode,
    supports3D: (eventId) => Boolean(resolveNxNPuzzle(eventId)),
    destroy: () => player?.pause?.(),
  });
}
