import { proxy, wrap } from "comlink";
import { TwistyPlayer } from "cubing/twisty";

const EVENT_ID = "444";
const PUZZLE_ID = "4x4x4";
const SOLVE_TIMEOUT_MS = 60_000;
const WORKER_BOOT_TIMEOUT_MS = 8_000;
const WORKER_CALL_GRACE_MS = 5_000;
const WORKER_BUILD_TOKEN = "20261125-yau-method-1";
const INSTALL_KEY = "__cubeTimer444UiActivationInstalled";

const STAGE_LABELS = Object.freeze({
  centers: "센터",
  edges: "엣지 페어링",
  parity: "패리티 정규화",
  threeByThree: "3×3 CFOP",
});

const PROGRESS_LABELS = Object.freeze({
  BOUNDARY: "4×4 엔진 준비",
  CENTERS: "센터 해결",
  YAU_FRAME: "Yau 탐색 방향 선택",
  YAU_CROSS3: "Yau 크로스 엣지 3개",
  YAU_REMAINING_CENTERS: "Yau 나머지 센터 4개",
  YAU_CROSS4: "Yau 마지막 크로스 엣지",
  EDGES: "엣지 페어링",
  PARITY: "패리티 정규화",
  VIRTUAL_333: "가상 3×3 변환",
  THREE_BY_THREE: "3×3 CFOP",
  VERIFY: "96-facelet 최종 검증",
  REDUCTION: "4×4 reduction",
});

function normalizeScramble(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function splitMoves(alg) {
  return String(alg || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function joinMoves(moves) {
  return Array.isArray(moves) ? moves.filter(Boolean).join(" ") : "";
}

function reasonLabel(reason) {
  switch (String(reason || "")) {
    case "444_DEADLINE_REACHED":
      return "4×4 해 탐색이 60초 제한을 초과했습니다.";
    case "444_YAU_ALL_FRAMES_FAILED":
      return "Yau 탐색이 각 방향에 할당된 시간 안에 완료되지 않았습니다.";
    case "444_YAU_HUMAN_CROSS3_FAILED":
      return "Yau 크로스 엣지 3쌍을 맞추지 못했습니다.";
    case "444_YAU_REMAINING_CENTERS_FAILED":
      return "Yau 크로스 3쌍을 유지하며 나머지 센터를 맞추지 못했습니다.";
    case "444_YAU_CROSS4_FAILED":
      return "Yau 마지막 크로스 엣지를 맞추지 못했습니다.";
    case "444_YAU_EDGE_PAIRING_FAILED":
      return "Yau 3-2-3 엣지 페어링 중 해를 찾지 못했습니다.";
    case "444_WASM_UNAVAILABLE":
      return "4×4 WASM 엔진을 불러오지 못했습니다.";
    case "444_TWOPHASE_FAILED":
      return "Reduction 이후 3×3 단계의 해를 찾지 못했습니다.";
    case "444_FINAL_VERIFICATION_FAILED":
      return "생성된 수열이 96-facelet 최종 검증을 통과하지 못했습니다.";
    case "444_WORKER_BOOT_TIMEOUT":
      return "4×4 Worker 준비가 지연되어 새 Worker로 다시 연결하지 못했습니다.";
    case "444_WORKER_BOOT_ERROR":
    case "444_WORKER_MESSAGE_ERROR":
      return "4×4 Worker를 불러오지 못했습니다. 새 버전으로 다시 연결해 주세요.";
    case "444_WORKER_FAILED":
      return "4×4 솔버 Worker 실행 중 오류가 발생했습니다.";
    case "NO_SCRAMBLE":
      return "먼저 4×4 스크램블을 준비해 주세요.";
    default:
      return reason ? `4×4 해를 찾지 못했습니다: ${reason}` : "4×4 해를 찾지 못했습니다.";
  }
}

function copyText(text) {
  const value = String(text || "");
  if (!value) return Promise.resolve(false);
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value).then(() => true, () => false);
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch (_) {
    copied = false;
  }
  textarea.remove();
  return Promise.resolve(copied);
}

function createWorkerClient(forceReload = false) {
  const workerUrl = new URL("./solverWorker.js", import.meta.url);
  workerUrl.searchParams.set("v", WORKER_BUILD_TOKEN);
  if (forceReload) workerUrl.searchParams.set("reload", String(Date.now()));
  const worker = new Worker(workerUrl, { type: "module" });
  const api = wrap(worker);
  return { worker, api };
}

function withUiTimeout(promise, timeoutMs, reason, signal) {
  return new Promise((resolve, reject) => {
    const finish = (callback, value) => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, signal.reason);
    const timer = window.setTimeout(() => finish(reject, new Error(reason)), timeoutMs);
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

function waitForWorkerPing(client, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      client.worker.removeEventListener("error", onError);
      client.worker.removeEventListener("messageerror", onMessageError);
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onError = () => finish(reject, new Error("444_WORKER_BOOT_ERROR"));
    const onMessageError = () => finish(reject, new Error("444_WORKER_MESSAGE_ERROR"));
    const onAbort = () => finish(reject, signal.reason);
    const timer = window.setTimeout(
      () => finish(reject, new Error("444_WORKER_BOOT_TIMEOUT")),
      WORKER_BOOT_TIMEOUT_MS,
    );
    client.worker.addEventListener("error", onError);
    client.worker.addEventListener("messageerror", onMessageError);
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(client.api.ping()).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

export function installSolver444UiActivation() {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (window[INSTALL_KEY]) return true;

  const eventSelect = document.getElementById("eventSelect");
  const scrambleText = document.getElementById("scrambleText");
  const scramblePreview = document.getElementById("scramblePreview");
  const findSolutionBtn = document.getElementById("findSolutionBtn");
  const solverStatus = document.getElementById("solverStatus");
  const solverSolution = document.getElementById("solverSolution");
  const solverMoveCount = document.getElementById("solverMoveCount");
  const solverCopyBtn = document.getElementById("solverCopyBtn");
  const solverVisualPanel = document.getElementById("solverVisualPanel");
  const solverTwistyHost = document.getElementById("solverTwistyHost");
  const solverStepLabel = document.getElementById("solverStepLabel");
  const solverStepResetBtn = document.getElementById("solverStepResetBtn");
  const solverStepPrevBtn = document.getElementById("solverStepPrevBtn");
  const solverPlayBtn = document.getElementById("solverPlayBtn");
  const solverStepNextBtn = document.getElementById("solverStepNextBtn");
  const solverStageList = document.getElementById("solverStageList");
  const solveTitle = document.getElementById("solveTitle");
  const crossColorSelect = document.getElementById("crossColorSelect");
  const solver444MethodField = document.getElementById("solver444MethodField");
  const solver444MethodSelect = document.getElementById("solver444MethodSelect");

  if (
    !eventSelect ||
    !scrambleText ||
    !scramblePreview ||
    !findSolutionBtn ||
    !solverStatus ||
    !solverSolution ||
    !solverMoveCount ||
    !solverCopyBtn ||
    !solverVisualPanel ||
    !solverTwistyHost ||
    !solverStepLabel ||
    !solverStepResetBtn ||
    !solverStepPrevBtn ||
    !solverPlayBtn ||
    !solverStepNextBtn ||
    !solverStageList
  ) {
    return false;
  }

  window[INSTALL_KEY] = true;

  const threeByThreeOnly = [
    document.getElementById("solverModeSelect")?.closest("label"),
    document.getElementById("fmcQualityField"),
    document.getElementById("solverVersionSelect")?.closest("label"),
    document.getElementById("f2lMethodSelect")?.closest("label"),
    document.querySelector(".solver-style-row"),
    document.getElementById("styleProfileMeta"),
  ].filter(Boolean);

  const previousHidden = new Map();
  const hiddenHostChildren = new Map();
  let worker = null;
  let solverApi = null;
  let activeRun = null;
  let solution = "";
  let moves = [];
  let moveIndex = 0;
  let playbackRaf = 0;
  let playbackPlaying = false;
  let playbackStartWallMs = 0;
  let playbackStartTimelineMs = 0;
  const PLAYBACK_TEMPO_SCALE = 1.7;
  let player = null;
  let playerScramble = "";
  let lastStatusText = "";
  let lastSolutionText = "";
  let lastMoveCountText = "";

  const is444 = () => eventSelect.value === EVENT_ID;
  function currentScramble() {
    if (scramblePreview.getAttribute("event") !== EVENT_ID) return "";
    const scramble = normalizeScramble(scramblePreview.getAttribute("scramble"));
    return scramble === normalizeScramble(scrambleText.textContent) ? scramble : "";
  }
  const ownsPlayback = () => is444() && moves.length > 0 && player !== null;

  function setStatus(text) {
    const value = String(text || "");
    solverStatus.textContent = value;
    lastStatusText = value;
  }

  function stopPlayback() {
    if (playbackRaf) window.cancelAnimationFrame(playbackRaf);
    playbackRaf = 0;
    playbackPlaying = false;
    solverPlayBtn.dataset.playing = "false";
    solverPlayBtn.title = "자동 재생";
    player?.pause?.();
  }

  function restoreHostChildren() {
    for (const [element, state] of hiddenHostChildren) {
      if (!element.isConnected) continue;
      element.hidden = state.hidden;
      element.style.display = state.display;
    }
    hiddenHostChildren.clear();
  }

  function removeOwnedPlayer() {
    stopPlayback();
    if (player) {
      player.pause?.();
      player.remove();
    }
    player = null;
    playerScramble = "";
    restoreHostChildren();
  }

  function hideExistingPlayers() {
    for (const child of Array.from(solverTwistyHost.children)) {
      if (child === player || hiddenHostChildren.has(child)) continue;
      hiddenHostChildren.set(child, {
        hidden: child.hidden,
        display: child.style.display,
      });
      child.hidden = true;
      child.style.display = "none";
    }
  }

  function ensurePlayer(scramble) {
    if (player && playerScramble === scramble) return player;
    removeOwnedPlayer();
    player = new TwistyPlayer({
      puzzle: PUZZLE_ID,
      visualization: "3D",
      background: "none",
      controlPanel: "none",
      hintFacelets: "none",
      experimentalSetupAnchor: "start",
    });
    player.dataset.solver444Ui = "true";
    player.style.width = "100%";
    player.style.height = "100%";
    player.experimentalSetupAlg = scramble;
    player.alg = "";
    player.timestamp = "end";
    player.pause();
    playerScramble = scramble;
    hideExistingPlayers();
    solverTwistyHost.appendChild(player);
    return player;
  }

  function moveDurationTimelineMs(move) {
    return String(move || "").includes("2") ? 1500 : 1000;
  }

  function timelineMsForMoveIndex(index) {
    let total = 0;
    const end = Math.max(0, Math.min(moves.length, Math.floor(Number(index) || 0)));
    for (let i = 0; i < end; i += 1) total += moveDurationTimelineMs(moves[i]);
    return total;
  }

  function moveIndexForTimelineMs(timestampMs) {
    const target = Math.max(0, Number(timestampMs) || 0);
    let total = 0;
    let index = 0;
    while (index < moves.length) {
      total += moveDurationTimelineMs(moves[index]);
      if (target < total) break;
      index += 1;
    }
    return index;
  }

  function updatePlaybackControlsOnly() {
    solverStepLabel.textContent = `${moveIndex}/${moves.length} 수`;
    solverStepResetBtn.disabled = moveIndex === 0;
    solverStepPrevBtn.disabled = moveIndex === 0;
    solverStepNextBtn.disabled = moveIndex >= moves.length;
    solverPlayBtn.disabled = moves.length === 0;
  }

  function loadFullPlaybackTimeline() {
    if (!player) return;
    player.experimentalSetupAlg = playerScramble;
    player.alg = solution;
    player.tempoScale = PLAYBACK_TEMPO_SCALE;
  }

  function updateFrame() {
    if (!player) return;
    loadFullPlaybackTimeline();
    player.timestamp = timelineMsForMoveIndex(moveIndex);
    player.pause();
    updatePlaybackControlsOnly();
  }

  function setMoveIndex(nextIndex) {
    moveIndex = Math.max(0, Math.min(moves.length, Math.floor(Number(nextIndex) || 0)));
    updateFrame();
    if (moveIndex >= moves.length) stopPlayback();
  }

  function tickPlayback(now) {
    if (!playbackPlaying || !player || !is444()) {
      stopPlayback();
      return;
    }
    const timelineMs = playbackStartTimelineMs
      + Math.max(0, now - playbackStartWallMs) * PLAYBACK_TEMPO_SCALE;
    const nextIndex = moveIndexForTimelineMs(timelineMs);
    if (nextIndex !== moveIndex) {
      moveIndex = nextIndex;
      updatePlaybackControlsOnly();
    }
    if (moveIndex >= moves.length) {
      moveIndex = moves.length;
      updatePlaybackControlsOnly();
      stopPlayback();
      return;
    }
    playbackRaf = window.requestAnimationFrame(tickPlayback);
  }

  function togglePlayback() {
    if (!ownsPlayback()) return;
    if (playbackPlaying) {
      stopPlayback();
      updatePlaybackControlsOnly();
      return;
    }
    if (moveIndex >= moves.length) moveIndex = 0;
    loadFullPlaybackTimeline();
    const startTimeline = timelineMsForMoveIndex(moveIndex);
    player.timestamp = startTimeline;
    player.tempoScale = PLAYBACK_TEMPO_SCALE;
    playbackStartTimelineMs = startTimeline;
    playbackStartWallMs = performance.now();
    playbackPlaying = true;
    solverPlayBtn.dataset.playing = "true";
    solverPlayBtn.title = "정지";
    updatePlaybackControlsOnly();
    player.play({ autoSkipToOtherEndIfStartingAtBoundary: false });
    playbackRaf = window.requestAnimationFrame(tickPlayback);
  }

  function clearOwnedStages() {
    solverStageList
      .querySelectorAll("[data-solver444-ui='true']")
      .forEach((element) => element.remove());
  }

  function renderStageItem(stage, { substage = false } = {}) {
    const item = document.createElement("li");
    item.dataset.solver444Ui = "true";
    if (substage) {
      item.dataset.solver444Substage = "true";
      item.style.marginLeft = "1.25rem";
      item.style.borderLeftWidth = "2px";
    }
    const title = document.createElement("strong");
    title.textContent = stage?.method === "Yau"
      ? "Yau Setup"
      : STAGE_LABELS[stage?.id] || String(stage?.name || stage?.id || "단계");
    const count = document.createElement("span");
    const moveCount = Number.isFinite(stage?.moveCount) ? stage.moveCount : splitMoves(stage?.solution).length;
    const detail = stage?.alreadyPaired === true
      ? " · 이미 페어링"
      : stage?.technique === "align-then-close"
        ? ` · 역슬라이스로 ${stage.alignedPairs}쌍 결합`
        : stage?.technique === "pair-park-close"
          ? ` · 슬라이스 ${stage.pairedOnOpen}쌍 + 복원 ${stage.pairedOnClose}쌍`
          : "";
    count.textContent = ` ${moveCount}수${detail}${stage?.verified === true ? " · 검증됨" : ""}`;
    const algorithm = document.createElement("code");
    algorithm.textContent = String(stage?.solution || "").trim() || "0수";
    item.append(title, count, algorithm);
    solverStageList.appendChild(item);
  }

  function renderStages(stages) {
    solverStageList.textContent = "";
    for (const stage of Array.isArray(stages) ? stages : []) {
      const segments = Array.isArray(stage?.segments) ? stage.segments : [];
      const summary = segments.length
        ? { ...stage, solution: `${segments.length}개 세부 단계` }
        : stage;
      renderStageItem(summary);
      for (const segment of segments) {
        renderStageItem(segment, { substage: true });
      }
    }
  }

  function resetResultPresentation() {
    stopPlayback();
    removeOwnedPlayer();
    solution = "";
    moves = [];
    moveIndex = 0;
    clearOwnedStages();
    solverVisualPanel.hidden = true;
    solverStepLabel.textContent = "0/0 수";
    solverPlayBtn.disabled = true;
    solverCopyBtn.disabled = true;
    solverSolution.textContent = "-";
    solverMoveCount.textContent = "0 수";
    lastSolutionText = "-";
    lastMoveCountText = "0 수";
  }

  function renderSuccess(result, scramble) {
    solution = String(result.solution || "").trim();
    moves = splitMoves(solution);
    moveIndex = 0;
    const moveCount = Number(result.moveCount) || moves.length;
    solverSolution.textContent = solution;
    solverMoveCount.textContent = `${moveCount} 수`;
    lastSolutionText = solution;
    lastMoveCountText = `${moveCount} 수`;
    solverCopyBtn.disabled = false;
    renderStages(result.stages);
    ensurePlayer(scramble);
    solverVisualPanel.hidden = false;
    updateFrame();
    const methodLabel = result?.meta?.method444 === "yau" ? "Yau · " : "";
    setStatus(`4×4 ${methodLabel}해를 찾았습니다. ${moveCount}수 · 96-facelet 검증 완료`);
  }

  function renderFailure(result) {
    resetResultPresentation();
    setStatus(reasonLabel(result?.reason || result?.detail));
  }

  function progressText(progress) {
    const stage = String(progress?.stage || "");
    const baseLabel = PROGRESS_LABELS[stage] || String(progress?.stageName || stage || "4×4 탐색");
    const label = stage === "THREE_BY_THREE" && progress?.cfopStageName
      ? `${baseLabel} · ${progress.cfopStageName}`
      : baseLabel;
    if (stage === "YAU_FRAME" && Number.isInteger(progress?.attempt)) {
      return `${label} · ${progress.attempt}번째 시도`;
    }
    if (progress?.type === "444_stage_done") {
      const count = Number(progress?.moveCount);
      return Number.isFinite(count) && count > 0 ? `${label} 완료 · ${count}수` : `${label} 완료`;
    }
    if (progress?.type === "444_stage_fail") {
      return `${label} 실패 · ${progress?.reason || "알 수 없는 오류"}`;
    }
    if (progress?.type === "444_state_validated") {
      return "4×4 스크램블과 96-facelet 상태 검증 완료";
    }
    if (progress?.phase === "wasm_ready") {
      return "4×4 WASM 엔진 준비 완료";
    }
    return `${label} 진행 중...`;
  }

  async function ensureWorker(signal) {
    if (worker && solverApi) return solverApi;
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const client = createWorkerClient(attempt > 0);
      worker = client.worker;
      try {
        const pong = await waitForWorkerPing(client, signal);
        signal.throwIfAborted();
        if (pong?.ok !== true) throw new Error("444_WORKER_BOOT_ERROR");
        solverApi = client.api;
        return solverApi;
      } catch (error) {
        signal.throwIfAborted();
        lastError = error;
        disposeWorker();
      }
    }
    throw lastError || new Error("444_WORKER_BOOT_ERROR");
  }

  function disposeWorker() {
    worker?.terminate();
    worker = null;
    solverApi = null;
  }

  function cancelActiveSolve() {
    if (!activeRun) return;
    activeRun.controller.abort();
    activeRun = null;
    disposeWorker();
  }

  async function solveCurrent444(event) {
    if (!is444()) return;
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
    if (activeRun) return;

    const scramble = currentScramble();
    if (!scramble) {
      setStatus("먼저 4×4 스크램블을 준비해 주세요.");
      syncButton();
      return;
    }

    const run = { scramble, controller: new AbortController() };
    activeRun = run;
    syncButton();
    resetResultPresentation();
    setStatus("4×4 솔버를 준비하고 있습니다...");

    try {
      const api = await ensureWorker(run.controller.signal);
      if (activeRun !== run || !is444()) return;
      setStatus("4×4 Worker 연결 완료 · 엔진을 초기화하고 있습니다...");
      const deadlineTs = Date.now() + SOLVE_TIMEOUT_MS;
      const result = await withUiTimeout(
        api.solve(
          {
          scramble,
          eventId: EVENT_ID,
          deadlineTs,
          crossColor: /^[URFDLB]$/i.test(String(crossColorSelect?.value || "D"))
            ? String(crossColorSelect.value).toUpperCase()
            : "D",
          method444: solver444MethodSelect?.value === "yau" ? "yau" : "reduction",
        },
          proxy((progress) => {
            if (activeRun !== run || !is444()) return;
            setStatus(progressText(progress));
          }),
        ),
        SOLVE_TIMEOUT_MS + WORKER_CALL_GRACE_MS,
        "444_UI_SOLVE_TIMEOUT",
        run.controller.signal,
      );
      if (activeRun !== run || !is444() || currentScramble() !== scramble) return;
      if (result?.ok === true && result?.verified === true && String(result.solution || "").trim()) {
        renderSuccess(result, scramble);
      } else {
        renderFailure(result);
      }
    } catch (error) {
      if (activeRun === run && is444()) {
        const message = String(error?.message || error || "444_WORKER_FAILED");
        const reason = message === "444_UI_SOLVE_TIMEOUT"
          ? "444_DEADLINE_REACHED"
          : message.startsWith("444_WORKER_")
            ? message
            : "444_WORKER_FAILED";
        renderFailure({ reason, detail: message });
        disposeWorker();
      }
    } finally {
      if (activeRun === run) {
        activeRun = null;
        syncButton();
      }
    }
  }

  function setThreeByThreeControlsHidden(hidden) {
    for (const element of threeByThreeOnly) {
      if (hidden) {
        if (!previousHidden.has(element)) previousHidden.set(element, element.hidden);
        element.hidden = true;
      } else if (previousHidden.has(element)) {
        element.hidden = previousHidden.get(element);
        previousHidden.delete(element);
      }
    }
  }

  function clearOwnedPresentationWhenLeaving() {
    stopPlayback();
    removeOwnedPlayer();
    clearOwnedStages();
    if (solverSolution.textContent === lastSolutionText) solverSolution.textContent = "-";
    if (solverMoveCount.textContent === lastMoveCountText) solverMoveCount.textContent = "0 수";
    if (solverStatus.textContent === lastStatusText) {
      solverStatus.textContent = "스크램블이 준비되면 해를 구할 수 있습니다.";
    }
    solverCopyBtn.disabled = true;
    solution = "";
    moves = [];
    moveIndex = 0;
  }

  function syncButton() {
    if (!is444()) return;
    const shouldDisable = Boolean(activeRun) || !currentScramble();
    if (findSolutionBtn.disabled !== shouldDisable) findSolutionBtn.disabled = shouldDisable;
  }

  function syncEventUi() {
    if (is444()) {
      setThreeByThreeControlsHidden(true);
      if (crossColorSelect?.value === "CN") crossColorSelect.value = "D";
      if (solver444MethodField) solver444MethodField.hidden = false;
      if (solveTitle) solveTitle.textContent = "4×4 해 찾기";
      findSolutionBtn.title = solver444MethodSelect?.value === "yau"
        ? "검증된 4×4 Yau 해 찾기"
        : "검증된 4×4 Reduction 해 찾기";
      syncButton();
      return;
    }

    if (solver444MethodField) solver444MethodField.hidden = true;
    cancelActiveSolve();
    disposeWorker();
    setThreeByThreeControlsHidden(false);
    if (solveTitle?.textContent === "4×4 해 찾기") solveTitle.textContent = "해 찾기";
    if (findSolutionBtn.title === "검증된 4×4 해 찾기") findSolutionBtn.title = "해 찾기 시작";
    clearOwnedPresentationWhenLeaving();
  }

  solver444MethodSelect?.addEventListener("change", () => {
    if (!is444()) return;
    cancelActiveSolve();
    resetResultPresentation();
    setStatus("해를 다시 찾을 수 있습니다.");
    findSolutionBtn.title = solver444MethodSelect.value === "yau"
      ? "검증된 4×4 Yau 해 찾기"
      : "검증된 4×4 Reduction 해 찾기";
    syncButton();
  });
  crossColorSelect?.addEventListener("change", () => {
    if (!is444()) return;
    cancelActiveSolve();
    resetResultPresentation();
    setStatus("해를 다시 찾을 수 있습니다.");
    syncButton();
  });
  findSolutionBtn.addEventListener("click", solveCurrent444, true);
  solverCopyBtn.addEventListener("click", (event) => {
    if (!is444() || !solution) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void copyText(solution).then((copied) => {
      setStatus(copied ? "4×4 해법을 복사했습니다." : "해법 복사에 실패했습니다.");
    });
  }, true);
  solverStepResetBtn.addEventListener("click", (event) => {
    if (!ownsPlayback()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    stopPlayback();
    setMoveIndex(0);
  }, true);
  solverStepPrevBtn.addEventListener("click", (event) => {
    if (!ownsPlayback()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    stopPlayback();
    setMoveIndex(moveIndex - 1);
  }, true);
  solverPlayBtn.addEventListener("click", (event) => {
    if (!ownsPlayback()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    togglePlayback();
  }, true);
  solverStepNextBtn.addEventListener("click", (event) => {
    if (!ownsPlayback()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    stopPlayback();
    setMoveIndex(moveIndex + 1);
  }, true);

  eventSelect.addEventListener("change", () => queueMicrotask(syncEventUi), true);
  new MutationObserver(() => queueMicrotask(syncButton)).observe(findSolutionBtn, {
    attributes: true,
    attributeFilter: ["disabled"],
  });
  new MutationObserver(() => {
    if (!is444()) return;
    const scramble = currentScramble();
    if (activeRun && activeRun.scramble !== scramble) {
      cancelActiveSolve();
      setStatus("스크램블이 준비되면 해를 구할 수 있습니다.");
    }
    if (player && playerScramble !== scramble) resetResultPresentation();
    syncButton();
  }).observe(scrambleText, {
    childList: true,
    characterData: true,
    subtree: true,
  });

  queueMicrotask(syncEventUi);
  return true;
}
