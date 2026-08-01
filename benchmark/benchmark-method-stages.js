const detailDialog = document.getElementById("resultDetailDialog");
const detailMeta = document.getElementById("resultDetailMeta");
const detailBody = document.getElementById("resultDetailBody");

const METHOD_SCHEMAS = {
  cfop: {
    label: "CFOP",
    expected: ["Cross", "F2L 1", "F2L 2", "F2L 3", "F2L 4", "OLL", "PLL"],
  },
  zb: {
    label: "Pure ZB",
    expected: ["Cross", "F2L 1", "F2L 2", "F2L 3", "ZBLS", "ZBLL"],
  },
  roux: {
    label: "Roux",
    expected: ["FB", "SB", "CMLL", "LSE"],
  },
};

function injectStyles() {
  if (document.getElementById("benchmarkMethodStageStyles")) return;
  const style = document.createElement("style");
  style.id = "benchmarkMethodStageStyles";
  style.textContent = `
    .method-stage-sequence {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 7px;
      margin: 0 0 14px;
      padding: 11px 12px;
      border: 1px solid var(--line);
      border-radius: 13px;
      background: rgba(31, 111, 229, 0.035);
    }
    .method-stage-sequence-label {
      margin-right: 3px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
    }
    .method-stage-step {
      display: inline-flex;
      align-items: center;
      min-height: 26px;
      padding: 0 8px;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
      white-space: nowrap;
    }
    .method-stage-step.present {
      border-color: rgba(31, 111, 229, 0.22);
      background: var(--accent-soft);
      color: var(--accent);
    }
    .method-stage-step.absorbed {
      border-style: dashed;
      color: var(--muted);
    }
    .method-stage-arrow {
      color: var(--muted);
      font-size: 10px;
    }
    .stage-card.method-stage-placeholder {
      border-style: dashed;
      background: rgba(65, 55, 45, 0.025);
    }
    .stage-card.method-stage-placeholder .stage-card-header > strong {
      color: var(--muted);
    }
    .method-stage-legacy-note {
      margin: 0 0 12px;
      padding: 10px 12px;
      border: 1px dashed var(--line);
      border-radius: 12px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.55;
    }
    @media (prefers-color-scheme: dark) {
      .method-stage-sequence,
      .stage-card.method-stage-placeholder {
        background: rgba(109, 157, 255, 0.045);
      }
    }
  `;
  document.head.appendChild(style);
}

function detectMethod() {
  const text = String(detailMeta?.textContent || "");
  if (/Pure ZB|\bZB\b/i.test(text)) return "zb";
  if (/Roux/i.test(text)) return "roux";
  if (/CFOP/i.test(text)) return "cfop";
  return null;
}

function normalizeStageName(rawName) {
  const original = String(rawName || "").trim();
  const plain = original.replace(/\s+/g, " ");
  if (/^XXCross\b/i.test(plain)) return { key: "Cross", label: plain, absorbedPairs: 2 };
  if (/^XCross\b/i.test(plain)) return { key: "Cross", label: plain, absorbedPairs: 1 };
  if (/^Cross\b/i.test(plain)) return { key: "Cross", label: plain, absorbedPairs: 0 };
  const f2l = /^F2L\s*([1-4])(?:\s*[-–]\s*([1-4]))?/i.exec(plain);
  if (f2l) {
    const first = Number(f2l[1]);
    const last = Number(f2l[2] || f2l[1]);
    return {
      key: first === last ? `F2L ${first}` : `F2L ${first}-${last}`,
      label: first === last ? `F2L ${first}` : `F2L ${first}-${last}`,
      f2lFirst: first,
      f2lLast: last,
    };
  }
  for (const name of ["ZBLS", "ZBLL", "OLL", "PLL", "CMLL", "LSE", "FB", "SB"]) {
    if (new RegExp(`^${name}\\b`, "i").test(plain)) return { key: name, label: name };
  }
  return { key: plain, label: plain };
}

function stageRank(method, normalized) {
  if (normalized.key === "Cross") return 0;
  if (normalized.f2lFirst) return 10 + normalized.f2lFirst;
  const ranks = method === "zb"
    ? { ZBLS: 30, ZBLL: 40 }
    : method === "roux"
      ? { FB: 0, SB: 10, CMLL: 20, LSE: 30 }
      : { OLL: 30, PLL: 40 };
  return ranks[normalized.key] ?? 100;
}

function parseMainSolverDisplay() {
  if (!detailBody) return [];
  const sections = Array.from(detailBody.querySelectorAll(".detail-section"));
  const solverOutput = sections.find((section) => {
    const heading = section.querySelector("h3");
    return /솔버 출력|단계별|풀이 과정/.test(String(heading?.textContent || ""));
  });
  const text = String(solverOutput?.querySelector("pre")?.textContent || "");
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^Full\s*:/i.test(line))
    .map((line) => {
      const match = /^([^:]+):\s*(.*)$/.exec(line);
      return match ? { name: match[1].trim(), solution: match[2].trim() } : null;
    })
    .filter(Boolean);
}

function buildCard(stage) {
  const card = document.createElement("article");
  card.className = "stage-card";
  const header = document.createElement("div");
  header.className = "stage-card-header";
  const title = document.createElement("strong");
  title.textContent = stage.name;
  const chips = document.createElement("div");
  chips.className = "stage-card-chips";
  const moves = String(stage.solution || "").trim().split(/\s+/).filter((token) => token && token !== "-");
  if (moves.length) {
    const chip = document.createElement("span");
    chip.className = "detail-chip";
    const label = document.createElement("span");
    label.textContent = "수";
    const value = document.createElement("b");
    value.textContent = String(moves.length);
    chip.append(label, value);
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

function ensureStageSection(method) {
  if (!detailBody) return null;
  const sections = Array.from(detailBody.querySelectorAll(".detail-section"));
  let section = sections.find((candidate) => /단계별 회전/.test(String(candidate.querySelector("h3")?.textContent || "")));
  if (section?.querySelector(".stage-list")) return section;

  const parsed = parseMainSolverDisplay();
  if (!parsed.length) return null;
  section = document.createElement("section");
  section.className = "detail-section method-stage-recovered";
  const heading = document.createElement("h3");
  heading.textContent = `${METHOD_SCHEMAS[method].label} 단계별 회전`;
  const note = document.createElement("p");
  note.className = "method-stage-legacy-note";
  note.textContent = "메인 솔버 출력 형식에서 단계별 회전을 복원했습니다.";
  const list = document.createElement("div");
  list.className = "stage-list";
  parsed.forEach((stage) => list.appendChild(buildCard(stage)));
  section.append(heading, note, list);

  const finalSection = sections.find((candidate) => /최종 해/.test(String(candidate.querySelector("h3")?.textContent || "")));
  detailBody.insertBefore(section, finalSection || detailBody.firstChild?.nextSibling || null);
  return section;
}

function getPresentKeys(cards) {
  const present = new Set();
  let absorbedPairs = 0;
  cards.forEach((card) => {
    const normalized = normalizeStageName(card.querySelector("strong")?.textContent);
    if (normalized.key === "Cross") absorbedPairs = Math.max(absorbedPairs, normalized.absorbedPairs || 0);
    if (normalized.f2lFirst) {
      for (let pair = normalized.f2lFirst; pair <= normalized.f2lLast; pair += 1) present.add(`F2L ${pair}`);
    } else {
      present.add(normalized.key);
    }
  });
  return { present, absorbedPairs };
}

function addPlaceholders(method, list, cards, present, absorbedPairs) {
  const schema = METHOD_SCHEMAS[method];
  schema.expected.forEach((expected) => {
    if (present.has(expected)) return;
    const pairMatch = /^F2L ([1-4])$/.exec(expected);
    const pair = pairMatch ? Number(pairMatch[1]) : null;
    if (pair && pair <= absorbedPairs) return;

    const card = document.createElement("article");
    card.className = "stage-card method-stage-placeholder";
    card.dataset.methodPlaceholder = expected;
    const header = document.createElement("div");
    header.className = "stage-card-header";
    const title = document.createElement("strong");
    title.textContent = expected;
    header.appendChild(title);
    const note = document.createElement("p");
    note.className = "stage-note";
    note.textContent = "0수로 생략되었거나 이 기록에 단계 데이터가 저장되지 않았습니다.";
    card.append(header, note);
    list.appendChild(card);
    cards.push(card);
  });
}

function renderSequence(method, section, cards) {
  section.querySelector(".method-stage-sequence")?.remove();
  const { present, absorbedPairs } = getPresentKeys(cards);
  const sequence = document.createElement("div");
  sequence.className = "method-stage-sequence";
  const label = document.createElement("span");
  label.className = "method-stage-sequence-label";
  label.textContent = `${METHOD_SCHEMAS[method].label} 순서`;
  sequence.appendChild(label);

  METHOD_SCHEMAS[method].expected.forEach((expected, index) => {
    if (index > 0) {
      const arrow = document.createElement("span");
      arrow.className = "method-stage-arrow";
      arrow.textContent = "→";
      sequence.appendChild(arrow);
    }
    const step = document.createElement("span");
    step.className = "method-stage-step";
    const pair = Number(/^F2L ([1-4])$/.exec(expected)?.[1] || 0);
    if (present.has(expected)) step.classList.add("present");
    else if (pair && pair <= absorbedPairs) step.classList.add("absorbed");
    step.textContent = pair && pair <= absorbedPairs ? `${expected} (XCross 포함)` : expected;
    sequence.appendChild(step);
  });

  const list = section.querySelector(".stage-list");
  section.insertBefore(sequence, list || null);
}

function enhanceMethodStages() {
  if (!detailDialog?.open || !detailBody) return;
  const method = detectMethod();
  if (!method) return;
  const section = ensureStageSection(method);
  const list = section?.querySelector(".stage-list");
  if (!section || !list) return;

  section.querySelector("h3").textContent = `${METHOD_SCHEMAS[method].label} 단계별 회전`;
  list.querySelectorAll("[data-method-placeholder]").forEach((node) => node.remove());
  const cards = Array.from(list.querySelectorAll(":scope > .stage-card"));
  cards.forEach((card) => {
    const title = card.querySelector(".stage-card-header > strong");
    if (!title) return;
    const normalized = normalizeStageName(title.textContent);
    title.textContent = normalized.label;
    card.dataset.methodStageKey = normalized.key;
  });

  cards.sort((a, b) => {
    const aNorm = normalizeStageName(a.querySelector("strong")?.textContent);
    const bNorm = normalizeStageName(b.querySelector("strong")?.textContent);
    return stageRank(method, aNorm) - stageRank(method, bNorm);
  });
  cards.forEach((card) => list.appendChild(card));

  const state = getPresentKeys(cards);
  addPlaceholders(method, list, cards, state.present, state.absorbedPairs);
  const sortedWithPlaceholders = Array.from(list.querySelectorAll(":scope > .stage-card"));
  sortedWithPlaceholders.sort((a, b) => {
    const aNorm = normalizeStageName(a.querySelector("strong")?.textContent);
    const bNorm = normalizeStageName(b.querySelector("strong")?.textContent);
    return stageRank(method, aNorm) - stageRank(method, bNorm);
  });
  sortedWithPlaceholders.forEach((card) => list.appendChild(card));
  renderSequence(method, section, sortedWithPlaceholders);
}

injectStyles();
let scheduled = false;
const scheduleEnhancement = () => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    enhanceMethodStages();
  });
};

new MutationObserver(scheduleEnhancement).observe(detailBody || document.body, {
  childList: true,
  subtree: true,
});
new MutationObserver(scheduleEnhancement).observe(detailDialog || document.body, {
  attributes: true,
  attributeFilter: ["open"],
});
detailDialog?.addEventListener("click", scheduleEnhancement);
