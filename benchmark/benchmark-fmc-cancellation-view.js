const STORAGE_KEY = "cubeTimerSolverBenchmarkLastRun";
const TEXT_MARKER = "[data-fmc-cancellation-text]";

function splitMoves(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean);
}

function parseInsertionPosition(notes) {
  const match = String(notes || "").match(/(?:위치|position)\s*[:#]?\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

export function reconstructFmcRawMoves(parts) {
  const rows = Array.isArray(parts) ? parts : [];
  const skeleton = rows.find((part) => /^Skeleton$/i.test(String(part?.name || "").trim()));
  const skeletonMoves = splitMoves(skeleton?.solution);
  const insertions = rows
    .filter((part) => /^Insertion\s+\d+/i.test(String(part?.name || "").trim()))
    .map((part, index) => ({
      index,
      moves: splitMoves(part?.solution),
      position: parseInsertionPosition(part?.notes),
    }))
    .filter((entry) => entry.moves.length);

  if (!skeletonMoves.length) return [];
  const rawMoves = skeletonMoves.slice();
  const positioned = insertions
    .filter((entry) => Number.isFinite(entry.position))
    .sort((a, b) => b.position - a.position || b.index - a.index);
  const unpositioned = insertions.filter((entry) => !Number.isFinite(entry.position));

  positioned.forEach((entry) => {
    const position = Math.max(0, Math.min(rawMoves.length, Math.floor(entry.position)));
    rawMoves.splice(position, 0, ...entry.moves);
  });
  unpositioned.forEach((entry) => rawMoves.push(...entry.moves));
  return rawMoves;
}

function parseMove(move) {
  const match = /^([A-Za-z]+)(2'?|')?$/.exec(String(move || ""));
  if (!match) return null;
  const suffix = match[2] || "";
  return {
    face: match[1],
    amount: suffix === "'" ? 3 : suffix === "2" || suffix === "2'" ? 2 : 1,
  };
}

function formatMove(face, amount) {
  const normalized = ((amount % 4) + 4) % 4;
  if (!normalized) return "";
  if (normalized === 1) return face;
  if (normalized === 2) return `${face}2`;
  return `${face}'`;
}

export function traceAdjacentCancellation(moves) {
  const stack = [];
  const steps = [];
  for (const token of Array.isArray(moves) ? moves : []) {
    const parsed = parseMove(token);
    const top = stack[stack.length - 1];
    if (!parsed || !top?.parsed || top.parsed.face !== parsed.face) {
      stack.push({ token, parsed });
      continue;
    }
    stack.pop();
    const combinedAmount = (top.parsed.amount + parsed.amount) % 4;
    const combinedToken = formatMove(parsed.face, combinedAmount);
    steps.push(`${top.token} ${token} → ${combinedToken || "∅"}`);
    if (combinedToken) {
      stack.push({ token: combinedToken, parsed: { face: parsed.face, amount: combinedAmount } });
    }
  }
  return { moves: stack.map((entry) => entry.token), steps };
}

export function findChangedWindow(beforeMoves, afterMoves) {
  const before = Array.isArray(beforeMoves) ? beforeMoves : [];
  const after = Array.isArray(afterMoves) ? afterMoves : [];
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1;
  return {
    before: before.slice(prefix, before.length - suffix),
    after: after.slice(prefix, after.length - suffix),
    start: prefix + 1,
  };
}

function readCurrentEntry() {
  try {
    const title = document.getElementById("resultDetailTitle")?.textContent || "";
    const match = title.match(/^#(\d+)/);
    if (!match) return null;
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!Array.isArray(saved?.results)) return null;
    return saved.results.find((entry) => Number(entry?.index) === Number(match[1])) || null;
  } catch (_) {
    return null;
  }
}

function findCancellationCard() {
  return Array.from(document.querySelectorAll("#resultDetailBody .stage-card")).find((card) => {
    const name = card.querySelector(".stage-card-header strong")?.textContent || "";
    return /^Cancellation$/i.test(name.trim());
  }) || null;
}

function createTextLine(label, value) {
  const line = document.createElement("p");
  line.className = "fmc-cancellation-text-line";
  const strong = document.createElement("strong");
  strong.textContent = `${label}: `;
  const code = document.createElement("code");
  code.textContent = value;
  line.append(strong, code);
  return line;
}

function installStyles() {
  if (document.querySelector("style[data-fmc-cancellation-text-style]")) return;
  const style = document.createElement("style");
  style.dataset.fmcCancellationTextStyle = "true";
  style.textContent = `
    .fmc-cancellation-text { margin-top: .55rem; }
    .fmc-cancellation-text-line { margin: .35rem 0; line-height: 1.6; }
    .fmc-cancellation-text-line strong { font-size: .88rem; }
    .fmc-cancellation-text-line code { white-space: normal; word-break: break-word; }
  `;
  document.head.appendChild(style);
}

function renderCurrentCancellation() {
  const entry = readCurrentEntry();
  if (!entry || entry.mode !== "fmc") return;
  const card = findCancellationCard();
  if (!card) return;

  const parts = Array.isArray(entry.parts) && entry.parts.length
    ? entry.parts
    : Array.isArray(entry.stages) ? entry.stages : [];
  const rawMoves = reconstructFmcRawMoves(parts);
  const finalMoves = splitMoves(entry.solution);
  if (!rawMoves.length || !finalMoves.length) return;

  const trace = traceAdjacentCancellation(rawMoves);
  const window = findChangedWindow(rawMoves, finalMoves);
  const beforeText = window.before.length ? window.before.join(" ") : "∅";
  const afterText = window.after.length ? window.after.join(" ") : "∅";
  const traceMatchesFinal = trace.moves.join(" ") === finalMoves.join(" ");
  const processText = trace.steps.length
    ? trace.steps.join(" · ")
    : `구간 치환 ${beforeText} → ${afterText}`;
  const signature = `${beforeText}|${afterText}|${processText}`;
  if (card.dataset.fmcCancellationSignature === signature) return;
  card.dataset.fmcCancellationSignature = signature;

  card.querySelector(".stage-card-chips")?.remove();
  card.querySelector(".stage-note")?.remove();
  card.querySelector(".stage-summary-text")?.remove();
  card.querySelector(TEXT_MARKER)?.remove();
  document.querySelector("#resultDetailBody [data-fmc-cancellation-detail]")?.remove();

  installStyles();
  const content = document.createElement("div");
  content.className = "fmc-cancellation-text";
  content.dataset.fmcCancellationText = "true";
  content.appendChild(createTextLine(
    `변경 구간 (${window.start}번째 수부터)`,
    `${beforeText} → ${afterText}`,
  ));
  content.appendChild(createTextLine(
    traceMatchesFinal ? "소거 과정" : "확인된 인접 소거",
    processText,
  ));
  card.appendChild(content);
}

if (typeof document !== "undefined") {
  const body = document.getElementById("resultDetailBody");
  if (body) {
    let queued = false;
    const scheduleRender = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        renderCurrentCancellation();
      });
    };
    new MutationObserver(scheduleRender).observe(body, { childList: true, subtree: true });
    scheduleRender();
  }
}
