const dialog = document.getElementById("resultDetailDialog");
const meta = document.getElementById("resultDetailMeta");
const body = document.getElementById("resultDetailBody");

const SCHEMAS = {
  cfop: { label: "CFOP", stages: ["Cross", "F2L 1", "F2L 2", "F2L 3", "F2L 4", "OLL", "PLL"] },
  zb: { label: "Pure ZB", stages: ["Cross", "F2L 1", "F2L 2", "F2L 3", "ZBLS", "ZBLL"] },
  roux: { label: "Roux", stages: ["FB", "SB", "CMLL", "LSE"] },
};

function addStyles() {
  if (document.getElementById("benchmarkMethodStageStyles")) return;
  const style = document.createElement("style");
  style.id = "benchmarkMethodStageStyles";
  style.textContent = `
    .method-stage-sequence{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin:0 0 14px;padding:11px 12px;border:1px solid var(--line);border-radius:13px;background:rgba(31,111,229,.035)}
    .method-stage-sequence-label{margin-right:3px;color:var(--muted);font-size:11px;font-weight:800}
    .method-stage-step{display:inline-flex;align-items:center;min-height:26px;padding:0 8px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:10px;font-weight:800;white-space:nowrap}
    .method-stage-step.present{border-color:rgba(31,111,229,.22);background:var(--accent-soft);color:var(--accent)}
    .method-stage-step.absorbed{border-style:dashed}
    .method-stage-arrow{color:var(--muted);font-size:10px}
    .stage-card.method-stage-placeholder{border-style:dashed;background:rgba(65,55,45,.025)}
    .stage-card.method-stage-placeholder .stage-card-header>strong{color:var(--muted)}
    .method-stage-recovered-note{margin:0 0 12px;padding:10px 12px;border:1px dashed var(--line);border-radius:12px;color:var(--muted);font-size:11px;line-height:1.55}
    @media(prefers-color-scheme:dark){.method-stage-sequence,.stage-card.method-stage-placeholder{background:rgba(109,157,255,.045)}}
  `;
  document.head.appendChild(style);
}

function methodFromMeta() {
  const text = String(meta?.textContent || "");
  if (/Pure ZB|\bZB\b/i.test(text)) return "zb";
  if (/Roux/i.test(text)) return "roux";
  if (/CFOP/i.test(text)) return "cfop";
  return null;
}

function normalizeName(raw) {
  const text = String(raw || "").trim().replace(/\s+/g, " ");
  if (/^XXCross\b/i.test(text)) return { key: "Cross", label: text, absorbed: 2, rank: 0 };
  if (/^XCross\b/i.test(text)) return { key: "Cross", label: text, absorbed: 1, rank: 0 };
  if (/^Cross\b/i.test(text)) return { key: "Cross", label: text, absorbed: 0, rank: 0 };
  const f2l = /^F2L\s*([1-4])(?:\s*[-–]\s*([1-4]))?/i.exec(text);
  if (f2l) {
    const first = Number(f2l[1]);
    const last = Number(f2l[2] || f2l[1]);
    return {
      key: first === last ? `F2L ${first}` : `F2L ${first}-${last}`,
      label: first === last ? `F2L ${first}` : `F2L ${first}-${last}`,
      first,
      last,
      rank: 10 + first,
    };
  }
  for (const name of ["ZBLS", "ZBLL", "OLL", "PLL", "FB", "SB", "CMLL", "LSE"]) {
    if (new RegExp(`^${name}\\b`, "i").test(text)) return { key: name, label: name };
  }
  return { key: text, label: text };
}

function rankFor(method, normalized) {
  if (Number.isFinite(normalized.rank)) return normalized.rank;
  const map = method === "zb"
    ? { ZBLS: 30, ZBLL: 40 }
    : method === "roux"
      ? { FB: 0, SB: 10, CMLL: 20, LSE: 30 }
      : { OLL: 30, PLL: 40 };
  return map[normalized.key] ?? 100;
}

function parseSolutionDisplay() {
  const sections = Array.from(body?.querySelectorAll(".detail-section") || []);
  const source = sections.find((section) => /솔버 출력/.test(String(section.querySelector("h3")?.textContent || "")));
  const text = String(source?.querySelector("pre")?.textContent || "");
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    if (/^Full\s*:/i.test(line)) return null;
    const match = /^([^:]+):\s*(.*)$/.exec(line);
    return match ? { name: match[1].trim(), solution: match[2].trim() } : null;
  }).filter(Boolean);
}

function createCard(stage) {
  const card = document.createElement("article");
  card.className = "stage-card";
  const header = document.createElement("div");
  header.className = "stage-card-header";
  const title = document.createElement("strong");
  title.textContent = stage.name;
  const chips = document.createElement("div");
  chips.className = "stage-card-chips";
  const moves = String(stage.solution || "").split(/\s+/).filter((token) => token && token !== "-");
  if (moves.length) {
    const chip = document.createElement("span");
    chip.className = "detail-chip";
    chip.innerHTML = `<span>수</span><b>${moves.length}</b>`;
    chips.appendChild(chip);
  }
  header.append(title, chips);
  card.appendChild(header);
  if (stage.solution) {
    const solution = document.createElement("pre");
    solution.className = "detail-code stage-solution";
    solution.textContent = stage.solution;
    card.appendChild(solution);
  }
  return card;
}

function stageSection(method) {
  const sections = Array.from(body?.querySelectorAll(".detail-section") || []);
  let section = sections.find((item) => /단계별 회전/.test(String(item.querySelector("h3")?.textContent || "")));
  if (section?.querySelector(".stage-list")) return section;

  const parsed = parseSolutionDisplay();
  if (!parsed.length) return null;
  section = document.createElement("section");
  section.className = "detail-section method-stage-recovered";
  const heading = document.createElement("h3");
  heading.textContent = `${SCHEMAS[method].label} 단계별 회전`;
  const note = document.createElement("p");
  note.className = "method-stage-recovered-note";
  note.textContent = "메인 솔버의 단계별 출력에서 회전을 복원했습니다.";
  const list = document.createElement("div");
  list.className = "stage-list";
  parsed.forEach((stage) => list.appendChild(createCard(stage)));
  section.append(heading, note, list);
  const final = sections.find((item) => /최종 해/.test(String(item.querySelector("h3")?.textContent || "")));
  body.insertBefore(section, final || null);
  return section;
}

function presence(cards) {
  const keys = new Set();
  let absorbed = 0;
  cards.forEach((card) => {
    const normalized = normalizeName(card.querySelector("strong")?.textContent);
    absorbed = Math.max(absorbed, normalized.absorbed || 0);
    if (normalized.first) {
      for (let pair = normalized.first; pair <= normalized.last; pair += 1) keys.add(`F2L ${pair}`);
    } else keys.add(normalized.key);
  });
  return { keys, absorbed };
}

function placeholder(name) {
  const card = document.createElement("article");
  card.className = "stage-card method-stage-placeholder";
  card.dataset.methodPlaceholder = name;
  const header = document.createElement("div");
  header.className = "stage-card-header";
  const title = document.createElement("strong");
  title.textContent = name;
  header.appendChild(title);
  const note = document.createElement("p");
  note.className = "stage-note";
  note.textContent = "0수로 생략되었거나 이 기록에 단계 데이터가 저장되지 않았습니다.";
  card.append(header, note);
  return card;
}

function sequence(method, section, cards) {
  section.querySelector(".method-stage-sequence")?.remove();
  const state = presence(cards);
  const box = document.createElement("div");
  box.className = "method-stage-sequence";
  const label = document.createElement("span");
  label.className = "method-stage-sequence-label";
  label.textContent = `${SCHEMAS[method].label} 순서`;
  box.appendChild(label);
  SCHEMAS[method].stages.forEach((name, index) => {
    if (index) {
      const arrow = document.createElement("span");
      arrow.className = "method-stage-arrow";
      arrow.textContent = "→";
      box.appendChild(arrow);
    }
    const step = document.createElement("span");
    step.className = "method-stage-step";
    const pair = Number(/^F2L ([1-4])$/.exec(name)?.[1] || 0);
    if (state.keys.has(name)) step.classList.add("present");
    else if (pair && pair <= state.absorbed) step.classList.add("absorbed");
    step.textContent = pair && pair <= state.absorbed ? `${name} (XCross 포함)` : name;
    box.appendChild(step);
  });
  section.insertBefore(box, section.querySelector(".stage-list"));
}

function enhance() {
  if (!dialog?.open || !body) return;
  const method = methodFromMeta();
  if (!method) return;
  const section = stageSection(method);
  const list = section?.querySelector(".stage-list");
  if (!section || !list) return;

  const realCards = Array.from(list.querySelectorAll(":scope > .stage-card:not(.method-stage-placeholder)"));
  const signature = `${method}|${realCards.map((card) => card.querySelector("strong")?.textContent || "").join("|")}`;
  if (body.dataset.methodStageSignature === signature && section.querySelector(".method-stage-sequence")) return;

  section.querySelector("h3").textContent = `${SCHEMAS[method].label} 단계별 회전`;
  list.querySelectorAll(".method-stage-placeholder").forEach((node) => node.remove());
  realCards.forEach((card) => {
    const title = card.querySelector(".stage-card-header > strong");
    if (title) title.textContent = normalizeName(title.textContent).label;
  });

  const current = presence(realCards);
  SCHEMAS[method].stages.forEach((name) => {
    const pair = Number(/^F2L ([1-4])$/.exec(name)?.[1] || 0);
    if (!current.keys.has(name) && !(pair && pair <= current.absorbed)) list.appendChild(placeholder(name));
  });

  const allCards = Array.from(list.querySelectorAll(":scope > .stage-card"));
  allCards.sort((a, b) => rankFor(method, normalizeName(a.querySelector("strong")?.textContent)) - rankFor(method, normalizeName(b.querySelector("strong")?.textContent)));
  allCards.forEach((card) => list.appendChild(card));
  sequence(method, section, allCards);
  body.dataset.methodStageSignature = signature;
}

addStyles();
let queued = false;
function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    enhance();
  });
}

new MutationObserver(schedule).observe(body || document.body, { childList: true, subtree: true });
new MutationObserver(schedule).observe(dialog || document.body, { attributes: true, attributeFilter: ["open"] });
dialog?.addEventListener("click", schedule);
