const DATABASE_NAME = "cubetimer-roux-v2-exact-cache-v1";
const DATABASE_VERSION = 1;
const STORE_NAME = "tables";
const RECORD_KEY = "roux-v2-exact-tables";

let databasePromise = null;

function hasIndexedDb() {
  return typeof globalThis.indexedDB !== "undefined";
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
  });
}

function openDatabase() {
  if (!hasIndexedDb()) return Promise.resolve(null);
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
  }).catch((error) => {
    databasePromise = null;
    throw error;
  });

  return databasePromise;
}

async function runTransaction(mode, operation) {
  const database = await openDatabase();
  if (!database) return null;
  const transaction = database.transaction(STORE_NAME, mode);
  const store = transaction.objectStore(STORE_NAME);
  const resultPromise = operation(store);
  const [result] = await Promise.all([
    resultPromise,
    transactionComplete(transaction),
  ]);
  return result;
}

function errorName(error) {
  return String(error?.name || error?.message || "IndexedDBError");
}

export function isRouxExactTableCacheV2Available() {
  return hasIndexedDb();
}

export async function readRouxExactTableCacheV2() {
  if (!hasIndexedDb()) return { status: "unavailable", record: null };
  const startedAt = performance.now();
  try {
    const record = await runTransaction(
      "readonly",
      (store) => requestResult(store.get(RECORD_KEY)),
    );
    return {
      status: record ? "hit" : "miss",
      record: record || null,
      elapsedMs: performance.now() - startedAt,
    };
  } catch (error) {
    return {
      status: "error",
      record: null,
      elapsedMs: performance.now() - startedAt,
      error: errorName(error),
    };
  }
}

export async function writeRouxExactTableCacheV2(record) {
  if (!hasIndexedDb()) return { status: "unavailable" };
  const startedAt = performance.now();
  try {
    await runTransaction(
      "readwrite",
      (store) => requestResult(store.put({ ...record, key: RECORD_KEY })),
    );
    return {
      status: "stored",
      elapsedMs: performance.now() - startedAt,
    };
  } catch (error) {
    return {
      status: "error",
      elapsedMs: performance.now() - startedAt,
      error: errorName(error),
    };
  }
}

export async function deleteRouxExactTableCacheV2() {
  if (!hasIndexedDb()) return { status: "unavailable" };
  try {
    await runTransaction(
      "readwrite",
      (store) => requestResult(store.delete(RECORD_KEY)),
    );
    return { status: "deleted" };
  } catch (error) {
    return { status: "error", error: errorName(error) };
  }
}
