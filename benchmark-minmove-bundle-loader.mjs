import assert from "node:assert/strict";
import { loadChunkedMinmove333Bundle } from "./solver/minmoveBundleLoader.js";

function responseJson(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return value; },
  };
}

function responseBytes(values, status = 200) {
  const bytes = Uint8Array.from(values);
  return {
    ok: status >= 200 && status < 300,
    status,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

const calls = [];
let decompressedBytes = 0;
const api = {
  beginMinmove333Bundle(totalBytes) {
    calls.push(["begin", totalBytes]);
    decompressedBytes = 0;
  },
  appendMinmove333BundleGzipChunk(bytes) {
    calls.push(["append", Array.from(bytes)]);
    decompressedBytes += bytes[0];
    return decompressedBytes;
  },
  finishMinmove333Bundle(totalBytes) {
    calls.push(["finish", totalBytes]);
  },
  abortMinmove333Bundle() {
    calls.push(["abort"]);
  },
};

const manifestUrl = "https://example.invalid/minmove/minmove-333-v8.manifest.json";
const fetchImpl = async (url) => {
  if (url === manifestUrl) {
    return responseJson({
      format: "minmove-333-gzip-chunks-v1",
      bundleVersion: 8,
      uncompressedBytes: 5,
      parts: [
        { file: "minmove-333-v8.part-000.gz", compressedBytes: 2, uncompressedBytes: 2 },
        { file: "minmove-333-v8.part-001.gz", compressedBytes: 2, uncompressedBytes: 3 },
      ],
    });
  }
  if (url.endsWith("part-000.gz")) return responseBytes([2, 10]);
  if (url.endsWith("part-001.gz")) return responseBytes([3, 11]);
  return responseJson({}, 404);
};

const progress = [];
const result = await loadChunkedMinmove333Bundle(api, [manifestUrl], {
  fetchImpl,
  onProgress(event) { progress.push(event); },
});
assert.equal(result.ok, true);
assert.equal(result.bundleVersion, 8);
assert.deepEqual(calls, [
  ["begin", 5],
  ["append", [2, 10]],
  ["append", [3, 11]],
  ["finish", 5],
]);
assert.equal(progress.length, 2);
assert.equal(progress[1].loadedBytes, 5);
assert.equal(progress[1].totalParts, 2);

const retryCalls = [];
const retryApi = {
  beginMinmove333Bundle(totalBytes) { retryCalls.push(["begin", totalBytes]); decompressedBytes = 0; },
  appendMinmove333BundleGzipChunk(bytes) { decompressedBytes += bytes[0]; return decompressedBytes; },
  finishMinmove333Bundle(totalBytes) { retryCalls.push(["finish", totalBytes]); },
  abortMinmove333Bundle() { retryCalls.push(["abort"]); },
};
const retryResult = await loadChunkedMinmove333Bundle(
  retryApi,
  ["https://example.invalid/missing.json", manifestUrl],
  { fetchImpl },
);
assert.equal(retryResult.ok, true);
assert.deepEqual(retryCalls, [["abort"], ["begin", 5], ["finish", 5]]);

const invalid = await loadChunkedMinmove333Bundle(api, [manifestUrl], {
  fetchImpl: async (url) => {
    if (url === manifestUrl) {
      return responseJson({
        format: "minmove-333-gzip-chunks-v1",
        uncompressedBytes: 6,
        parts: [{ file: "../escape.gz", compressedBytes: 1, uncompressedBytes: 6 }],
      });
    }
    return responseBytes([1]);
  },
});
assert.equal(invalid.ok, false);
assert.match(invalid.reason, /PART_PATH_INVALID/);

console.log("Chunked minmove bundle loader: OK");
