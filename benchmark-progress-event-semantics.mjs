import assert from "node:assert/strict";
import { normalizeCfopProgressEvent } from "./solver/progressEvents.js";

const zbStart = normalizeCfopProgressEvent({
  type: "fallback_start",
  stageName: "Color Neutral Cross Probe",
  reason: "BEST_CROSS_SCAN",
}, "zb");
assert.equal(zbStart.type, "probe_start");
assert.equal(zbStart.stageName, "Color Neutral ZB Opening Probe");
assert.equal(zbStart.reason, "BEST_ZB_OPENING_SCAN");

const zbDone = normalizeCfopProgressEvent({
  type: "fallback_done",
  stageName: "Color Neutral -> Yellow Cross",
}, "zb");
assert.equal(zbDone.type, "probe_done");
assert.equal(zbDone.stageName, "Color Neutral ZB Opening Probe -> Yellow Cross");
assert.equal(zbDone.reason, "BEST_ZB_OPENING_SCAN");

const strictStart = normalizeCfopProgressEvent({
  type: "fallback_start",
  stageName: "Color Neutral Cross Probe",
  reason: "BEST_XCROSS_SCAN",
}, "strict");
assert.equal(strictStart.type, "probe_start");
assert.equal(strictStart.stageName, "Color Neutral Cross Probe");
assert.equal(strictStart.reason, "BEST_XCROSS_SCAN");

const realFallback = {
  type: "fallback_start",
  stageName: "3x3 Strict Retry 1/2",
  reason: "F2L_RECOVERY",
};
assert.equal(normalizeCfopProgressEvent(realFallback, "zb"), realFallback);

console.log("CFOP progress event semantics: OK");
