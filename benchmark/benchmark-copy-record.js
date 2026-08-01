const COPY_BUTTON_ID = "resultDetailCopySolutionBtn";
const DETAIL_DIALOG_ID = "resultDetailDialog";
const DETAIL_BODY_ID = "resultDetailBody";
const DETAIL_META_ID = "resultDetailMeta";

const MODE_LABELS = {
  cfop: "CFOP",
  zb: "Pure ZB",
  roux: "Roux",
  fmc: "FMC",
  twophase: "Two-Phase",
  minmove: "minmove HTM",
};

function cleanText(value) {
  return String(value || "").replace(/\r\n?/g, "\n").trim();
}

function cleanAlgorithm(value) {
  return cleanText(value).replace(/\s+/g, " ");
}

export function countBenchmarkMoves(value) {
  const algorithm = cleanAlgorithm(value);
  if (!algorithm || algorithm === "-") return 0;
  return algorithm.split(" ").filter(Boolean).length;
}

function normalizeMoveCount(value, solution) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0
    ? Math.floor(numeric)
    : countBenchmarkMoves(solution);
}

function normalizeStage(stage) {
  const name = cleanText(stage?.name) || "Stage";
  const solution = cleanAlgorithm(stage?.solution);
  return {
    name,
    solution,
    note: cleanText(stage?.note),
    moveCount: normalizeMoveCount(stage?.moveCount, solution),
  };
}

function hasFinalStage(stages) {
  return stages.some((stage) => /^(?:final(?:\s+solution)?|최종\s*해|solution)\b/i.test(stage.name));
}

function inferFailureStage(reason) {
  const normalized = cleanText(reason).toUpperCase();
  const known = ["ZBLL", "ZBLS", "F2L", "XCROSS", "CROSS", "PLL", "OLL", "LSE", "CMLL", "SB", "FB", "EO", "DR"];
  return known.find((stage) => normalized.startsWith(`${stage}_`) || normalized.includes(`\n${stage}_`)) || "";
}

export function formatBenchmarkSolveRecord({
  scramble,
  mode,
  stages = [],
  finalSolution = "",
  failureReason = "",
  failureStage = "",
} = {}) {
  const normalizedScramble = cleanAlgorithm(scramble);
  if (!normalizedScramble) return "";

  const normalizedMode = cleanText(mode).toLowerCase();
  const normalizedStages = stages
    .map(normalizeStage)
    .filter((stage) => stage.name && (stage.solution || stage.note || stage.moveCount === 0));
  const normalizedFinal = cleanAlgorithm(finalSolution);
  const normalizedFailure = cleanText(failureReason);
  const lines = [`Scramble: ${normalizedScramble}`, ""];

  if (normalizedStages.length) {
    normalizedStages.forEach((stage) => {
      if (stage.solution) {
        lines.push(`${stage.name} (${stage.moveCount}회전): ${stage.solution}`);
      } else if (stage.note) {
        lines.push(`${stage.name}: ${stage.note}`);
      } else {
        lines.push(`${stage.name} (0회전): -`);
      }
    });

    if (normalizedMode === "fmc" && normalizedFinal && !hasFinalStage(normalizedStages)) {
      lines.push(`Final Solution (${countBenchmarkMoves(normalizedFinal)}회전): ${normalizedFinal}`);
    }
  } else if (normalizedFinal) {
    const label = MODE_LABELS[normalizedMode] || "Solution";
    lines.push(`${label} (${countBenchmarkMoves(normalizedFinal)}회전): ${normalizedFinal}`);
  }

  if (normalizedFailure) {
    const stage = cleanText(failureStage) || inferFailureStage(normalizedFailure);
    if (lines.at(-1) !== "") lines.push("");
    if (stage) lines.push(`실패 단계: ${stage}`);
    lines.push(`실패 원인: ${normalizedFailure}`);
  }

  return lines.join("\n").trimEnd();
}

function findSection(body, headingPattern) {
  return Array.from(body?.querySelectorAll(":scope > .detail-section") || [])
    .find((section) => headingPattern.test(cleanText(section.querySelector("h3")?.textContent)));
}

function detectMode(metaText) {
  const text = cleanText(metaText);
  if (/Pure ZB|\bZB\b/i.test(text)) return "zb";
  if (/Roux/i.test(text)) return "roux";
  if (/FMC/i.test(text)) return "fmc";
  if (/Two-Phase/i.test(text)) return "twophase";
  if (/minmove/i.test(text)) return "minmove";
  return "cfop";
}

function collectStages(body) {
  const section = findSection(body, /단계별 회전|FMC 풀이 과정/i);
  if (!section) return [];
  return Array.from(section.querySelectorAll(".stage-list > .stage-card:not(.method-stage-placeholder)"))
    .map((card) => {
      const solution = cleanAlgorithm(card.querySelector(".stage-solution")?.textContent);
      const note = cleanText(card.querySelector(".stage-note, .stage-summary-text")?.textContent);
      return {
        name: cleanText(card.querySelector(".stage-card-header > strong")?.textContent) || "Stage",
        solution,
        note,
        moveCount: countBenchmarkMoves(solution),
      };
    })
    .filter((stage) => stage.solution || stage.note);
}

function collectRecordFromDialog() {
  const body = document.getElementById(DETAIL_BODY_ID);
  const meta = document.getElementById(DETAIL_META_ID);
  const scrambleSection = findSection(body, /스크램블/i);
  const finalSection = findSection(body, /최종 해/i);
  const failureSection = findSection(body, /실패|Fallback/i);
  const failureReason = cleanText(failureSection?.querySelector("pre")?.textContent);
  return {
    scramble: cleanAlgorithm(scrambleSection?.querySelector("pre")?.textContent),
    mode: detectMode(meta?.textContent),
    stages: collectStages(body),
    finalSolution: cleanAlgorithm(finalSection?.querySelector("pre")?.textContent),
    failureReason,
    failureStage: inferFailureStage(failureReason),
  };
}

async function writeClipboard(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

export function replaceBenchmarkUnitText(text) {
  return String(text || "")
    .replace(/FMC 목표 수/g, "FMC 목표 회전")
    .replace(/평균 해 길이/g, "평균 회전")
    .replace(/회전 수/g, "회전")
    .replace(/(\d+(?:\.\d+)?)(\s*)수/g, "$1$2회전")
    .replace(/^수$/, "회전");
}

function normalizeVisibleUnits(root = document.body) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    const next = replaceBenchmarkUnitText(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  });

  const button = document.getElementById(COPY_BUTTON_ID);
  const dialog = document.getElementById(DETAIL_DIALOG_ID);
  const record = dialog?.open ? collectRecordFromDialog() : null;
  if (button) {
    if (!button.dataset.copyFeedback) button.textContent = "솔빙 기록 복사";
    button.disabled = dialog?.open ? !record?.scramble : true;
  }
}

async function handleCopyClick(event) {
  const button = event.target?.closest?.(`#${COPY_BUTTON_ID}`);
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();

  const record = collectRecordFromDialog();
  const text = formatBenchmarkSolveRecord(record);
  const copied = await writeClipboard(text);
  button.dataset.copyFeedback = "true";
  button.textContent = copied ? "솔빙 기록 복사됨" : "복사 실패";
  window.setTimeout(() => {
    delete button.dataset.copyFeedback;
    button.textContent = "솔빙 기록 복사";
  }, 1400);
}

function init() {
  document.addEventListener("click", (event) => void handleCopyClick(event), true);
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      normalizeVisibleUnits();
    });
  };
  new MutationObserver(schedule).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["open", "disabled"],
  });
  normalizeVisibleUnits();
}

if (typeof document !== "undefined") init();
