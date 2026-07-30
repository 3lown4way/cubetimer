function createFakeIndexedDb() {
  const records = new Map();
  let database = null;

  function request(executor, transaction = null) {
    const output = { result: undefined, error: null, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      try {
        output.result = executor();
        output.onsuccess?.();
        if (transaction) queueMicrotask(() => transaction.oncomplete?.());
      } catch (error) {
        output.error = error;
        output.onerror?.();
        if (transaction) {
          transaction.error = error;
          transaction.onerror?.();
        }
      }
    });
    return output;
  }

  function createDatabase() {
    const stores = new Set();
    return {
      objectStoreNames: { contains: (name) => stores.has(name) },
      createObjectStore(name) { stores.add(name); },
      close() {},
      onversionchange: null,
      transaction(name) {
        if (!stores.has(name)) throw new Error(`Missing object store: ${name}`);
        const transaction = {
          error: null,
          oncomplete: null,
          onabort: null,
          onerror: null,
          objectStore() {
            return {
              get(key) {
                return request(
                  () => records.has(key) ? structuredClone(records.get(key)) : undefined,
                  transaction,
                );
              },
              put(value) {
                return request(() => {
                  records.set(value.key, structuredClone(value));
                  return value.key;
                }, transaction);
              },
              delete(key) {
                return request(() => records.delete(key), transaction);
              },
            };
          },
        };
        return transaction;
      },
    };
  }

  return {
    open() {
      const output = {
        result: null,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };
      queueMicrotask(() => {
        const isNew = !database;
        if (!database) database = createDatabase();
        output.result = database;
        if (isNew) output.onupgradeneeded?.();
        output.onsuccess?.();
      });
      return output;
    },
  };
}

globalThis.indexedDB = createFakeIndexedDb();
const cache = await import("../solver/rouxExactTableCacheV2.js");

const record = {
  schemaVersion: 1,
  revision: "test",
  fbExactDistances: new Uint8Array([1, 2, 3]),
  lseKeys: new Int32Array([10, 20]),
};

const writeResult = await cache.writeRouxExactTableCacheV2(record);
if (writeResult.status !== "stored") throw new Error(`Unexpected write status: ${writeResult.status}`);

const readResult = await cache.readRouxExactTableCacheV2();
if (readResult.status !== "hit") throw new Error(`Unexpected read status: ${readResult.status}`);
if (!(readResult.record.fbExactDistances instanceof Uint8Array)) throw new Error("Uint8Array was not preserved");
if (!(readResult.record.lseKeys instanceof Int32Array)) throw new Error("Int32Array was not preserved");
if (readResult.record.fbExactDistances.join(",") !== "1,2,3") throw new Error("Cached bytes changed");
if (readResult.record.lseKeys.join(",") !== "10,20") throw new Error("Cached keys changed");

const deleteResult = await cache.deleteRouxExactTableCacheV2();
if (deleteResult.status !== "deleted") throw new Error(`Unexpected delete status: ${deleteResult.status}`);
const afterDelete = await cache.readRouxExactTableCacheV2();
if (afterDelete.status !== "miss") throw new Error(`Expected cache miss, got ${afterDelete.status}`);

console.log(JSON.stringify({ write: writeResult.status, read: readResult.status, delete: deleteResult.status }));
