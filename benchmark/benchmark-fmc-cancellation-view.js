const STORAGE_KEY = "cubeTimerSolverBenchmarkLastRun";
const SECTION_SELECTOR = "[data-fmc-cancellation-detail]";

function splitMoves(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
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
      name: String(part?.name || `Insertion ${index + 1}`),
      moves: splitMoves(part?.solution),
      position: parseInsertionPosition(part?.notes),
      notes: String(part?.notes || ""),
    }))
    .filter((entry) => entry.moves.length);

  if (!skeletonMoves.length) {
    return { rawMoves: [], skeletonMoves, insertions };
  }

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

  return { rawMoves, skeletonMoves, insertions };
}

export function diffMoves(rawMoves, finalMoves) {
  const left = Array.isArray(rawMoves) ? rawMoves : [];
  const right = Array.isArray(finalMoves) ? finalMoves : [];
  const rows = left.length + 1;
  const cols = right.length + 1;
  const dp = Array.from({ length: rows }, () => new Uint16Array(cols));

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      dp[i][j] = left[i] === right[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const operations = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      operations.push({ type: "equal", token: left[i], rawIndex: i, finalIndex: j });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      operations.push({ type: "delete", token: left[i], rawIndex: i, finalIndex: j });
      i += 1;
    } else {
      operations.push({ type: "insert", token: right[j], rawIndex: i, finalIndex: j });
      j += 1;
    }
  }
  while (i < left.length) {
    operations.push({ type: "delete", token: left[i], rawIndex: i, finalIndex: j });
    i += 1;
  }
  while (j < right.length) {
    operations.push({ type: "insert", token: right[j], rawIndex: i, finalIndex: j });
    j += 1;
  }

  const rawStatus = left.map(() => "removed");
  const finalStatus = right.map(() => "added");
  operations.forEach((operation) => {
    if (operation.type !== "equal") return;
    rawStatus[operation.rawIndex] = "kept";
    finalStatus[operation.finalIndex] = "kept";
  });

  return { operations, rawStatus, finalStatus };
}

export function buildCancellationHunks(operations) {
  const hunks = [];
  let index = 0;
  while (index < operations.length) {
    if (operations[index].type === "equal") {
      index += 1;
      continue;
    }
    const deleted = [];
    const inserted = [];
    const startRawIndex = operations[index].rawIndex;
    while (index < operations.length && operations[index].type !== "equal") {
      const operation = operations[index];
      if (operation.type === "delete") deleted.push(operation.token);
      if (operation.type === "insert") inserted.push(operation.token);
      index += 1;
    }
    hunks.push({
      position: Math.max(0, startRawIndex) + 1,
      deleted,
      inserted,
    });
  }
  return hunks;
}

function createElement(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== "") node.textContent = String(text);
  return node;
}

function renderMoveSequence(label, moves, statuses) {
  const row = createElement("div", "fmc-cancellation-sequence");
  row.appendChild(createElement("strong", "fmc-cancellation-label", label));
  const code = createElement("code", "fmc-cancellation-code");
  moves.forEach((move, index) => {
    if (index) code.appendChild(document.createTextNode(" "));
    const token = createElement("span", `fmc-cancellation-token ${statuses[index] || "kept"}`, move);
    token.title = statuses[index] === "removed"
      ? "Cancellation에서 삭제"
      : statuses[index] === "added"
        ? "결합 또는 치환으로 생성"
        : "최종 해에 유지";
    code.appendChild(token);
  });
  row.appendChild(code);
  return row;
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

function installStyles() {
  if (document.querySelector("style[data-fmc-cancellation-style]")) return;
  const style = document.createElement("style");
  style.dataset.fmcCancellationStyle = "true";
  style.textContent = `
    .fmc-cancellation-detail { border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent); padding-top: 1rem; }
    .fmc-cancellation-summary { margin: .35rem 0 .8rem; opacity: .82; }
    .fmc-cancellation-legend { display: flex; flex-wrap: wrap; gap: .45rem .8rem; margin: 0 0 .75rem; font-size: .86rem; }
    .fmc-cancellation-legend span { display: inline-flex; align-items: center; gap: .32rem; }
    .fmc-cancellation-legend i { width: .85rem; height: .85rem; border-radius: .2rem; display: inline-block; }
    .fmc-cancellation-legend .kept i { background: color-mix(in srgb, #22c55e 25%, transparent); }
    .fmc-cancellation-legend .removed i { background: color-mix(in srgb, #ef4444 25%, transparent); }
    .fmc-cancellation-legend .added i { background: color-mix(in srgb, #3b82f6 25%, transparent); }
    .fmc-cancellation-sequence { display: grid; grid-template-columns: minmax(5.5rem, auto) 1fr; gap: .7rem; align-items: start; margin: .55rem 0; }
    .fmc-cancellation-label { font-size: .9rem; padding-top: .35rem; }
    .fmc-cancellation-code { white-space: normal; word-break: break-word; line-height: 2.05; }
    .fmc-cancellation-token { display: inline-block; padding: .08rem .28rem; border-radius: .25rem; }
    .fmc-cancellation-token.kept { background: color-mix(in srgb, #22c55e 16%, transparent); }
    .fmc-cancellation-token.removed { background: color-mix(in srgb, #ef4444 18%, transparent); text-decoration: line-through; opacity: .78; }
    .fmc-cancellation-token.added { background: color-mix(in srgb, #3b82f6 18%, transparent); font-weight: 700; }
    .fmc-cancellation-hunks { margin: .85rem 0 0; padding-left: 1.4rem; }
    .fmc-cancellation-hunks li { margin: .35rem 0; }
    .fmc-cancellation-hunks code { white-space: normal; word-break: break-word; }
    @media (max-width: 640px) {
      .fmc-cancellation-sequence { grid-template-columns: 1fr; gap: .15rem; }
    }
  `;
  document.head.appendChild(style);
}

function renderCurrentCancellation() {
  const body = document.getElementById("resultDetailBody");
  if (!body || body.querySelector(SECTION_SELECTOR)) return;
  const entry = readCurrentEntry();
  if (!entry || entry.mode !== "fmc") return;

  const parts = Array.isArray(entry.parts) && entry.parts.length
    ? entry.parts
    : Array.isArray(entry.stages) ? entry.stages : [];
  const { rawMoves } = reconstructFmcRawMoves(parts);
  const finalMoves = splitMoves(entry.solution);
  if (!rawMoves.length || !finalMoves.length) return;

  const diff = diffMoves(rawMoves, finalMoves);
  const hunks = buildCancellationHunks(diff.operations);
  const removedCount = diff.rawStatus.filter((status) => status === "removed").length;
  const addedCount = diff.finalStatus.filter((status) => status === "added").length;
  const saving = rawMoves.length - finalMoves.length;

  installStyles();
  const section = createElement("section", "detail-section fmc-cancellation-detail");
  section.dataset.fmcCancellationDetail = "true";
  section.appendChild(createElement("h3", "", "FMC Cancellation 상세"));
  section.appendChild(createElement(
    "p",
    "fmc-cancellation-summary",
    `Cancellation 전 ${rawMoves.length}수 → 최종 ${finalMoves.length}수 (${saving > 0 ? `-${saving}` : saving}수). 삭제 ${removedCount}개, 결합·치환 생성 ${addedCount}개.`,
  ));

  const legend = createElement("div", "fmc-cancellation-legend");
  [["kept", "최종 해에 유지"], ["removed", "삭제"], ["added", "결합·치환 결과"]].forEach(([kind, label]) => {
    const item = createElement("span", kind);
    item.append(createElement("i"), document.createTextNode(label));
    legend.appendChild(item);
  });
  section.appendChild(legend);
  section.appendChild(renderMoveSequence("Cancellation 전", rawMoves, diff.rawStatus));
  section.appendChild(renderMoveSequence("최종 해", finalMoves, diff.finalStatus));

  if (hunks.length) {
    const list = createElement("ol", "fmc-cancellation-hunks");
    hunks.forEach((hunk) => {
      const item = createElement("li");
      const before = hunk.deleted.length ? hunk.deleted.join(" ") : "∅";
      const after = hunk.inserted.length ? hunk.inserted.join(" ") : "∅";
      item.append(
        document.createTextNode(`원수열 ${hunk.position}번째 부근: `),
        createElement("code", "", `${before} → ${after}`),
      );
      list.appendChild(item);
    });
    section.appendChild(list);
  }

  const finalSection = body.querySelector(".solution-section");
  body.insertBefore(section, finalSection || null);
}

function install() {
  const body = document.getElementById("resultDetailBody");
  if (!body) return;
  const observer = new MutationObserver(() => queueMicrotask(renderCurrentCancellation));
  observer.observe(body, { childList: true });
  document.getElementById("resultDetailDialog")?.addEventListener("toggle", renderCurrentCancellation);
  renderCurrentCancellation();
}

if (typeof document !== "undefined") install();
