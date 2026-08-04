import fs from "node:fs";

const path = "tools/apply-wasm-readiness-retry.mjs";
let source = fs.readFileSync(path, "utf8");

const consoleBefore = '    `[WASM] ${wasmLastFailure.stage} failed${wasmLastFailure.target ? `: ${wasmLastFailure.target}` : ""}: ${message}`,\n';
const consoleAfter = '    "[WASM] " + wasmLastFailure.stage + " failed" + (wasmLastFailure.target ? ": " + wasmLastFailure.target : "") + ": " + message,\n';
if (!source.includes(consoleBefore) && !source.includes(consoleAfter)) {
  throw new Error("Missing nested WASM warning template");
}
source = source.replace(consoleBefore, consoleAfter);

const httpBefore = 'new Error(`HTTP_${response.status}`)';
const httpAfter = 'new Error("HTTP_" + response.status)';
if (!source.includes(httpBefore) && !source.includes(httpAfter)) {
  throw new Error("Missing nested HTTP template");
}
source = source.replace(httpBefore, httpAfter);

fs.writeFileSync(path, source);
console.log("WASM readiness applicator syntax fixed");
