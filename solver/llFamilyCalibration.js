const DEFAULT_LL_FAMILY_CALIBRATION_DATA_URL = new URL(
  "../vendor-data/reco/reco-3x3-ll-family-calibration.json",
  import.meta.url,
);

let cachedCalibrationDataKey = "";
let cachedCalibrationDataPromise = null;
let cachedCalibrationData = null;
let cachedCalibrationIndexKey = "";
let cachedCalibrationIndexPromise = null;
let cachedCalibrationIndex = null;

function isNodeEnvironment() {
  return typeof process !== "undefined" && !!process.versions?.node;
}

function isUrlLike(value) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(String(value || ""));
}

function resolveInputLocation(inputPath = DEFAULT_LL_FAMILY_CALIBRATION_DATA_URL) {
  if (!inputPath) return DEFAULT_LL_FAMILY_CALIBRATION_DATA_URL;
  if (inputPath instanceof URL) return inputPath;
  const raw = String(inputPath).trim();
  if (!raw) return DEFAULT_LL_FAMILY_CALIBRATION_DATA_URL;
  if (isUrlLike(raw)) {
    try {
      return new URL(raw);
    } catch (_) {
      return raw;
    }
  }
  if (!isNodeEnvironment()) {
    return new URL(raw, import.meta.url);
  }
  return raw;
}

async function readJsonFromLocation(location) {
  if (!isNodeEnvironment()) {
    const response = await fetch(location, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  }

  const { readFile } = await import("fs/promises");
  return JSON.parse(await readFile(location, "utf8"));
}

async function loadCalibrationJson(inputPath = DEFAULT_LL_FAMILY_CALIBRATION_DATA_URL) {
  const location = resolveInputLocation(inputPath);
  const cacheKey = location instanceof URL ? location.href : String(location);
  if (cachedCalibrationData && cachedCalibrationDataKey === cacheKey) {
    return cachedCalibrationData;
  }
  if (cachedCalibrationDataPromise && cachedCalibrationDataKey === cacheKey) {
    return await cachedCalibrationDataPromise;
  }

  cachedCalibrationDataKey = cacheKey;
  cachedCalibrationDataPromise = (async () => {
    try {
      const parsed = await readJsonFromLocation(location);
      cachedCalibrationData = parsed;
      return parsed;
    } catch (error) {
      cachedCalibrationData = null;
      throw error;
    }
  })();
  try {
    return await cachedCalibrationDataPromise;
  } finally {
    cachedCalibrationDataPromise = null;
  }
}

function buildCalibrationIndexFromData(parsed, resolvedLocation) {
  if (!parsed || typeof parsed !== "object") return null;

  const globalLlFamilyCalibration =
    parsed.globalLlFamilyCalibration && typeof parsed.globalLlFamilyCalibration === "object"
      ? parsed.globalLlFamilyCalibration
      : parsed.globalCalibration && typeof parsed.globalCalibration === "object"
        ? parsed.globalCalibration
        : null;
  const playerProfiles = Array.isArray(parsed.playerLlFamilyCalibrationProfiles)
    ? parsed.playerLlFamilyCalibrationProfiles
    : Array.isArray(parsed.players)
      ? parsed.players
      : [];

  const playerLlFamilyCalibrationMap = new Map();
  for (let i = 0; i < playerProfiles.length; i++) {
    const profile = playerProfiles[i];
    if (!profile || typeof profile !== "object") continue;
    const solver = String(profile.solver || "").trim();
    if (!solver) continue;
    playerLlFamilyCalibrationMap.set(solver, profile);
  }

  return {
    sourcePath: resolvedLocation instanceof URL ? resolvedLocation.href : String(resolvedLocation || ""),
    data: parsed,
    globalLlFamilyCalibration,
    playerLlFamilyCalibrationMap,
  };
}

async function buildCalibrationIndex(inputPath = DEFAULT_LL_FAMILY_CALIBRATION_DATA_URL) {
  const location = resolveInputLocation(inputPath);
  const cacheKey = location instanceof URL ? location.href : String(location);
  if (cachedCalibrationIndex && cachedCalibrationIndexKey === cacheKey) {
    return cachedCalibrationIndex;
  }
  if (cachedCalibrationIndexPromise && cachedCalibrationIndexKey === cacheKey) {
    return await cachedCalibrationIndexPromise;
  }

  cachedCalibrationIndexKey = cacheKey;
  cachedCalibrationIndexPromise = (async () => {
    try {
      const parsed = await loadCalibrationJson(location);
      const index = buildCalibrationIndexFromData(parsed, location);
      cachedCalibrationIndex = index;
      return index;
    } catch (error) {
      cachedCalibrationIndex = null;
      return null;
    }
  })();
  try {
    return await cachedCalibrationIndexPromise;
  } finally {
    cachedCalibrationIndexPromise = null;
  }
}

export async function getLlFamilyCalibrationData(inputPath = DEFAULT_LL_FAMILY_CALIBRATION_DATA_URL) {
  try {
    return await loadCalibrationJson(inputPath);
  } catch (_) {
    return null;
  }
}

export async function getGlobalLlFamilyCalibrationProfile(
  inputPath = DEFAULT_LL_FAMILY_CALIBRATION_DATA_URL,
) {
  const index = await buildCalibrationIndex(inputPath);
  return index ? index.globalLlFamilyCalibration : null;
}

export async function getLlFamilyCalibrationForSolver(
  solverName,
  inputPath = DEFAULT_LL_FAMILY_CALIBRATION_DATA_URL,
) {
  const solver = String(solverName || "").trim();
  const index = await buildCalibrationIndex(inputPath);
  if (!index) return null;
  if (!solver) {
    return index.globalLlFamilyCalibration || null;
  }
  const solverProfile = index.playerLlFamilyCalibrationMap.get(solver) || null;
  if (!solverProfile) {
    return index.globalLlFamilyCalibration || null;
  }
  return solverProfile;
}
