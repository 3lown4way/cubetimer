// Independent orbit controller for the vendored TwistyPlayer.
// Only camera coordinates change; puzzle state and playback remain untouched.
const controllers = new WeakMap();
const LAT_LIMIT = 80;
const FOLLOW_TAU = 28;
const INERTIA_TAU = 100;
const MAX_SPEED = 0.9; // degrees / ms
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export function stepCameraOrbit(state, elapsedMs) {
  const dt = clamp(elapsedMs, 0, 50);
  if (!state.dragging) {
    const decay = Math.exp(-dt / INERTIA_TAU);
    const travel = INERTIA_TAU * (1 - decay);
    state.targetLon += state.vLon * travel;
    state.targetLat = clamp(state.targetLat + state.vLat * travel, -LAT_LIMIT, LAT_LIMIT);
    state.vLon *= decay;
    state.vLat *= decay;
    if (Math.abs(state.targetLat) === LAT_LIMIT) state.vLat = 0;
    if (Math.abs(state.vLon) < 0.002) state.vLon = 0;
    if (Math.abs(state.vLat) < 0.002) state.vLat = 0;
  }
  const alpha = 1 - Math.exp(-dt / FOLLOW_TAU);
  state.lon += (state.targetLon - state.lon) * alpha;
  state.lat += (state.targetLat - state.lat) * alpha;
  const moving = Math.abs(state.targetLon - state.lon) > 0.02 ||
    Math.abs(state.targetLat - state.lat) > 0.02 || !!state.vLon || !!state.vLat;
  if (!moving) {
    state.lon = state.targetLon;
    state.lat = state.targetLat;
  }
  return moving;
}

export function detachSmoothCubeCamera(player) {
  controllers.get(player)?.();
}

export function attachSmoothCubeCamera(player) {
  if (!player || controllers.has(player)) return;
  const scene = player.experimentalModel?.twistySceneModel;
  // This is the same experimental model used by our pinned TwistyPlayer.
  // If the vendor interface changes, keep its native camera controls.
  if (!scene?.orbitCoordinates?.get || !scene?.orbitCoordinatesRequest?.set ||
      !scene?.dragInput?.set || !scene?.latitudeLimit?.set ||
      typeof player.addEventListener !== "function") return;
  let disposed = false, raf = 0, lastFrame = 0, pointer = null;
  let lastX = 0, lastY = 0, lastInput = 0, state = null;
  const savedTouchAction = player.style.touchAction;
  const savedCursor = player.style.cursor;
  const listeners = [];
  let enabled = false;
  const on = (type, fn) => {
    player.addEventListener(type, fn, { passive: false });
    listeners.push([type, fn]);
  };
  const schedule = () => {
    if (!raf && !disposed) {
      lastFrame = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  const frame = (now) => {
    raf = 0;
    if (disposed || !state || !player.isConnected) return;
    const moving = stepCameraOrbit(state, now - lastFrame);
    lastFrame = now;
    scene.orbitCoordinatesRequest.set({ latitude: state.lat, longitude: state.lon });
    if (moving) raf = requestAnimationFrame(frame);
  };
  const stopPointer = (e, inertial) => {
    if (pointer !== e.pointerId || !state) return;
    const id = pointer;
    pointer = null;
    state.dragging = false;
    player.style.cursor = "grab";
    if (!inertial || performance.now() - lastInput > 70) {
      state.vLon = state.vLat = 0;
    }
    if (player.hasPointerCapture?.(id)) player.releasePointerCapture(id);
    schedule();
  };
  controllers.set(player, () => {
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    if (pointer !== null && player.hasPointerCapture?.(pointer)) {
      const id = pointer; pointer = null; player.releasePointerCapture(id);
    }
    for (const [type, fn] of listeners) player.removeEventListener(type, fn);
    if (enabled) {
      player.style.touchAction = savedTouchAction;
      player.style.cursor = savedCursor;
      scene.dragInput.set("auto");
      scene.latitudeLimit.set(35);
    }
    controllers.delete(player);
  });
  // Read the actual initial pose, including the Yau left-face orientation.
  Promise.resolve(scene.orbitCoordinates.get()).then(({ latitude, longitude }) => {
    if (disposed || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    state = { lat: latitude, lon: longitude, targetLat: latitude, targetLon: longitude,
      vLat: 0, vLon: 0, dragging: false };
    scene.dragInput.set("none");
    scene.latitudeLimit.set(LAT_LIMIT);
    enabled = true;
    player.style.touchAction = "none";
    player.style.cursor = "grab";
    on("pointerdown", (e) => {
      if (pointer !== null || e.button !== 0 || e.isPrimary === false) return;
      try { player.setPointerCapture(e.pointerId); } catch { return; }
      e.preventDefault();
      pointer = e.pointerId;
      lastX = e.clientX; lastY = e.clientY; lastInput = performance.now();
      state.dragging = true;
      state.targetLat = state.lat; state.targetLon = state.lon;
      state.vLat = state.vLon = 0;
      player.style.cursor = "grabbing";
    });
    on("pointermove", (e) => {
      if (e.pointerId !== pointer) return;
      e.preventDefault();
      const now = performance.now();
      const dt = clamp(now - lastInput, 4, 80);
      const size = Math.max(1, Math.min(player.clientWidth, player.clientHeight));
      const dLon = -(e.clientX - lastX) * 170 / size;
      const dLat = (e.clientY - lastY) * 130 / size;
      state.targetLon += dLon;
      const prevLat = state.targetLat;
      state.targetLat = clamp(prevLat + dLat, -LAT_LIMIT, LAT_LIMIT);
      const w = 1 - Math.exp(-dt / 35);
      state.vLon += (clamp(dLon / dt, -MAX_SPEED, MAX_SPEED) - state.vLon) * w;
      state.vLat += (clamp((state.targetLat - prevLat) / dt, -MAX_SPEED, MAX_SPEED) - state.vLat) * w;
      lastX = e.clientX; lastY = e.clientY; lastInput = now;
      schedule();
    });
    on("pointerup", e => stopPointer(e, true));
    on("pointercancel", e => stopPointer(e, false));
    on("lostpointercapture", e => stopPointer(e, false));
  }).catch(() => detachSmoothCubeCamera(player));
}
