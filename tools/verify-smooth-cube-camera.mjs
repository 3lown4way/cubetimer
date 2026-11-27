import assert from "node:assert/strict";
import { stepCameraOrbit } from "../solver/smoothCubeCamera.js";
const makeState = (overrides = {}) => ({
  lat: 35, lon: 179, targetLat: 35, targetLon: 210,
  vLat: 0, vLon: 0.5, dragging: false, ...overrides,
});
function simulate(state, frameMs, duration = 1000) {
  for (let t = 0; t < duration - 1e-6; t += frameMs) {
    stepCameraOrbit(state, Math.min(frameMs, duration - t));
  }
  return state;
}
const a = simulate(makeState(), 1000 / 60);
const b = simulate(makeState(), 1000 / 120);
assert.ok(Math.abs(a.lon - b.lon) < 0.5, "consistent 60/120 Hz");
assert.ok(a.lon > 210 && b.lon > 210, "unwrapped longitude crosses 180 smoothly");
const pole = simulate(makeState({ lat: 79, targetLat: 79, vLat: 0.9 }), 1000 / 60);
assert.equal(pole.lat, 80);
assert.equal(pole.vLat, 0);
const drag = makeState({ dragging: true, vLon: 0 });
stepCameraOrbit(drag, 16);
assert.ok(drag.lon > 179 && drag.lon < 210, "no instant jump on drag");
const before = drag.lon;
drag.targetLon = before - 30;
stepCameraOrbit(drag, 16);
assert.ok(drag.lon < before && drag.lon > drag.targetLon, "smooth reversal");
const still = makeState({ lon: 30, targetLon: 30, vLon: 0 });
assert.equal(stepCameraOrbit(still, 16), false, "idle stops rendering");
console.log("Smooth orbit checks passed.");
