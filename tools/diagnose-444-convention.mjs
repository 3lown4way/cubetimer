import fs from "node:fs";

const path = "solver/solver444.js";
let source = fs.readFileSync(path, "utf8");

const marker = `  if (verification?.ok !== true || verification?.solved !== true) {
    emitProgress(onProgress, {`;
const replacement = `  let conventionProbe = null;
  if (verification?.ok !== true || verification?.solved !== true) {
    const faceBits = Object.freeze({ U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 });
    const sourceTokens = String(twophase.solution || "").trim().split(/\\s+/).filter(Boolean);
    const prefixSolution = result.stages
      .map((stage) => String(stage.solution || "").trim())
      .filter(Boolean)
      .join(" ");
    probeLoop:
    for (const reversed of [false, true]) {
      const ordered = reversed ? [...sourceTokens].reverse() : sourceTokens;
      for (let directionMask = 0; directionMask < 64; directionMask += 1) {
        const transformedTokens = ordered.map((token) => {
          const match = /^([URFDLB])(2|')?$/.exec(token);
          if (!match) return token;
          const [, face, suffix = ""] = match;
          if (suffix === "2" || (directionMask & (1 << faceBits[face])) === 0) return token;
          return suffix === "'" ? face : \\`\${face}'\\`;
        });
        const transformed = transformedTokens.join(" ");
        const candidate = [prefixSolution, transformed].filter(Boolean).join(" ");
        let checked = null;
        try {
          checked = JSON.parse(String(api.verify({
            scramble: String(scramble || "").trim(),
            solution: candidate,
          }) || ""));
        } catch (_) {
          checked = null;
        }
        if (checked?.ok === true && checked?.solved === true) {
          conventionProbe = { reversed, directionMask, transformed };
          break probeLoop;
        }
      }
    }
  }

  if (verification?.ok !== true || verification?.solved !== true) {
    emitProgress(onProgress, {`;

if (!source.includes(marker)) throw new Error("verification failure marker not found");
source = source.replace(marker, replacement);

const metaMarker = `        twophaseMoveCount: threeByThreeStage.moveCount,
        fullVerificationSolved: false,`;
const metaReplacement = `        twophaseMoveCount: threeByThreeStage.moveCount,
        fullVerificationSolved: false,
        conventionProbe,
        diagnosticTwophaseSolution: String(twophase.solution || ""),`;
if (!source.includes(metaMarker)) throw new Error("verification metadata marker not found");
source = source.replace(metaMarker, metaReplacement);
fs.writeFileSync(path, source);
console.log("Added temporary 4x4 convention diagnostics");
