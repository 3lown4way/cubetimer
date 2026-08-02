const STORAGE_KEY = "cubeTimerSolverBenchmarkLastRun";

function readStoredRun() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return Array.isArray(parsed?.results) ? parsed : null;
  } catch (_) {
    return null;
  }
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
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)}s`;
}

function setText(node, text) {
  if (node && node.textContent !== text) node.textContent = text;
}

function timingForEntry(entry) {
  const wallMs = Number(entry?.elapsedMs);
  const directMs = Number(entry?.performanceDiagnostics?.benchmarkWorkerSolveMs);
  if (Number.isFinite(directMs) && directMs >= 0) {
    const solverMs = Number.isFinite(wallMs) ? Math.min(wallMs, directMs) : directMs;
    return {
      solverMs,
      wallMs: Number.isFinite(wallMs) ? wallMs : solverMs,
      overheadMs: Number.isFinite(wallMs) ? Math.max(0, wallMs - solverMs) : 0,
      source: "worker",
    };
  }

  const stageTimes = Array.isArray(entry?.stageDiagnostics)
    ? entry.stageDiagnostics
        .map((stage) => Number(stage?.elapsedMs))
        .filter((value) => Number.isFinite(value) && value >= 0)
    : [];
  if (stageTimes.length) {
    const stageMs = stageTimes.reduce((sum, value) => sum + value, 0);
    const solverMs = Number.isFinite(wallMs) ? Math.min(wallMs, stageMs) : stageMs;
    return {
      solverMs,
      wallMs: Number.isFinite(wallMs) ? wallMs : solverMs,
      overheadMs: Number.isFinite(wallMs) ? Math.max(0, wallMs - solverMs) : 0,
      source: "stage_diagnostics",
    };
  }

  const fallbackMs = Number.isFinite(wallMs) ? wallMs : null;
  return {
    solverMs: fallbackMs,
    wallMs: fallbackMs,
    overheadMs: Number.isFinite(fallbackMs) ? 0 : null,
    source: "wall_fallback",
  };
}

function updateSummary(run) {
  const successful = run.results.filter((entry) => entry?.ok === true);
  const timings = successful.map(timingForEntry).filter((timing) => Number.isFinite(timing.solverMs));
  if (!timings.length) return;

  const solverTimes = timings.map((timing) => timing.solverMs);
  const wallTimes = timings.map((timing) => timing.wallMs).filter(Number.isFinite);
  const overheadTimes = timings.map((timing) => timing.overheadMs).filter(Number.isFinite);
  const averageMetric = document.getElementById("averageTimeMetric");
  const medianMetric = document.getElementById("medianTimeMetric");
  const p95Metric = document.getElementById("p95TimeMetric");
  const rangeMetric = document.getElementById("rangeTimeMetric");

  setText(averageMetric?.parentElement?.querySelector(":scope > span"), "평균 솔버 시간");
  setText(averageMetric, formatMs(average(solverTimes)));
  setText(
    medianMetric,
    `중앙값 ${formatMs(percentile(solverTimes, 0.5))} · 전체 평균 ${formatMs(average(wallTimes))}`,
  );
  setText(p95Metric?.parentElement?.querySelector(":scope > span"), "P95 솔버 시간");
  setText(p95Metric, formatMs(percentile(solverTimes, 0.95)));
  setText(
    rangeMetric,
    `전체 P95 ${formatMs(percentile(wallTimes, 0.95))} · 오버헤드 평균 ${formatMs(average(overheadTimes))}`,
  );

  const caption = document.getElementById("resultsCaption");
  if (caption) {
    const base = caption.textContent.replace(/\s*· 시간=솔버 내부 기준.*$/, "");
    setText(caption, `${base} · 시간=솔버 내부 기준`);
  }
}

function updateRows(run) {
  const entries = new Map(run.results.map((entry) => [Number(entry.index), entry]));
  document.querySelectorAll("#resultsBody tr.result-row").forEach((row) => {
    const entry = entries.get(Number(row.dataset.entryIndex));
    const timeCell = row.children[2];
    if (!entry || !timeCell) return;
    const timing = timingForEntry(entry);
    setText(timeCell, formatMs(timing.solverMs));
    const title = `솔버 내부 ${formatMs(timing.solverMs)} · 전체 ${formatMs(timing.wallMs)} · 오버헤드 ${formatMs(timing.overheadMs)}`;
    if (timeCell.title !== title) timeCell.title = title;
    timeCell.dataset.timingSource = timing.source;
  });
}

function makeTimingItem(label, value, key) {
  const item = document.createElement("div");
  item.dataset.benchmarkTiming = key;
  const labelNode = document.createElement("span");
  labelNode.textContent = label;
  const valueNode = document.createElement("strong");
  valueNode.textContent = value;
  item.append(labelNode, valueNode);
  return item;
}

function updateOpenDetail(run) {
  const dialog = document.getElementById("resultDetailDialog");
  if (!dialog?.open) return;
  const title = document.getElementById("resultDetailTitle")?.textContent || "";
  const match = title.match(/^#(\d+)/);
  if (!match) return;
  const entry = run.results.find((item) => Number(item.index) === Number(match[1]));
  const overview = document.querySelector("#resultDetailBody .detail-overview-grid");
  if (!entry || !overview?.firstElementChild) return;

  const timing = timingForEntry(entry);
  const firstItem = overview.firstElementChild;
  setText(firstItem.querySelector("span"), "솔버 시간");
  setText(firstItem.querySelector("strong"), formatMs(timing.solverMs));
  overview.querySelectorAll("[data-benchmark-timing]").forEach((node) => node.remove());
  overview.insertBefore(
    makeTimingItem("전체 시간", formatMs(timing.wallMs), "wall"),
    firstItem.nextSibling,
  );
  overview.insertBefore(
    makeTimingItem("전송·벤치", formatMs(timing.overheadMs), "overhead"),
    firstItem.nextSibling?.nextSibling || null,
  );
}

let refreshScheduled = false;
function scheduleRefresh() {
  if (refreshScheduled) return;
  refreshScheduled = true;
  requestAnimationFrame(() => {
    refreshScheduled = false;
    const run = readStoredRun();
    if (!run) return;
    updateSummary(run);
    updateRows(run);
    updateOpenDetail(run);
  });
}

const observer = new MutationObserver(scheduleRefresh);
observer.observe(document.body, { childList: true, subtree: true, characterData: true });
window.addEventListener("storage", scheduleRefresh);
window.addEventListener("beforeunload", () => observer.disconnect());

function csvEscape(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function exportTimingCsv(event) {
  const run = readStoredRun();
  if (!run?.results?.length) return;
  event.preventDefault();
  event.stopImmediatePropagation();

  const header = [
    "index", "mode", "solver_version", "cross_color", "fmc_quality", "fmc_target", "ok",
    "solver_ms", "wall_ms", "overhead_ms", "timing_source", "move_count", "source", "reason",
    "scramble", "solution", "stages", "solution_display", "progress_events", "stage_diagnostics",
    "performance_diagnostics",
  ];
  const rows = [...run.results]
    .sort((a, b) => Number(a.index) - Number(b.index))
    .map((entry) => {
      const timing = timingForEntry(entry);
      return [
        entry.index, entry.mode, entry.solverVersion, entry.crossColor, entry.fmcQualityMode,
        entry.fmcTargetMoveCount ?? "", entry.ok, timing.solverMs, timing.wallMs, timing.overheadMs,
        timing.source, entry.moveCount ?? "", entry.source, entry.reason, entry.scramble, entry.solution,
        JSON.stringify(entry.parts?.length ? entry.parts : entry.stages || []), entry.solutionDisplay || "",
        JSON.stringify(entry.progressEvents || []), JSON.stringify(entry.stageDiagnostics || []),
        JSON.stringify(entry.performanceDiagnostics || null),
      ];
    });
  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `solver-benchmark_timing_${run.config?.mode || "all"}_${new Date().toISOString().replaceAll(":", "-").slice(0, 19)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

document.getElementById("exportBtn")?.addEventListener("click", exportTimingCsv, true);
window.setTimeout(scheduleRefresh, 0);
