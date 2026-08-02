import { randomScrambleForEvent } from "cubing/scramble";
import { proxy, wrap } from "comlink";
import { enforceBenchmarkNoFallback } from "./benchmark-no-fallback-policy.js";

const STORAGE_KEY = "cubeTimerSolverBenchmarkLastRun";
const MAX_RESULTS = 500;
const MAX_DETAILED_RESULTS = 100;
const MAX_PROGRESS_EVENTS = 240;

const $ = (id) => document.getElementById(id);
const elements = {
  mode: $("modeSelect"),
  version: $("versionSelect"),
  crossColor: $("crossColorSelect"),
  runCount: $("runCountInput"),
  warmupCount: $("warmupCountInput"),
  timeout: $("timeoutInput"),
  fmcQualityField: $("fmcQualityField"),
  fmcQuality: $("fmcQualitySelect"),
  fmcTargetField: $("fmcTargetField"),
  fmcTarget: $("fmcTargetSelect"),
  customScrambles: $("customScramblesInput"),
  run: $("runBtn"),
  stop: $("stopBtn"),
  export: $("exportBtn"),
  clear: $("clearBtn"),
  resetSort: $("resetSortBtn"),
  workerStatus: $("workerStatus"),
  progressTitle: $("progressTitle"),
  progressDetail: $("progressDetail"),
  progressBar: $("progressBar"),
  progressTrack: document.querySelector(".progress-track"),
  successMetric: $("successMetric"),
  successSubmetric: $("successSubmetric"),
  averageTimeMetric: $("averageTimeMetric"),
  medianTimeMetric: $("medianTimeMetric"),
  p95TimeMetric: $("p95TimeMetric"),
  rangeTimeMetric: $("rangeTimeMetric"),
  averageMovesMetric: $("averageMovesMetric"),
  rangeMovesMetric: $("rangeMovesMetric"),
  resultsCaption: $("resultsCaption"),
  resultsBody: $("resultsBody"),
  sortButtons: Array.from(document.querySelectorAll("[data-sort-key]")),
  detailDialog: $("resultDetailDialog"),
  detailTitle: $("resultDetailTitle"),
  detailMeta: $("resultDetailMeta"),
  detailBody: $("resultDetailBody"),
  detailClose: $("resultDetailCloseBtn"),
  detailCloseFooter: $("resultDetailCloseFooterBtn"),
  detailCopySolution: $("resultDetailCopySolutionBtn"),
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
let activeDetailIndex = null;
let sortState = { key: "index", direction: "asc" };

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function safeClone(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.slice(0, 20000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "object" || depth > 7) return String(value);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 160).map((item) => safeClone(item, depth + 1, seen));
  const output = {};
  Object.entries(value).slice(0, 160).forEach(([key, item]) => {
    if (typeof item !== "function") output[key] = safeClone(item, depth + 1, seen);
  });
  return output;
}

function countMoves(solution) {
  return String(solution || "").trim().split(/\s+/).filter(Boolean).length;
}

function formatMs(value) {
  if (!Number.isFinite(value)) return "-";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)}s`;
}

function formatMoves(value) {
  return Number.isFinite(value) ? `${Number(value).toFixed(Number.isInteger(value) ? 0 : 2)}수` : "-";
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
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

function isFmc(mode = elements.mode.value) {
  return mode === "fmc";
}

function updateModeFields() {
  const visible = isFmc();
  elements.fmcQualityField.hidden = !visible;
  elements.fmcTargetField.hidden = !visible;
}

function syncFmcDefaults() {
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
  const timeoutSeconds = clampInt(elements.timeout.value, 1, 300, 60);
  const config = {
    mode: elements.mode.value,
    solverVersion: elements.version.value,
    crossColor: elements.crossColor.value,
    runCount: customScrambles.length || clampInt(elements.runCount.value, 1, 1000, 10),
    warmupCount: clampInt(elements.warmupCount.value, 0, 20, 1),
    timeoutMs: timeoutSeconds * 1000,
    fmcQualityMode: elements.fmcQuality.value,
    fmcTargetMoveCount: clampInt(elements.fmcTarget.value, 1, 40, 24),
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
  if (!config) return "";
  const labels = {
    strict: "CFOP",
    zb: "Pure ZB",
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
  return parts.filter(Boolean).join(" · ");
}

function configForEntry(entry) {
  return {
    mode: entry.mode || activeConfig?.mode || "",
    solverVersion: entry.solverVersion || activeConfig?.solverVersion || "",
    crossColor: entry.crossColor || activeConfig?.crossColor || "",
    fmcQualityMode: entry.fmcQualityMode || activeConfig?.fmcQualityMode || "",
    fmcTargetMoveCount: entry.fmcTargetMoveCount ?? activeConfig?.fmcTargetMoveCount ?? null,
  };
}

function buildPayload(config, scramble) {
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
    const budget = config.fmcQualityMode === "extreme" ? 90000 : 8000;
    payload.fmcQualityMode = config.fmcQualityMode;
    payload.fmcTargetMoveCount = config.fmcTargetMoveCount;
    payload.fmcTimeBudgetMs = Math.max(100, Math.min(budget, Math.max(100, config.timeoutMs - 100)));
  }
  return payload;
}

function workerKind(mode) {
  return mode === "fmc" ? "fmc" : "generic";
}

async function ensureWorker(mode) {
  const kind = workerKind(mode);
  const slot = workers[kind];
  if (slot.api) {
    activeWorkerKind = kind;
    return slot.api;
  }
  setWorkerStatus(kind === "fmc" ? "FMC human-only Worker 초기화 중" : "Worker 초기화 중", "busy");
  const url = kind === "fmc"
    ? new URL("./fmcBenchmarkWorker.js", import.meta.url)
    : new URL("../solver/solverWorker.js", import.meta.url);
  slot.worker = new Worker(url, { type: "module" });
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
  try { slot.worker?.terminate(); } catch (_) {}
  slot.worker = null;
  slot.api = null;
  if (activeWorkerKind === kind) activeWorkerKind = null;
}

function resetWorkers() {
  resetWorker("generic");
  resetWorker("fmc");
}

function formatProgressEvent(progress) {
  if (!progress || typeof progress !== "object") return "탐색 중";
  const name = String(progress.stageName || progress.stage || "");
  const index = Number.isFinite(progress.stageIndex) ? progress.stageIndex + 1 : null;
  const total = Number.isFinite(progress.totalStages) ? progress.totalStages : null;
  const prefix = index && total ? `[${index}/${total}] ` : "";
  if (progress.type === "bound_update") {
    const nodes = Number.isFinite(progress.nodes) ? ` · ${progress.nodes.toLocaleString()} nodes` : "";
    return `depth ${progress.bound ?? "?"}${nodes}`;
  }
  if (progress.type === "exact_search_start") return `exact search ${progress.lowerBound ?? "?"}→${progress.upperBoundLength ?? "?"}`;
  if (progress.type === "quality_stage_start") return `${name || "FMC Extreme"} 탐색`;
  if (progress.type === "quality_stage_done") return `${name || "FMC Extreme"} 완료`;
  if (progress.type === "insertion_start") return `${name || "FMC Insertion"} 탐색`;
  if (progress.type === "insertion_done") return `${name || "FMC Insertion"} 완료`;
  if (progress.type === "optimality_proven") return `최적성 증명 · ${progress.moveCount ?? "?"}수`;
  if (progress.type === "fallback_start") {
    if (name.startsWith("FMC Insertion")) return name.replace(/^FMC /, "");
    if (name.startsWith("FMC ")) return `탐색 단계: ${name.replace(/^FMC /, "")}`;
    return `fallback: ${name || "시작"}`;
  }
  if (progress.type === "fallback_done") return `${name || "fallback"} 완료`;
  if (progress.type === "stage_start") return `${prefix}${name || "stage"}`;
  if (progress.type === "stage_done") return `${prefix}${name || "stage"} 완료`;
  if (progress.type === "stage_fail") return `${prefix}${name || "stage"} 실패`;
  return `${prefix}${name || progress.type || "탐색 중"}`;
}

async function solveOnce(config, scramble, label) {
  const kind = workerKind(config.mode);
  const api = await ensureWorker(config.mode);
  const startedAt = performance.now();
  const progressEvents = [];
  let timeoutId = 0;
  const onProgress = proxy((progress) => {
    const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
    if (progressEvents.length < MAX_PROGRESS_EVENTS) {
      progressEvents.push({ ...safeClone(progress), elapsedMs, message: formatProgressEvent(progress) });
    }
    if (running && !stopRequested) elements.progressDetail.textContent = `${label} · ${formatProgressEvent(progress)}`;
  });
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error("BENCHMARK_TIMEOUT")), config.timeoutMs);
  });

  try {
    const result = await Promise.race([api.solve(buildPayload(config, scramble), onProgress), timeoutPromise]);
    const elapsedMs = Math.max(1, Math.round(performance.now() - startedAt));
    const policyResult = enforceBenchmarkNoFallback({ config, scramble, result });
    const fallbackRejected = !policyResult.ok;
    const solution = String(result?.solution || "").trim();
    const moveCount = Number.isFinite(result?.moveCount) ? Number(result.moveCount) : solution ? countMoves(solution) : null;
    return {
      ok: result?.ok === true && !fallbackRejected,
      elapsedMs,
      moveCount: Number.isFinite(moveCount) ? moveCount : null,
      source: fallbackRejected ? policyResult.source : String(result?.source || result?.proofSource || ""),
      reason: fallbackRejected
        ? policyResult.reason
        : result?.ok === true ? "" : String(result?.reason || "UNKNOWN_FAILURE"),
      solution,
      solutionDisplay: String(result?.solutionDisplay || ""),
      stages: safeClone(Array.isArray(result?.stages) ? result.stages : []),
      parts: safeClone(Array.isArray(result?.parts) ? result.parts : []),
      stageDiagnostics: safeClone(Array.isArray(result?.stageDiagnostics) ? result.stageDiagnostics : []),
      performanceDiagnostics: safeClone(result?.performanceDiagnostics || null),
      progressEvents,
      attempts: Number.isFinite(result?.attempts) ? result.attempts : null,
      nodes: Number.isFinite(result?.nodes) ? result.nodes : null,
      bound: Number.isFinite(result?.bound) ? result.bound : null,
      lowerBound: Number.isFinite(result?.lowerBound) ? result.lowerBound : null,
      upperBoundLength: Number.isFinite(result?.upperBoundLength) ? result.upperBoundLength : null,
      optimalityProven: result?.optimalityProven === true,
      proofSource: String(result?.proofSource || ""),
      fallbackReason: String(result?.fallbackReason || ""),
      fallbackFrom: String(result?.fallbackFrom || ""),
      selectedCrossColor: String(result?.selectedCrossColor || ""),
      qualityMode: String(result?.qualityMode || ""),
      qualityTarget: Number.isFinite(result?.qualityTarget) ? result.qualityTarget : null,
      qualityTargetReached: result?.qualityTargetReached === true,
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
      solutionDisplay: "",
      stages: [],
      parts: [],
      stageDiagnostics: [],
      performanceDiagnostics: null,
      progressEvents,
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function generateScrambles(count) {
  const output = [];
  for (let index = 0; index < count; index += 1) output.push((await randomScrambleForEvent("333")).toString());
  return output;
}

function renderSummary() {
  const successful = benchmarkResults.filter((entry) => entry.ok);
  const durations = successful.map((entry) => entry.elapsedMs).filter(Number.isFinite);
  const moves = successful.map((entry) => entry.moveCount).filter(Number.isFinite);
  const rate = benchmarkResults.length ? (successful.length / benchmarkResults.length) * 100 : null;
  elements.successMetric.textContent = Number.isFinite(rate) ? `${rate.toFixed(1)}%` : "-";
  elements.successSubmetric.textContent = `${successful.length} / ${benchmarkResults.length}`;
  elements.averageTimeMetric.textContent = formatMs(average(durations));
  elements.medianTimeMetric.textContent = `중앙값 ${formatMs(percentile(durations, 0.5))}`;
  elements.p95TimeMetric.textContent = formatMs(percentile(durations, 0.95));
  elements.rangeTimeMetric.textContent = durations.length
    ? `범위 ${formatMs(Math.min(...durations))}–${formatMs(Math.max(...durations))}` : "범위 -";
  elements.averageMovesMetric.textContent = formatMoves(average(moves));
  elements.rangeMovesMetric.textContent = moves.length ? `범위 ${Math.min(...moves)}–${Math.max(...moves)}수` : "범위 -";
  elements.export.disabled = benchmarkResults.length === 0;
  elements.resultsCaption.textContent = activeConfig && benchmarkResults.length
    ? `${describeConfig(activeConfig)} · ${benchmarkResults.length}회 측정` : "아직 측정된 결과가 없습니다.";
}

function compareNullable(a, b, direction, stringMode = false) {
  const aMissing = a === null || a === undefined || a === "" || (typeof a === "number" && !Number.isFinite(a));
  const bMissing = b === null || b === undefined || b === "" || (typeof b === "number" && !Number.isFinite(b));
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  const result = stringMode ? String(a).localeCompare(String(b), "ko") : Number(a) - Number(b);
  return direction === "asc" ? result : -result;
}

function sortedResults() {
  const { key, direction } = sortState;
  return [...benchmarkResults].sort((a, b) => {
    let result = 0;
    if (key === "status") result = compareNullable(a.ok ? 1 : 0, b.ok ? 1 : 0, direction);
    else if (key === "source") result = compareNullable(a.source || a.reason, b.source || b.reason, direction, true);
    else result = compareNullable(a[key], b[key], direction);
    return result || a.index - b.index;
  });
}

function updateSortHeaders() {
  elements.sortButtons.forEach((button) => {
    const active = button.dataset.sortKey === sortState.key;
    button.dataset.active = String(active);
    const indicator = button.querySelector(".sort-indicator");
    if (indicator) indicator.textContent = active ? (sortState.direction === "asc" ? "↑" : "↓") : "↕";
    const th = button.closest("th");
    if (th) th.setAttribute("aria-sort", active ? (sortState.direction === "asc" ? "ascending" : "descending") : "none");
  });
  elements.resetSort.disabled = sortState.key === "index" && sortState.direction === "asc";
}

function setSort(key) {
  sortState = sortState.key === key
    ? { key, direction: sortState.direction === "asc" ? "desc" : "asc" }
    : { key, direction: "asc" };
  renderResultsTable();
  saveLastRun();
}

function makeCell(text, className = "") {
  const cell = document.createElement("td");
  cell.className = className;
  cell.textContent = text;
  return cell;
}

function renderResultsTable() {
  elements.resultsBody.textContent = "";
  updateSortHeaders();
  if (!benchmarkResults.length) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    const cell = makeCell("벤치마크 결과가 여기에 표시됩니다.");
    cell.colSpan = 7;
    row.appendChild(cell);
    elements.resultsBody.appendChild(row);
    return;
  }
  sortedResults().forEach((entry) => {
    const row = document.createElement("tr");
    row.className = "result-row";
    row.tabIndex = 0;
    row.dataset.entryIndex = String(entry.index);
    row.setAttribute("aria-label", `${entry.index}번 기록 상세 보기`);
    row.appendChild(makeCell(String(entry.index), "number-cell"));

    const statusCell = document.createElement("td");
    const status = document.createElement("span");
    status.className = `status-pill ${entry.ok ? "ok" : "fail"}`;
    status.textContent = entry.ok ? "성공" : "실패";
    status.title = entry.reason || "";
    statusCell.appendChild(status);
    row.appendChild(statusCell);
    row.appendChild(makeCell(formatMs(entry.elapsedMs), "number-cell"));
    row.appendChild(makeCell(Number.isFinite(entry.moveCount) ? String(entry.moveCount) : "-", "number-cell"));
    row.appendChild(makeCell(entry.source || entry.reason || "-", "source-cell"));
    row.appendChild(makeCell(entry.scramble, "scramble-cell"));

    const detailCell = document.createElement("td");
    detailCell.className = "detail-cell";
    const detailButton = document.createElement("button");
    detailButton.type = "button";
    detailButton.className = "detail-button";
    detailButton.textContent = "보기";
    detailButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openResultDetail(entry.index);
    });
    detailCell.appendChild(detailButton);
    row.appendChild(detailCell);
    row.addEventListener("click", () => openResultDetail(entry.index));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openResultDetail(entry.index);
      }
    });
    elements.resultsBody.appendChild(row);
  });
}

function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== "") node.textContent = String(text);
  return node;
}

function appendCodeSection(parent, title, text, className = "") {
  if (!String(text || "").trim()) return;
  const section = el("section", `detail-section ${className}`.trim());
  section.appendChild(el("h3", "", title));
  section.appendChild(el("pre", "detail-code", text));
  parent.appendChild(section);
}

function findStageDiagnostic(entry, stage, index) {
  const diagnostics = Array.isArray(entry.stageDiagnostics) ? entry.stageDiagnostics : [];
  return diagnostics.find((item) => item?.stageIndex === index)
    || diagnostics.find((item) => String(item?.stageName || "") === String(stage?.name || ""))
    || null;
}

function appendChip(parent, label, value) {
  if (value === null || value === undefined || value === "") return;
  const chip = el("span", "detail-chip");
  chip.append(el("span", "", label), el("b", "", value));
  parent.appendChild(chip);
}

function renderStages(parent, entry) {
  const fmcMode = (entry.mode || activeConfig?.mode) === "fmc";
  const stages = fmcMode && Array.isArray(entry.parts) && entry.parts.length
    ? entry.parts : Array.isArray(entry.stages) ? entry.stages : [];
  if (!stages.length) return;
  const section = el("section", "detail-section");
  section.appendChild(el("h3", "", fmcMode ? "FMC 풀이 과정" : "단계별 회전"));
  if (fmcMode) section.appendChild(el("p", "detail-section-note", "NISS 후보는 원래 스크램블에서 실제로 실행하는 순서로 표시합니다."));
  const list = el("div", "stage-list");
  stages.forEach((stage, index) => {
    const diagnostic = findStageDiagnostic(entry, stage, index);
    const card = el("article", `stage-card${stage?.isSummary ? " summary" : ""}`);
    const header = el("div", "stage-card-header");
    header.appendChild(el("strong", "", stage?.name || `Stage ${index + 1}`));
    const chips = el("div", "stage-card-chips");
    appendChip(chips, "수", Number.isFinite(stage?.moveCount) ? stage.moveCount : stage?.solution ? countMoves(stage.solution) : null);
    appendChip(chips, "시간", Number.isFinite(diagnostic?.elapsedMs) ? formatMs(diagnostic.elapsedMs) : null);
    appendChip(chips, "nodes", Number.isFinite(diagnostic?.nodes) ? diagnostic.nodes.toLocaleString() : null);
    appendChip(chips, "method", diagnostic?.method || null);
    header.appendChild(chips);
    card.appendChild(header);
    if (stage?.notes) card.appendChild(el("p", "stage-note", stage.notes));
    if (stage?.isSummary && !stage?.solution) card.appendChild(el("p", "stage-summary-text", stage?.notes || "요약 단계"));
    if (stage?.solution) card.appendChild(el("pre", "detail-code stage-solution", stage.solution));
    list.appendChild(card);
  });
  section.appendChild(list);
  parent.appendChild(section);
}

function renderProgress(parent, entry) {
  const events = Array.isArray(entry.progressEvents) ? entry.progressEvents : [];
  if (!events.length) return;
  const section = el("section", "detail-section");
  section.appendChild(el("h3", "", "탐색 진행 기록"));
  const list = el("ol", "progress-timeline");
  events.forEach((event) => {
    const item = el("li");
    item.appendChild(el("time", "", formatMs(event.elapsedMs)));
    const content = el("div");
    content.appendChild(el("strong", "", event.message || formatProgressEvent(event)));
    const raw = Object.entries(event)
      .filter(([key]) => !["message", "elapsedMs"].includes(key))
      .map(([key, value]) => `${key}=${typeof value === "object" ? JSON.stringify(value) : value}`)
      .join(" · ");
    if (raw) content.appendChild(el("span", "", raw));
    item.appendChild(content);
    list.appendChild(item);
  });
  section.appendChild(list);
  parent.appendChild(section);
}

function renderDiagnostics(parent, entry) {
  const diagnosticPayload = {
    stageDiagnostics: entry.stageDiagnostics || [],
    performanceDiagnostics: entry.performanceDiagnostics || null,
  };
  if (!diagnosticPayload.stageDiagnostics.length && !diagnosticPayload.performanceDiagnostics) return;
  const section = el("section", "detail-section");
  const details = el("details");
  details.appendChild(el("summary", "", "원시 진단 데이터"));
  details.appendChild(el("pre", "detail-code diagnostics-json", JSON.stringify(diagnosticPayload, null, 2)));
  section.appendChild(details);
  parent.appendChild(section);
}

function openResultDetail(index) {
  const entry = benchmarkResults.find((item) => Number(item.index) === Number(index));
  if (!entry) return;
  activeDetailIndex = entry.index;
  const config = configForEntry(entry);
  elements.detailTitle.textContent = `#${entry.index} 솔빙 상세`;
  elements.detailMeta.textContent = `${describeConfig(config)} · ${entry.ok ? "성공" : "실패"}`;
  elements.detailBody.textContent = "";

  const overview = el("div", "detail-overview-grid");
  [
    ["시간", formatMs(entry.elapsedMs)],
    ["회전 수", formatMoves(entry.moveCount)],
    ["Source", entry.source || "-"],
    ["Cross", entry.selectedCrossColor || entry.crossColor || "-"],
    ["Nodes", Number.isFinite(entry.nodes) ? entry.nodes.toLocaleString() : "-"],
    ["Bound", Number.isFinite(entry.bound) ? entry.bound : "-"],
    ["Attempts", Number.isFinite(entry.attempts) ? entry.attempts : "-"],
    ["최적성", entry.optimalityProven ? "증명됨" : entry.proofSource || "-"],
  ].forEach(([label, value]) => {
    const item = el("div");
    item.append(el("span", "", label), el("strong", "", value));
    overview.appendChild(item);
  });
  elements.detailBody.appendChild(overview);
  appendCodeSection(elements.detailBody, "스크램블", entry.scramble, "scramble-section");
  renderStages(elements.detailBody, entry);
  appendCodeSection(elements.detailBody, "최종 해", entry.solution, "solution-section");
  if ((entry.mode || activeConfig?.mode) === "fmc") {
    appendCodeSection(elements.detailBody, "FMC 상위 후보 및 선택 결과", entry.solutionDisplay, "candidate-section");
  } else if (entry.solutionDisplay && entry.solutionDisplay !== entry.solution) {
    appendCodeSection(elements.detailBody, "솔버 출력", entry.solutionDisplay, "candidate-section");
  }
  if (!entry.ok || entry.reason) {
    appendCodeSection(elements.detailBody, "실패·Fallback 정보", [entry.reason, entry.fallbackReason, entry.fallbackFrom].filter(Boolean).join("\n"), "failure-section");
  }
  renderProgress(elements.detailBody, entry);
  renderDiagnostics(elements.detailBody, entry);
  elements.detailCopySolution.disabled = !entry.solution;
  if (typeof elements.detailDialog.showModal === "function") elements.detailDialog.showModal();
  else elements.detailDialog.setAttribute("open", "");
}

function closeResultDetail() {
  activeDetailIndex = null;
  if (elements.detailDialog.open && typeof elements.detailDialog.close === "function") elements.detailDialog.close();
  else elements.detailDialog.removeAttribute("open");
}

async function copyActiveSolution() {
  const entry = benchmarkResults.find((item) => Number(item.index) === Number(activeDetailIndex));
  if (!entry?.solution) return;
  try {
    await navigator.clipboard.writeText(entry.solution);
    const original = elements.detailCopySolution.textContent;
    elements.detailCopySolution.textContent = "복사됨";
    window.setTimeout(() => { elements.detailCopySolution.textContent = original; }, 1200);
  } catch (_) {}
}

function setControlsRunning(value) {
  running = value;
  elements.run.disabled = value;
  elements.stop.disabled = !value;
  [elements.mode, elements.version, elements.crossColor, elements.runCount, elements.warmupCount,
    elements.timeout, elements.fmcQuality, elements.fmcTarget, elements.customScrambles]
    .forEach((element) => { element.disabled = value; });
}

function compactForStorage(entry, detailed) {
  const compact = {
    ...entry,
    stages: safeClone(entry.stages || []),
    parts: safeClone(entry.parts || []),
    stageDiagnostics: detailed ? safeClone(entry.stageDiagnostics || []) : [],
    performanceDiagnostics: detailed ? safeClone(entry.performanceDiagnostics || null) : null,
    progressEvents: detailed ? safeClone(entry.progressEvents || []) : [],
  };
  return compact;
}

function saveLastRun() {
  const results = benchmarkResults.slice(-MAX_RESULTS);
  const detailedStart = Math.max(0, results.length - MAX_DETAILED_RESULTS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      config: activeConfig,
      sortState,
      results: results.map((entry, index) => compactForStorage(entry, index >= detailedStart)),
      savedAt: new Date().toISOString(),
    }));
  } catch (_) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        config: activeConfig,
        sortState,
        results: results.slice(-100).map((entry) => compactForStorage(entry, false)),
      }));
    } catch (_) {}
  }
}

function restoreLastRun() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!Array.isArray(parsed?.results)) return;
    activeConfig = parsed.config && typeof parsed.config === "object" ? parsed.config : null;
    if (parsed.sortState?.key && ["asc", "desc"].includes(parsed.sortState.direction)) sortState = parsed.sortState;
    benchmarkResults = parsed.results
      .filter((entry) => entry && typeof entry.scramble === "string")
      .map((entry, index) => ({ ...entry, index: Number(entry.index) || index + 1 }))
      .slice(-MAX_RESULTS);
    renderResultsTable();
    renderSummary();
    if (benchmarkResults.length) setProgress(100, "이전 결과 복원", `${benchmarkResults.length}개 결과를 불러왔습니다.`);
  } catch (_) {}
}

async function runBenchmark() {
  if (running) return;
  const config = readConfig();
  activeConfig = config;
  benchmarkResults = [];
  stopRequested = false;
  closeResultDetail();
  renderResultsTable();
  renderSummary();
  setControlsRunning(true);
  setWorkerStatus(config.mode === "fmc" ? "FMC human-only 벤치마크 실행 중" : "벤치마크 실행 중", "busy");

  try {
    setProgress(0, "스크램블 준비 중", "측정용 스크램블을 생성하고 있습니다.");
    const measured = config.customScrambles.length ? config.customScrambles : await generateScrambles(config.runCount);
    const warmups = config.warmupCount ? await generateScrambles(config.warmupCount) : [];
    await ensureWorker(config.mode);

    for (let index = 0; index < warmups.length && !stopRequested; index += 1) {
      const label = `워밍업 ${index + 1}/${warmups.length}`;
      setProgress(0, label, "워밍업 결과는 통계에 포함하지 않습니다.");
      await solveOnce(config, warmups[index], label);
    }

    for (let index = 0; index < measured.length && !stopRequested; index += 1) {
      const runNumber = index + 1;
      const label = `측정 ${runNumber}/${measured.length}`;
      setProgress((index / measured.length) * 100, label, measured[index]);
      const result = await solveOnce(config, measured[index], label);
      benchmarkResults.push({
        index: runNumber,
        scramble: measured[index],
        mode: config.mode,
        solverVersion: config.solverVersion,
        crossColor: config.crossColor,
        fmcQualityMode: config.fmcQualityMode,
        fmcTargetMoveCount: config.fmcTargetMoveCount,
        ...result,
      });
      renderResultsTable();
      renderSummary();
      saveLastRun();
      setProgress((runNumber / measured.length) * 100, label,
        result.ok ? `${formatMs(result.elapsedMs)} · ${formatMoves(result.moveCount)}` : `${result.reason} · ${formatMs(result.elapsedMs)}`);
    }

    if (stopRequested) {
      setProgress(measured.length ? (benchmarkResults.length / measured.length) * 100 : 0,
        "사용자 중지", `${benchmarkResults.length}회 결과까지 보존했습니다.`);
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
  closeResultDetail();
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
  const header = ["index", "mode", "solver_version", "cross_color", "fmc_quality", "fmc_target",
    "ok", "elapsed_ms", "move_count", "source", "reason", "scramble", "solution",
    "stages", "solution_display", "progress_events", "stage_diagnostics", "performance_diagnostics"];
  const rows = sortedResults().map((entry) => [
    entry.index, entry.mode, entry.solverVersion, entry.crossColor, entry.fmcQualityMode,
    entry.fmcTargetMoveCount ?? "", entry.ok, entry.elapsedMs, entry.moveCount ?? "", entry.source,
    entry.reason, entry.scramble, entry.solution,
    JSON.stringify(entry.parts?.length ? entry.parts : entry.stages || []), entry.solutionDisplay || "",
    JSON.stringify(entry.progressEvents || []), JSON.stringify(entry.stageDiagnostics || []),
    JSON.stringify(entry.performanceDiagnostics || null),
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `solver-benchmark_${activeConfig.mode}_${new Date().toISOString().replaceAll(":", "-").slice(0, 19)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

elements.mode.addEventListener("change", updateModeFields);
elements.fmcQuality.addEventListener("change", syncFmcDefaults);
elements.fmcTarget.addEventListener("change", () => {
  if (Number(elements.fmcTarget.value) < 20) elements.fmcQuality.value = "extreme";
  if (elements.fmcQuality.value === "extreme" && Number(elements.timeout.value) < 105) elements.timeout.value = "120";
});
elements.run.addEventListener("click", () => void runBenchmark());
elements.stop.addEventListener("click", stopBenchmark);
elements.clear.addEventListener("click", clearResults);
elements.export.addEventListener("click", exportCsv);
elements.resetSort.addEventListener("click", () => {
  sortState = { key: "index", direction: "asc" };
  renderResultsTable();
  saveLastRun();
});
elements.sortButtons.forEach((button) => button.addEventListener("click", () => setSort(button.dataset.sortKey)));
elements.detailClose.addEventListener("click", closeResultDetail);
elements.detailCloseFooter.addEventListener("click", closeResultDetail);
elements.detailCopySolution.addEventListener("click", () => void copyActiveSolution());
elements.detailDialog.addEventListener("click", (event) => {
  if (event.target === elements.detailDialog) closeResultDetail();
});
elements.detailDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeResultDetail();
});
window.addEventListener("beforeunload", resetWorkers);

updateModeFields();
updateSortHeaders();
restoreLastRun();
