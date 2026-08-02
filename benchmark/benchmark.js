import { randomScrambleForEvent } from "cubing/scramble";
import { proxy, wrap } from "comlink";
import { enforceBenchmarkNoFallback } from "./benchmark-no-fallback-policy.js";

const STORAGE_KEY = "cubeTimerSolverBenchmarkLastRun";
const MAX_STORED_RESULTS = 500;

const modeSelect = document.getElementById("modeSelect");
const versionSelect = document.getElementById("versionSelect");
const crossColorSelect = document.getElementById("crossColorSelect");
const runCountInput = document.getElementById("runCountInput");
const warmupCountInput = document.getElementById("warmupCountInput");
const timeoutInput = document.getElementById("timeoutInput");
const fmcQualityField = document.getElementById("fmcQualityField");
const fmcQualitySelect = document.getElementById("fmcQualitySelect");
const fmcTargetField = document.getElementById("fmcTargetField");
const fmcTargetSelect = document.getElementById("fmcTargetSelect");
const customScramblesInput = document.getElementById("customScramblesInput");
const runBtn = document.getElementById("runBtn");
const stopBtn = document.getElementById("stopBtn");
const exportBtn = document.getElementById("exportBtn");
const clearBtn = document.getElementById("clearBtn");
const workerStatus = document.getElementById("workerStatus");
const progressTitle = document.getElementById("progressTitle");
const progressDetail = document.getElementById("progressDetail");
const progressBar = document.getElementById("progressBar");
const progressTrack = document.querySelector(".progress-track");
const successMetric = document.getElementById("successMetric");
const successSubmetric = document.getElementById("successSubmetric");
const averageTimeMetric = document.getElementById("averageTimeMetric");
const medianTimeMetric = document.getElementById("medianTimeMetric");
const p95TimeMetric = document.getElementById("p95TimeMetric");
const rangeTimeMetric = document.getElementById("rangeTimeMetric");
const averageMovesMetric = document.getElementById("averageMovesMetric");
const rangeMovesMetric = document.getElementById("rangeMovesMetric");
const resultsCaption = document.getElementById("resultsCaption");
const resultsBody = document.getElementById("resultsBody");

let solverWorker = null;
let solverApi = null;
let running = false;
let stopRequested = false;
let benchmarkResults = [];
let activeConfig = null;

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function setWorkerStatus(text, state = "idle") {
  workerStatus.textContent = text;
  workerStatus.dataset.state = state;
}

function setProgress(percent, title, detail) {
  const normalized = Math.min(100, Math.max(0, Number(percent) || 0));
  progressBar.style.width = `${normalized}%`;
  progressTrack?.setAttribute("aria-valuenow", String(Math.round(normalized)));
  if (title) progressTitle.textContent = title;
  if (detail !== undefined) progressDetail.textContent = detail;
}

function updateModeFields() {
  const isFmc = modeSelect.value === "fmc";
  fmcQualityField.hidden = !isFmc;
  fmcTargetField.hidden = !isFmc;
  if (!isFmc) return;
  if (fmcQualitySelect.value === "sweetSpot" && Number(fmcTargetSelect.value) < 20) {
    fmcQualitySelect.value = "extreme";
  }
}

function syncFmcTargetToQuality() {
  if (fmcQualitySelect.value === "sweetSpot") {
    fmcTargetSelect.value = "24";
  } else if (Number(fmcTargetSelect.value) > 20) {
    fmcTargetSelect.value = "20";
  }
}

function readCustomScrambles() {
  return String(customScramblesInput.value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function readConfig() {
  const timeoutSeconds = clampInteger(timeoutInput.value, 1, 300, 60);
  const customScrambles = readCustomScrambles();
  const config = {
    mode: modeSelect.value,
    solverVersion: versionSelect.value,
    crossColor: crossColorSelect.value,
    runCount: customScrambles.length || clampInteger(runCountInput.value, 1, 1000, 10),
    warmupCount: clampInteger(warmupCountInput.value, 0, 20, 1),
    timeoutMs: timeoutSeconds * 1000,
    fmcQualityMode: fmcQualitySelect.value,
    fmcTargetMoveCount: clampInteger(fmcTargetSelect.value, 1, 40, 24),
    customScrambles,
    startedAt: new Date().toISOString(),
  };
  runCountInput.value = String(config.runCount);
  warmupCountInput.value = String(config.warmupCount);
  timeoutInput.value = String(timeoutSeconds);
  return config;
}

function describeConfig(config) {
  const labels = {
    strict: "CFOP",
    zb: "ZB",
    roux: "Roux",
    twophase: "Two-Phase",
    minmove: "minmove",
    fmc: "FMC",
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
    benchmarkNoFallback: true,
    allowRelaxedSearch: false,
    enableStyleFallback: false,
    enableOllPllPrediction: true,
    ollPllPredictionWeight: 0.35,
  };

  if (config.mode === "fmc") {
    const defaultBudget = config.fmcQualityMode === "extreme" ? 90000 : 8000;
    payload.fmcQualityMode = config.fmcQualityMode;
    payload.fmcTargetMoveCount = config.fmcTargetMoveCount;
    payload.fmcTimeBudgetMs = Math.max(
      100,
      Math.min(defaultBudget, Math.max(100, config.timeoutMs - 100)),
    );
  }

  return payload;
}

async function ensureWorker() {
  if (solverApi) return solverApi;
  setWorkerStatus("Worker 초기화 중", "busy");
  solverWorker = new Worker(new URL("../solver/solverWorker.js", import.meta.url), { type: "module" });
  solverApi = wrap(solverWorker);
  try {
    const ping = await solverApi.ping();
    if (!ping?.ok) throw new Error("WORKER_PING_FAILED");
    setWorkerStatus("Worker 준비됨", "ready");
    return solverApi;
  } catch (error) {
    resetWorker();
    setWorkerStatus("Worker 초기화 실패", "error");
    throw error;
  }
}

function resetWorker() {
  try {
    solverWorker?.terminate();
  } catch (_) {}
  solverWorker = null;
  solverApi = null;
}

function formatProgressMessage(progress) {
  if (!progress || typeof progress !== "object") return "탐색 중";
  const stageName = progress.stageName || progress.stage || "";
  const stageIndex = Number.isFinite(progress.stageIndex) ? progress.stageIndex + 1 : null;
  const totalStages = Number.isFinite(progress.totalStages) ? progress.totalStages : null;
  const prefix = stageIndex && totalStages ? `[${stageIndex}/${totalStages}] ` : "";
  if (progress.type === "bound_update") {
    const nodes = Number.isFinite(progress.nodes) ? ` · ${progress.nodes.toLocaleString()} nodes` : "";
    return `depth ${progress.bound ?? "?"}${nodes}`;
  }
  if (progress.type === "fallback_start") return `fallback ${stageName || "시작"}`;
  if (progress.type === "exact_search_start") return `exact search ${progress.lowerBound ?? "?"}→${progress.upperBoundLength ?? "?"}`;
  if (progress.type === "stage_done") return `${prefix}${stageName || "stage"} 완료`;
  if (progress.type === "stage_start") return `${prefix}${stageName || "stage"}`;
  return `${prefix}${stageName || progress.type || "탐색 중"}`;
}

async function solveOnce(config, scramble, label) {
  const api = await ensureWorker();
  let timeoutId = 0;
  const startedAt = performance.now();
  const onProgress = proxy((progress) => {
    if (!running || stopRequested) return;
    progressDetail.textContent = `${label} · ${formatProgressMessage(progress)}`;
  });

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error("BENCHMARK_TIMEOUT")), config.timeoutMs);
  });

  try {
    const result = await Promise.race([
      api.solve(buildSolvePayload(config, scramble), onProgress),
      timeoutPromise,
    ]);
    const elapsedMs = Math.max(1, Math.round(performance.now() - startedAt));
    const policyResult = enforceBenchmarkNoFallback({ config, scramble, result });
    const solution = String(result?.solution || "").trim();
    const moveCount = Number.isFinite(result?.moveCount)
      ? Number(result.moveCount)
      : solution
        ? solution.split(/\s+/).filter(Boolean).length
        : null;
    return {
      ok: result?.ok === true && policyResult.ok,
      elapsedMs,
      moveCount: Number.isFinite(moveCount) ? moveCount : null,
      source: policyResult.ok ? String(result?.source || result?.proofSource || "") : policyResult.source,
      reason: policyResult.ok
        ? (result?.ok === true ? "" : String(result?.reason || "UNKNOWN_FAILURE"))
        : policyResult.reason,
      solution,
    };
  } catch (error) {
    const elapsedMs = Math.max(1, Math.round(performance.now() - startedAt));
    const timedOut = String(error?.message || "") === "BENCHMARK_TIMEOUT";
    if (timedOut) {
      resetWorker();
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
    const generated = await randomScrambleForEvent("333");
    scrambles.push(generated.toString());
  }
  return scrambles;
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function formatMs(value) {
  if (!Number.isFinite(value)) return "-";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)}s`;
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

  successMetric.textContent = Number.isFinite(successRate) ? `${successRate.toFixed(1)}%` : "-";
  successSubmetric.textContent = `${successful.length} / ${total}`;

  const averageTime = average(durations);
  const medianTime = percentile(durations, 0.5);
  const p95Time = percentile(durations, 0.95);
  averageTimeMetric.textContent = formatMs(averageTime);
  medianTimeMetric.textContent = `중앙값 ${formatMs(medianTime)}`;
  p95TimeMetric.textContent = formatMs(p95Time);
  rangeTimeMetric.textContent = durations.length
    ? `범위 ${formatMs(Math.min(...durations))}–${formatMs(Math.max(...durations))}`
    : "범위 -";

  const averageMoves = average(moves);
  averageMovesMetric.textContent = formatMoves(averageMoves);
  rangeMovesMetric.textContent = moves.length
    ? `범위 ${Math.min(...moves)}–${Math.max(...moves)}수`
    : "범위 -";

  exportBtn.disabled = total === 0;
  if (activeConfig && total) {
    resultsCaption.textContent = `${describeConfig(activeConfig)} · ${total}회 측정`;
  } else {
    resultsCaption.textContent = "아직 측정된 결과가 없습니다.";
  }
}

function appendResultRow(entry) {
  if (resultsBody.querySelector(".empty-row")) resultsBody.textContent = "";
  const row = document.createElement("tr");

  const indexCell = document.createElement("td");
  indexCell.className = "number-cell";
  indexCell.textContent = String(entry.index);

  const statusCell = document.createElement("td");
  const status = document.createElement("span");
  status.className = `status-pill ${entry.ok ? "ok" : "fail"}`;
  status.textContent = entry.ok ? "성공" : "실패";
  status.title = entry.ok ? "" : entry.reason;
  statusCell.appendChild(status);

  const timeCell = document.createElement("td");
  timeCell.className = "number-cell";
  timeCell.textContent = formatMs(entry.elapsedMs);

  const movesCell = document.createElement("td");
  movesCell.className = "number-cell";
  movesCell.textContent = Number.isFinite(entry.moveCount) ? String(entry.moveCount) : "-";

  const sourceCell = document.createElement("td");
  sourceCell.className = "source-cell";
  sourceCell.textContent = entry.source || entry.reason || "-";

  const scrambleCell = document.createElement("td");
  scrambleCell.className = "scramble-cell";
  scrambleCell.textContent = entry.scramble;

  row.append(indexCell, statusCell, timeCell, movesCell, sourceCell, scrambleCell);
  resultsBody.appendChild(row);
}

function renderResultsTable() {
  resultsBody.textContent = "";
  if (!benchmarkResults.length) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "벤치마크 결과가 여기에 표시됩니다.";
    row.appendChild(cell);
    resultsBody.appendChild(row);
    return;
  }
  benchmarkResults.forEach(appendResultRow);
}

function setControlsRunning(isRunning) {
  running = isRunning;
  runBtn.disabled = isRunning;
  stopBtn.disabled = !isRunning;
  modeSelect.disabled = isRunning;
  versionSelect.disabled = isRunning;
  crossColorSelect.disabled = isRunning;
  runCountInput.disabled = isRunning;
  warmupCountInput.disabled = isRunning;
  timeoutInput.disabled = isRunning;
  fmcQualitySelect.disabled = isRunning;
  fmcTargetSelect.disabled = isRunning;
  customScramblesInput.disabled = isRunning;
}

function saveLastRun() {
  try {
    const payload = {
      config: activeConfig,
      results: benchmarkResults.slice(-MAX_STORED_RESULTS),
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (_) {}
}

function restoreLastRun() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.results)) return;
    activeConfig = parsed.config && typeof parsed.config === "object" ? parsed.config : null;
    benchmarkResults = parsed.results
      .filter((entry) => entry && typeof entry.scramble === "string")
      .slice(-MAX_STORED_RESULTS);
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
  setWorkerStatus("벤치마크 실행 중", "busy");

  try {
    setProgress(0, "스크램블 준비 중", "측정용 스크램블을 생성하고 있습니다.");
    const measuredScrambles = config.customScrambles.length
      ? config.customScrambles
      : await generateScrambles(config.runCount);
    const warmupScrambles = config.warmupCount ? await generateScrambles(config.warmupCount) : [];

    await ensureWorker();

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
      const percentBefore = (index / measuredScrambles.length) * 100;
      setProgress(percentBefore, label, measuredScrambles[index]);

      const result = await solveOnce(config, measuredScrambles[index], label);
      const entry = {
        index: runNumber,
        scramble: measuredScrambles[index],
        ...result,
      };
      benchmarkResults.push(entry);
      appendResultRow(entry);
      renderSummary();
      saveLastRun();

      const percentAfter = (runNumber / measuredScrambles.length) * 100;
      setProgress(
        percentAfter,
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
      setWorkerStatus("Worker 준비됨", "ready");
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
  stopBtn.disabled = true;
  progressDetail.textContent = "현재 Worker를 종료하고 있습니다.";
  resetWorker();
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
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function exportCsv() {
  if (!benchmarkResults.length || !activeConfig) return;
  const header = [
    "index",
    "mode",
    "solver_version",
    "cross_color",
    "fmc_quality",
    "fmc_target",
    "ok",
    "elapsed_ms",
    "move_count",
    "source",
    "reason",
    "scramble",
    "solution",
  ];
  const rows = benchmarkResults.map((entry) => [
    entry.index,
    activeConfig.mode,
    activeConfig.solverVersion,
    activeConfig.crossColor,
    activeConfig.mode === "fmc" ? activeConfig.fmcQualityMode : "",
    activeConfig.mode === "fmc" ? activeConfig.fmcTargetMoveCount : "",
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

modeSelect.addEventListener("change", updateModeFields);
fmcQualitySelect.addEventListener("change", syncFmcTargetToQuality);
fmcTargetSelect.addEventListener("change", () => {
  if (Number(fmcTargetSelect.value) < 20) fmcQualitySelect.value = "extreme";
});
runBtn.addEventListener("click", () => void runBenchmark());
stopBtn.addEventListener("click", stopBenchmark);
clearBtn.addEventListener("click", clearResults);
exportBtn.addEventListener("click", exportCsv);
window.addEventListener("beforeunload", resetWorker);

updateModeFields();
restoreLastRun();
