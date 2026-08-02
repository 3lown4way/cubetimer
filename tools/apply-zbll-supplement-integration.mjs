import fs from "node:fs";

const file = new URL("../solver/cfop3x3.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");

function replaceOnce(label, before, after) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: source block not found`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label}: source block is not unique`);
  }
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
  "ZBLL supplemental import",
  `import { ZBLS_SUPPLEMENTAL_CASES } from "./zblsSupplementalCases.js";`,
  `import { ZBLS_SUPPLEMENTAL_CASES } from "./zblsSupplementalCases.js";\nimport { ZBLL_SUPPLEMENTAL_CASES } from "./zbllSupplementalCases.js";`,
);

replaceOnce(
  "ZBLL supplemental map",
  `const ZBLS_SUPPLEMENTAL_CASE_MAP = new Map(
  ZBLS_SUPPLEMENTAL_CASES.map(([caseKey, text]) => [
    caseKey,
    Object.freeze({
      text,
      normalizedText: text,
      moves: Object.freeze(splitMoves(text)),
      formulaKey: "ZBLS",
      supplemental: true,
    }),
  ]),
);`,
  `const ZBLS_SUPPLEMENTAL_CASE_MAP = new Map(
  ZBLS_SUPPLEMENTAL_CASES.map(([caseKey, text]) => [
    caseKey,
    Object.freeze({
      text,
      normalizedText: text,
      moves: Object.freeze(splitMoves(text)),
      formulaKey: "ZBLS",
      supplemental: true,
    }),
  ]),
);
const ZBLL_SUPPLEMENTAL_CASE_MAP = new Map(
  ZBLL_SUPPLEMENTAL_CASES.map(([caseKey, text]) => [
    caseKey,
    Object.freeze({
      text,
      normalizedText: text,
      moves: Object.freeze(splitMoves(text)),
      formulaKey: "ZBLL",
      supplemental: true,
    }),
  ]),
);`,
);

replaceOnce(
  "single-stage ZBLL supplement lookup",
  `    const zblsSupplement = formulaNamespace === "LL:ZBLS"
      ? ZBLS_SUPPLEMENTAL_CASE_MAP.get(startKey)
      : null;
    const candidates = zblsSupplement
      ? [zblsSupplement, ...(Array.isArray(filteredCandidates) ? filteredCandidates : [])]
      : filteredCandidates;`,
  `    const supplementalCandidates = [];
    if (formulaNamespace === "LL:ZBLS") {
      const zblsSupplement = ZBLS_SUPPLEMENTAL_CASE_MAP.get(startKey);
      if (zblsSupplement) supplementalCandidates.push(zblsSupplement);
    }
    if (formulaNamespace === "LL:ZBLL_PLL") {
      const zbllSupplement = ZBLL_SUPPLEMENTAL_CASE_MAP.get(startKey);
      if (zbllSupplement) supplementalCandidates.push(zbllSupplement);
    }
    const candidates = supplementalCandidates.length
      ? supplementalCandidates.concat(Array.isArray(filteredCandidates) ? filteredCandidates : [])
      : filteredCandidates;`,
);

fs.writeFileSync(file, source);
console.log("Integrated complete exact-state ZBLL supplement into solver/cfop3x3.js");
