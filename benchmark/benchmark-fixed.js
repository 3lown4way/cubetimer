import { randomScrambleForEvent } from "cubing/scramble";
import { proxy, wrap } from "comlink";

const STORAGE_KEY = "cubeTimerSolverBenchmarkLastRun";
const MAX_STORED_RESULTS = 500;

const elements = {
  mode: document.getElementById("modeSelect"),
  version: document.getElementById("versionSelect"),
  crossColor: document.getElementById("crossColorSelect"),
  runCount: document.getElementById("runCountInput"),
  warmupCount: document.getElementById("warmupCountInput"),
  timeout: document.getElementById("timeoutInput"),
  fmcQualityField: document.getElementById("fmcQualityField"),
  fmcQuality: document.getElementById("fmcQualitySelect"),
  fmcTargetField: document.getElementById("fmcTargetField"),
  fmcTarget: document.getElementById("fmcTargetSelect"),
  customScrambles: document.getElementById("customScramblesInput"),
  run: document.getElementById("runBtn"),
  stop: document.getElementById("stopBtn"),
  export: document.getElementById("exportBtn"),
  clear: document.getElementById("clearBtn"),
  workerStatus: document.getElementById("workerStatus"),
  progressTitle: document.getElementById("progressTitle"),
  progressDetail: document.getElementById("progressDetail"),
  progressBar: document.getElementById("progressBar"),
  progressTrack: document.querySelector(".progress-track"),
  successMetric: document.getElementById("successMetric"),
  successSubmetric: document.getElementById("successSubmetric"),
  averageTimeMetric: document.getElementById("averageTimeMetric"),
  medianTimeMetric: document.getElementById("medianTimeMetric"),
  p95TimeMetric: document.getElementById("p95TimeMetric"),
  rangeTimeMetric: document.getElementById("rangeTimeMetric"),
  averageMovesMetric: document.getElementById("averageMovesMetric"),
  rangeMovesMetric: document.getElementById("rangeMovesMetric"),
  resultsCaption: document.getElementById("resultsCaption"),
  resultsBody: document.getElementById("resultsBody"),
};

const workers = {
  generic: { worker: null, api: null },
  fmc: { worker: null, api: null },
};

let running = false;
let stopRequested = false;
let activeWorkerKind = null;
let benchmarkResults = [];
let activeConfig = null;

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function isFmcMode(mode = elements.mode.value) {
  return mode === "fmc";
}

function workerKindForMode(mode) {
  return isFmcMode(mode) ? "fmc" : "generic";
}

function setWorkerStatus(text, state = "idle") {
  elements.workerStatus.textContent = text;
  elements.workerStatus.dataset.state = state;
}

function setProgress(percent, title, detail) {
  const normalized = Math.min(100, Math.max(0, Number(percent) || 0));
  elements.progressBar.style.width = `${normalized}%`;
  elements.progressTrack?.setAttribute("aria-valuenow", String(Math.round(normalized)));
  if (title) elements.progressTitle.textContent = title;
  if (detail !== undefined) elements.progressDetail.textContent = detail;
}

function updateModeFields() {
  const isFmc = isFmcMode();
  elements.fmcQualityField.hidden = !isFmc;
  elements.fmcTargetField.hidden = !isFmc;
}

function syncFmcQualityDefaults() {
  if (elements.fmcQuality.value === "sweetSpot") {
    elements.fmcTarget.value = "24";
    return;
  }
  if (Number(elements.fmcTarget.value) > 20) elements.fmcTarget.value = "20";
  if (Number(elements.timeout.value) < 105) elements.timeout.value = "120";
}

function readCustomScrambles() {
  return String(elements.customScrambles.value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function readConfig() {
  const customScrambles = readCustomScrambles();
  const timeoutSeconds = clampInteger(elements.timeout.value, 1, 300, 60);
  const config = {
    mode: elements.mode.value,
    solverVersion: elements.version.value,
    crossColor: elements.crossColor.value,
    runCount: customScrambles.length || clampInteger(elements.runCount.value, 1, 1000, 10),
    warmupCount: clampInteger(elements.warmupCount.value, 0, 20, 1),
    timeoutMs: timeoutSeconds * 1000,
    fmcQualityMode: elements.fmcQuality.value,
    fmcTargetMoveCount: clampInteger(elements.fmcTarget.value, 1, 40, 24),
    customScrambles,
    startedAt: new Date().toISOString(),
    humanFmcOnly: elements.mode.value === "fmc",
  };
  elements.runCount.value = String(config.runCount);
  elements.warmupCount.value = String(config.warmupCount);
  elements.timeout.value = String(timeoutSeconds);
  return config;
}

function describeConfig(config) {
  const labels = {
    strict: "CFOP",
    zb: "ZB",
    roux: "Roux",
    twophase: "Two-Phase",
    minmove: "minmove",
    fmc: "FMC Human-only",
  };
  const parts = [labels[config.mode] || config.mode, config.solverVersion, `cross ${config.crossColor}`];
  if (config.mode === "fmc") {
    parts.push(config.fmcQualityMode === "extreme" ? "Extreme" : "Sweet Spot");
    parts.push(`${config.fmcTargetMoveCount}수 목표`);
  }
  return parts.join(" · ");
}

function buildSolvePayload(config, scramble) {
  const payload = {
    scramble,
    eventId: "333",
    crossColor: config.crossColor,
    mode: config.mode,
    solverVersion: config.solverVersion,
    f2lMethod: "legacy",
    enableStyleFallback: true,
    enableOllPllPrediction: true,
    ollPllPredictionWeight: 0.35,
  };
  if (config.mode === "fmc") {
    const defaultBudget = config.fmcQualityMode === "extreme" ? 90000 : 8000;
    payload.fmcQualityMode = config.fmcQualityMode;
    payload.fmcTargetMoveCount = config.fmcTargetMoveCount;
    payload.fmcTimeBudgetMs = Math.max(1000, Math.min(defaultBudget, config.timeoutMs - 2500));
  }
  return payload;
}

async function ensureWorker(mode) {
  const kind = workerKindForMode(mode);
  const slot = workers[kind];
  if (slot.api) {
    activeWorkerKind = kind;
    return slot.api;
  }

  setWorkerStatus(kind === "fmc" ? "FMC human-only Worker 초기화 중" : "Worker 초기화 중", "busy");
  const workerUrl = kind === "fmc"
    ? new URL("./fmcBenchmarkWorker.js", import.meta.url)
    : new URL("../solver/solverWorker.js", import.meta.url);
  slot.worker = new Worker(workerUrl, { type: "module" });
  slot.api = wrap(slot.worker);
  try {
    const ping = await slot.api.ping();
    if (!ping?.ok) throw new Error("WORKER_PING_FAILED");
    activeWorkerKind = kind;
    setWorkerStatus(kind === "fmc" ? "FMC human-only Worker 준비됨" : "Worker 준비됨", "ready");
    return slot.api;
  } catch (error) {
    resetWorker(kind);
    setWorkerStatus("Worker 초기화 실패", "error");
    throw error;
  }
}

function resetWorker(kind) {
  const slot = workers[kind];
  if (!slot) return;
  try {
    slot.worker?.terminate();
  } catch (_) {}
  slot.worker = null;
  slot.api = null;
  if (activeWorkerKind === kind) activeWorkerKind = null;
}

function resetAllWorkers() {
  resetWorker("generic");
  resetWorker("fmc");
}

function formatProgressMessage(progress) {
  if (!progress || typeof progress !== "object") return "탐색 중";
  const stageName = String(progress.stageName || progress.stage || "");
  const stageIndex = Number.isFinite(progress.stageIndex) ? progress.stageIndex + 1 : null;
  const totalStages = Number.isFinite(progress.totalStages) ? progress.totalStages : null;
  const prefix = stageIndex && totalStages ? `[${stageIndex}/${totalStages}] ` : "";

  if (progress.type === "bound_update") {
    const nodes = Number.isFinite(progress.nodes) ? ` · ${progress.nodes.toLocaleString()} nodes` : "";
    return `depth ${progress.bound ?? "?"}${nodes}`;
  }
  if (progress.type === "exact_search_start") {
    return `exact search ${progress.lowerBound ?? "?"}→${progress.upperBoundLength ?? "?"}`;
  }
  if (progress.type === "fallback_start") {
    if (stageName.startsWith("FMC Insertion")) return stageName.replace(/^FMC /, "");
    if (stageName.startsWith("FMC ")) return `탐색 단계: ${stageName.replace(/^FMC /, "")}`;
    return `실제 fallback: ${stageName || "시작"}`;
  }
  if (progress.type === "fallback_done") {
    if (stageName.startsWith("FMC Insertion")) return `${stageName.replace(/^FMC /, "")} 완료`;
    if (stageName.startsWith("FMC ")) return `탐색 단계 완료: ${stageName.replace(/^FMC /, "")}`;
    return `fallback 완료: ${stageName || ""}`;
  }
  if (progress.type === "stage_done") return `${prefix}${stageName || "stage"} 완료`;
  if (progress.type === "stage_start") return `${prefix}${stageName || "stage"}`;
  return `${prefix}${stageName || progress.type || "탐색 중"}`;
}

function isRejectedFallbackResult(result, config) {
  if (config.mode !== "fmc") return false;
  const source = String(result?.source || "");
  return source === "FMC_TWOPHASE_FALLBACK" || result?.fallbackUsed === true || result?.fallbackSource === "TWOPHASE";
}

async function solveOnce(config, scramble, label) {
  const kind = workerKindForMode(config.mode);
  const api = await ensureWorker(config.mode);
  let timeoutId = 0;
  const startedAt = performance.now();
  const onProgress = proxy((progress) => {
    if (!running || stopRequested) return;
    elements.progressDetail.textContent = `${label} · ${formatProgressMessage(progress)}`;
  });
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error("BENCHMARK_TIMEOUT")), config.timeoutMs);
  });

  try {
    const result = await Promise.race([api.solve(buildSolvePayload(config, scramble), onProgress), timeoutPromise]);
    const elapsedMs = Math.max(1, Math.round(performance.now() - startedAt));
    const fallbackRejected = isRejectedFallbackResult(result, config);
    const solution = String(result?.solution || "").trim();
    const moveCount = Number.isFinite(result?.moveCount)
      ? Number(result.moveCount)
      : solution
        ? solution.split(/\s+/).filter(Boolean).length
        : null;
    return {
      ok: result?.ok === true && !fallbackRejected,
      elapsedMs,
      moveCount: Number.isFinite(moveCount) ? moveCount : null,
      source: fallbackRejected ? "REJECTED_TWOPHASE_FALLBACK" : String(result?.source || result?.proofSource || ""),
      reason: fallbackRejected
        ? "NON_HUMAN_FMC_FALLBACK_REJECTED"
        : result?.ok === true
          ? ""
          : String(result?.reason || "UNKNOWN_FAILURE"),
      solution,
    };
  } catch (error) {
    const elapsedMs = Math.max(1, Math.round(performance.now() - startedAt));
    const timedOut = String(error?.message || "") === "BENCHMARK_TIMEOUT";
    if (timedOut) {
      resetWorker(kind);
      setWorkerStatus("시간 초과 후 Worker 재시작", "error");
    }
    return {
      ok: false,
      elapsedMs,
      moveCount: null,
      source: "",
      reason: timedOut ? `TIMEOUT_${config.timeoutMs}MS` : String(error?.message || error || "SOLVER_ERROR"),
      solution: "",
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function generateScrambles(count) {
  const scrambles = [];
  for (let index = 0; index < count; index += 1) {
    scrambles.push((await randomScrambleForEvent("333")).toString());
  }
  return scrambles;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function formatMs(value) {
  if (!Number.isFinite(value)) return "-";
  return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)}s`;
}

function formatMoves(value) {
  return Number.isFinite(value) ? `${Number(value).toFixed(Number.isInteger(value) ? 0 : 2)}수` : "-";
}

function renderSummary() {
  const total = benchmarkResults.length;
  const successful = benchmarkResults.filter((entry) => entry.ok);
  const durations = successful.map((entry) => entry.elapsedMs).filter(Number.isFinite);
  const moves = successful.map((entry) => entry.moveCount).filter(Number.isFinite);
  const successRate = total ? (successful.length / total) * 100 : null;

  elements.successMetric.textContent = Number.isFinite(successRate) ? `${successRate.toFixed(1)}%` : "-";
  elements.successSubmetric.textContent = `${successful.length} / ${total}`;
  elements.averageTimeMetric.textContent = formatMs(average(durations));
  elements.medianTimeMetric.textContent = `중앙값 ${formatMs(percentile(durations, 0.5))}`;
  elements.p95TimeMetric.textContent = formatMs(percentile(durations, 0.95));
  elements.rangeTimeMetric.textContent = durations.length
    ? `범위 ${formatMs(Math.min(...durations))}–${formatMs(Math.max(...durations))}`
    : "범위 -";
  elements.averageMovesMetric.textContent = formatMoves(average(moves));
  elements.rangeMovesMetric.textContent = moves.length
    ? `범위 ${Math.min(...moves)}–${Math.max(...moves)}수`
    : "범위 -";
  elements.export.disabled = total === 0;
  elements.resultsCaption.textContent = activeConfig && total
    ? `${describeConfig(activeConfig)} · ${total}회 측정`
    : "아직 측정된 결과가 없습니다.";
}

function appendResultRow(entry) {
  if (elements.resultsBody.querySelector(".empty-row")) elements.resultsBody.textContent = "";
  const row = document.createElement("tr");
  const values = [entry.index, entry.ok ? "성공" : "실패", formatMs(entry.elapsedMs), entry.moveCount ?? "-"];
  values.forEach((value, index) => {
    const cell = document.createElement("td");
    if (index === 1) {
      const status = document.createElement("span");
      status.className = `status-pill ${entry.ok ? "ok" : "fail"}`;
      status.textContent = String(value);
      status.title = entry.reason || "";
      cell.appendChild(status);
    } else {
      cell.className = "number-cell";
      cell.textContent = String(value);
    }
    row.appendChild(cell);
  });
  const sourceCell = document.createElement("td");
  sourceCell.className = "source-cell";
  sourceCell.textContent = entry.source || entry.reason || "-";
  const scrambleCell = document.createElement("td");
  scrambleCell.className = "scramble-cell";
  scrambleCell.textContent = entry.scramble;
  row.append(sourceCell, scrambleCell);
  elements.resultsBody.appendChild(row);
}

function renderResultsTable() {
  elements.resultsBody.textContent = "";
  if (!benchmarkResults.length) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "벤치마크 결과가 여기에 표시됩니다.";
    row.appendChild(cell);
    elements.resultsBody.appendChild(row);
    return;
  }
  benchmarkResults.forEach(appendResultRow);
}

function setControlsRunning(isRunning) {
  running = isRunning;
  elements.run.disabled = isRunning;
  elements.stop.disabled = !isRunning;
  [
    elements.mode,
    elements.version,
    elements.crossColor,
    elements.runCount,
    elements.warmupCount,
    elements.timeout,
    elements.fmcQuality,
    elements.fmcTarget,
    elements.customScrambles,
  ].forEach((element) => { element.disabled = isRunning; });
}

function saveLastRun() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      config: activeConfig,
      results: benchmarkResults.slice(-MAX_STORED_RESULTS),
      savedAt: new Date().toISOString(),
    }));
  } catch (_) {}
}

function restoreLastRun() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!Array.isArray(parsed?.results)) return;
    activeConfig = parsed.config && typeof parsed.config === "object" ? parsed.config : null;
    benchmarkResults = parsed.results.filter((entry) => entry && typeof entry.scramble === "string").slice(-MAX_STORED_RESULTS);
    renderResultsTable();
    renderSummary();
    if (benchmarkResults.length) {
      setProgress(100, "이전 결과 복원", `${benchmarkResults.length}개 측정 결과를 브라우저 저장소에서 불러왔습니다.`);
    }
  } catch (_) {}
}

async function runBenchmark() {
  if (running) return;
  const config = readConfig();
  activeConfig = config;
  benchmarkResults = [];
  stopRequested = false;
  renderResultsTable();
  renderSummary();
  setControlsRunning(true);
  setWorkerStatus(config.mode === "fmc" ? "FMC human-only 벤치마크 실행 중" : "벤치마크 실행 중", "busy");

  try {
    setProgress(0, "스크램블 준비 중", "측정용 스크램블을 생성하고 있습니다.");
    const measuredScrambles = config.customScrambles.length
      ? config.customScrambles
      : await generateScrambles(config.runCount);
    const warmupScrambles = config.warmupCount ? await generateScrambles(config.warmupCount) : [];
    await ensureWorker(config.mode);

    for (let index = 0; index < warmupScrambles.length; index += 1) {
      if (stopRequested) break;
      const label = `워밍업 ${index + 1}/${warmupScrambles.length}`;
      setProgress(0, label, "워밍업 결과는 통계에 포함하지 않습니다.");
      await solveOnce(config, warmupScrambles[index], label);
    }

    for (let index = 0; index < measuredScrambles.length; index += 1) {
      if (stopRequested) break;
      const runNumber = index + 1;
      const label = `측정 ${runNumber}/${measuredScrambles.length}`;
      setProgress((index / measuredScrambles.length) * 100, label, measuredScrambles[index]);
      const result = await solveOnce(config, measuredScrambles[index], label);
      const entry = { index: runNumber, scramble: measuredScrambles[index], ...result };
      benchmarkResults.push(entry);
      appendResultRow(entry);
      renderSummary();
      saveLastRun();
      setProgress(
        (runNumber / measuredScrambles.length) * 100,
        label,
        result.ok
          ? `${formatMs(result.elapsedMs)} · ${Number.isFinite(result.moveCount) ? `${result.moveCount}수` : "수 미확인"}`
          : `${result.reason} · ${formatMs(result.elapsedMs)}`,
      );
    }

    if (stopRequested) {
      setProgress(
        measuredScrambles.length ? (benchmarkResults.length / measuredScrambles.length) * 100 : 0,
        "사용자 중지",
        `${benchmarkResults.length}회 결과까지 보존했습니다.`,
      );
      setWorkerStatus("중지됨", "idle");
    } else {
      setProgress(100, "벤치마크 완료", `${benchmarkResults.length}회 측정을 완료했습니다.`);
      setWorkerStatus(config.mode === "fmc" ? "FMC human-only Worker 준비됨" : "Worker 준비됨", "ready");
    }
  } catch (error) {
    console.error("Benchmark failed", error);
    setProgress(0, "벤치마크 실패", String(error?.message || error || "알 수 없는 오류"));
    setWorkerStatus("오류 발생", "error");
  } finally {
    setControlsRunning(false);
    saveLastRun();
  }
}

function stopBenchmark() {
  if (!running) return;
  stopRequested = true;
  elements.stop.disabled = true;
  elements.progressDetail.textContent = "현재 Worker를 종료하고 있습니다.";
  if (activeWorkerKind) resetWorker(activeWorkerKind);
  setWorkerStatus("중지 처리 중", "busy");
}

function clearResults() {
  if (running) return;
  benchmarkResults = [];
  activeConfig = null;
  localStorage.removeItem(STORAGE_KEY);
  renderResultsTable();
  renderSummary();
  setProgress(0, "대기 중", "설정을 선택하고 벤치마크를 시작하세요.");
}

function csvEscape(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function exportCsv() {
  if (!benchmarkResults.length || !activeConfig) return;
  const header = [
    "index", "mode", "solver_version", "cross_color", "fmc_quality", "fmc_target",
    "human_fmc_only", "ok", "elapsed_ms", "move_count", "source", "reason", "scramble", "solution",
  ];
  const rows = benchmarkResults.map((entry) => [
    entry.index,
    activeConfig.mode,
    activeConfig.solverVersion,
    activeConfig.crossColor,
    activeConfig.mode === "fmc" ? activeConfig.fmcQualityMode : "",
    activeConfig.mode === "fmc" ? activeConfig.fmcTargetMoveCount : "",
    activeConfig.mode === "fmc",
    entry.ok,
    entry.elapsedMs,
    entry.moveCount ?? "",
    entry.source,
    entry.reason,
    entry.scramble,
    entry.solution,
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const timestamp = new Date().toISOString().replaceAll(":", "-").replace("T", "_").slice(0, 19);
  anchor.href = url;
  anchor.download = `solver-benchmark_${activeConfig.mode}_${timestamp}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

elements.mode.addEventListener("change", updateModeFields);
elements.fmcQuality.addEventListener("change", syncFmcQualityDefaults);
elements.fmcTarget.addEventListener("change", () => {
  if (Number(elements.fmcTarget.value) < 20) elements.fmcQuality.value = "extreme";
  if (elements.fmcQuality.value === "extreme" && Number(elements.timeout.value) < 105) elements.timeout.value = "120";
});
elements.run.addEventListener("click", () => void runBenchmark());
elements.stop.addEventListener("click", stopBenchmark);
elements.clear.addEventListener("click", clearResults);
elements.export.addEventListener("click", exportCsv);
window.addEventListener("beforeunload", resetAllWorkers);

updateModeFields();
restoreLastRun();
