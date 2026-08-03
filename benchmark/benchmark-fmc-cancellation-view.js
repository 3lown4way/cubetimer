const STORAGE_KEY = "cubeTimerSolverBenchmarkLastRun";
const DERIVED_CARD_SELECTOR = "[data-fmc-derived-detail]";
const DETAIL_TEXT_SELECTOR = "[data-fmc-cancellation-text]";

export function splitFmcMoves(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean);
}

function parseInsertionPosition(notes) {
  const match = String(notes || "").match(/(?:위치|position)\s*[:#]?\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function insertionKindFromNotes(notes) {
  return String(notes || "")
    .split(",")[0]
    .trim()
    .replace(/\s*(?:위치|position).*$/i, "");
}

export function collectFmcInsertionData(parts) {
  const rows = Array.isArray(parts) ? parts : [];
  const skeleton = rows.find((part) => /^Skeleton$/i.test(String(part?.name || "").trim()));
  const skeletonMoves = splitFmcMoves(skeleton?.solution);
  const insertions = rows
    .filter((part) => /^Insertion\s+\d+/i.test(String(part?.name || "").trim()))
    .map((part, index) => ({
      index,
      name: String(part?.name || `Insertion ${index + 1}`).trim(),
      kind: insertionKindFromNotes(part?.notes),
      moves: splitFmcMoves(part?.solution),
      position: parseInsertionPosition(part?.notes),
    }))
    .filter((entry) => entry.moves.length);
  return { skeletonMoves, insertions };
}

export function reconstructFmcRawMoves(parts) {
  const { skeletonMoves, insertions } = collectFmcInsertionData(parts);
  if (!skeletonMoves.length) return [];
  const rawMoves = skeletonMoves.slice();
  const positioned = insertions
    .filter((entry) => Number.isFinite(entry.position))
    .sort((a, b) => b.position - a.position || b.index - a.index);
  const unpositioned = insertions.filter((entry) => !Number.isFinite(entry.position));

  positioned.forEach((entry) => {
    const position = Math.max(0, Math.min(skeletonMoves.length, Math.floor(entry.position)));
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
    prefix,
    suffix,
  };
}

export function findCommonPrefixLength(leftMoves, rightMoves) {
  const left = Array.isArray(leftMoves) ? leftMoves : [];
  const right = Array.isArray(rightMoves) ? rightMoves : [];
  let length = 0;
  while (length < left.length && length < right.length && left[length] === right[length]) length += 1;
  return length;
}

export function buildFmcInsertionNarrative(parts, finalSolution) {
  const { skeletonMoves, insertions } = collectFmcInsertionData(parts);
  const finalMoves = splitFmcMoves(finalSolution);
  if (!skeletonMoves.length || !insertions.length || !finalMoves.length) return null;

  const rawMoves = reconstructFmcRawMoves(parts);
  const trace = traceAdjacentCancellation(rawMoves);
  const changedWindow = findChangedWindow(rawMoves, finalMoves);
  const sharedPrefixLength = findCommonPrefixLength(skeletonMoves, finalMoves);
  const insertionMoveCount = insertions.reduce((sum, entry) => sum + entry.moves.length, 0);
  return {
    skeletonMoves,
    insertions,
    insertionMoveCount,
    rawMoves,
    finalMoves,
    rawMoveCount: rawMoves.length,
    finalMoveCount: finalMoves.length,
    cancellationCount: Math.max(0, rawMoves.length - finalMoves.length),
    trace,
    traceMatchesFinal: trace.moves.join(" ") === finalMoves.join(" "),
    changedWindow,
    sharedPrefixLength,
    skeletonTail: skeletonMoves.slice(sharedPrefixLength),
    finalTail: finalMoves.slice(sharedPrefixLength),
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

function cardName(card) {
  return String(card?.querySelector(".stage-card-header > strong")?.textContent || "").trim();
}

function findCard(list, pattern) {
  return Array.from(list?.querySelectorAll(":scope > .stage-card") || [])
    .find((card) => pattern.test(cardName(card))) || null;
}

function setCardTitle(card, title) {
  const node = card?.querySelector(".stage-card-header > strong");
  if (node) node.textContent = title;
}

function setCardNote(card, text) {
  if (!card) return;
  card.querySelector(".stage-note")?.remove();
  card.querySelector(".stage-summary-text")?.remove();
  if (!text) return;
  const note = document.createElement("p");
  note.className = "stage-note";
  note.textContent = text;
  const solution = card.querySelector(".stage-solution");
  card.insertBefore(note, solution || null);
}

function createMoveChip(moveCount) {
  const chips = document.createElement("div");
  chips.className = "stage-card-chips";
  const chip = document.createElement("span");
  chip.className = "detail-chip";
  const label = document.createElement("span");
  label.textContent = "회전";
  const value = document.createElement("b");
  value.textContent = String(moveCount);
  chip.append(label, value);
  chips.appendChild(chip);
  return chips;
}

function createDerivedCard(name, moves = [], note = "") {
  const card = document.createElement("article");
  card.className = "stage-card summary fmc-derived-card";
  card.dataset.fmcDerivedDetail = "true";
  const header = document.createElement("div");
  header.className = "stage-card-header";
  const title = document.createElement("strong");
  title.textContent = name;
  header.append(title, createMoveChip(moves.length));
  card.appendChild(header);
  if (note) setCardNote(card, note);
  if (moves.length) {
    const solution = document.createElement("pre");
    solution.className = "detail-code stage-solution";
    solution.textContent = moves.join(" ");
    card.appendChild(solution);
  }
  return card;
}

function positionDescription(position) {
  if (!Number.isFinite(position)) return "삽입 위치 정보 없음";
  const normalized = Math.max(0, Math.floor(position));
  return normalized === 0
    ? "Skeleton 시작 전에 삽입"
    : `Skeleton ${normalized}회전 뒤에 삽입`;
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
    .fmc-derived-card { border-style: dashed; }
  `;
  document.head.appendChild(style);
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

function renderCancellationDetail(card, narrative) {
  if (!card) return;
  const beforeText = narrative.changedWindow.before.length
    ? narrative.changedWindow.before.join(" ")
    : "∅";
  const afterText = narrative.changedWindow.after.length
    ? narrative.changedWindow.after.join(" ")
    : "∅";
  const processText = narrative.trace.steps.length
    ? narrative.trace.steps.join(" · ")
    : `구간 치환 ${beforeText} → ${afterText}`;

  card.querySelector(".stage-card-chips")?.remove();
  card.querySelector(DETAIL_TEXT_SELECTOR)?.remove();
  setCardNote(
    card,
    `${narrative.rawMoveCount} → ${narrative.finalMoveCount} (-${narrative.cancellationCount}); ${narrative.traceMatchesFinal ? "인접 동일 면 결합으로 Final과 일치" : "추가 구간 치환 포함"}`,
  );

  const content = document.createElement("div");
  content.className = "fmc-cancellation-text";
  content.dataset.fmcCancellationText = "true";
  content.appendChild(createTextLine(
    `변경 구간 (${narrative.changedWindow.start}번째 회전부터)`,
    `${beforeText} → ${afterText}`,
  ));
  content.appendChild(createTextLine(
    narrative.traceMatchesFinal ? "상쇄 과정" : "확인된 인접 상쇄",
    processText,
  ));
  card.appendChild(content);
}

function renderCurrentFmcDetail() {
  const entry = readCurrentEntry();
  if (!entry || entry.mode !== "fmc") return;
  const parts = Array.isArray(entry.parts) && entry.parts.length
    ? entry.parts
    : Array.isArray(entry.stages) ? entry.stages : [];
  const narrative = buildFmcInsertionNarrative(parts, entry.solution);
  if (!narrative) return;

  const section = Array.from(document.querySelectorAll("#resultDetailBody > .detail-section"))
    .find((node) => /FMC 풀이 과정/i.test(String(node.querySelector("h3")?.textContent || "")));
  const list = section?.querySelector(".stage-list");
  if (!list) return;

  const signature = [
    entry.index,
    narrative.skeletonMoves.join(" "),
    narrative.rawMoves.join(" "),
    narrative.finalMoves.join(" "),
  ].join("|");
  if (list.dataset.fmcDetailSignature === signature) return;
  list.dataset.fmcDetailSignature = signature;
  list.querySelectorAll(DERIVED_CARD_SELECTOR).forEach((node) => node.remove());

  const ambiguousP2 = findCard(list, /^P2\s*\/\s*Skeleton 진행$/i);
  ambiguousP2?.remove();

  const skeletonCard = findCard(list, /^Skeleton$/i) || findCard(list, /^Skeleton \(삽입 전\)$/i);
  const leaveCard = findCard(list, /^Leave$/i);
  const cancellationCard = findCard(list, /^Cancellation$/i);
  const finalCard = findCard(list, /^Final$/i);
  const insertionCards = Array.from(list.querySelectorAll(":scope > .stage-card"))
    .filter((card) => /^Insertion\s+\d+/i.test(cardName(card)))
    .sort((left, right) => {
      const a = Number(cardName(left).match(/\d+/)?.[0] || 0);
      const b = Number(cardName(right).match(/\d+/)?.[0] || 0);
      return a - b;
    });

  if (!skeletonCard || !cancellationCard || !finalCard || !insertionCards.length) return;
  setCardTitle(skeletonCard, "Skeleton (삽입 전)");
  const skeletonPart = parts.find((part) => /^Skeleton$/i.test(String(part?.name || "").trim()));
  setCardNote(skeletonCard, `${skeletonPart?.notes || "insertion leave"}; 삽입 전 완전한 skeleton`);

  insertionCards.forEach((card, index) => {
    const insertion = narrative.insertions[index];
    if (!insertion) return;
    setCardNote(
      card,
      [insertion.kind, positionDescription(insertion.position), "위치는 원본 Skeleton 기준"]
        .filter(Boolean)
        .join(" · "),
    );
  });

  const skeletonTailCard = narrative.sharedPrefixLength > 0 && narrative.skeletonTail.length
    ? createDerivedCard(
        "Skeleton tail (삽입 전)",
        narrative.skeletonTail,
        `Final과 공통인 앞 ${narrative.sharedPrefixLength}회전 뒤의 원래 tail`,
      )
    : null;
  const rawCard = createDerivedCard(
    "Insertion 적용식 (상쇄 전)",
    narrative.rawMoves,
    `Skeleton ${narrative.skeletonMoves.length}회전 + insertion ${narrative.insertionMoveCount}회전 = ${narrative.rawMoveCount}회전`,
  );
  const finalTailCard = narrative.sharedPrefixLength > 0 && narrative.finalTail.length
    ? createDerivedCard(
        "Final tail (삽입·상쇄 후)",
        narrative.finalTail,
        `앞 ${narrative.sharedPrefixLength}회전은 Skeleton과 동일`,
      )
    : null;

  renderCancellationDetail(cancellationCard, narrative);
  installStyles();

  const allCards = Array.from(list.querySelectorAll(":scope > .stage-card"));
  const special = new Set([
    skeletonCard,
    leaveCard,
    cancellationCard,
    finalCard,
    ...insertionCards,
  ].filter(Boolean));
  const prefixCards = allCards.filter((card) => !special.has(card));
  list.textContent = "";
  prefixCards.forEach((card) => list.appendChild(card));
  list.appendChild(skeletonCard);
  if (leaveCard) list.appendChild(leaveCard);
  if (skeletonTailCard) list.appendChild(skeletonTailCard);
  insertionCards.forEach((card) => list.appendChild(card));
  list.appendChild(rawCard);
  list.appendChild(cancellationCard);
  if (finalTailCard) list.appendChild(finalTailCard);
  list.appendChild(finalCard);
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
        renderCurrentFmcDetail();
      });
    };
    new MutationObserver(scheduleRender).observe(body, { childList: true, subtree: true });
    new MutationObserver(scheduleRender).observe(
      document.getElementById("resultDetailDialog") || document.body,
      { attributes: true, attributeFilter: ["open"] },
    );
    scheduleRender();
  }
}
