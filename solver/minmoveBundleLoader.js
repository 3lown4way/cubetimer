function isNodeFileUrl(url) {
  return String(url || "").startsWith("file://")
    && typeof process !== "undefined"
    && !!process.versions?.node;
}

async function readUrlBytes(url, fetchImpl) {
  if (isNodeFileUrl(url)) {
    const [{ fileURLToPath }, fs] = await Promise.all([
      import("node:url"),
      import("node:fs/promises"),
    ]);
    return new Uint8Array(await fs.readFile(fileURLToPath(url)));
  }

  const response = await fetchImpl(url, { cache: "force-cache" });
  if (!response?.ok) {
    throw new Error(`MINMOVE_ASSET_HTTP_${response?.status || 0}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function readUrlJson(url, fetchImpl) {
  if (isNodeFileUrl(url)) {
    const bytes = await readUrlBytes(url, fetchImpl);
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  const response = await fetchImpl(url, { cache: "no-cache" });
  if (!response?.ok) {
    throw new Error(`MINMOVE_MANIFEST_HTTP_${response?.status || 0}`);
  }
  return response.json();
}

function normalizeManifest(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("MINMOVE_MANIFEST_INVALID");
  }
  if (raw.format !== "minmove-333-gzip-chunks-v1") {
    throw new Error("MINMOVE_MANIFEST_FORMAT_UNSUPPORTED");
  }

  const uncompressedBytes = Number(raw.uncompressedBytes);
  if (!Number.isSafeInteger(uncompressedBytes) || uncompressedBytes <= 0 || uncompressedBytes > 0xffffffff) {
    throw new Error("MINMOVE_MANIFEST_SIZE_INVALID");
  }
  if (!Array.isArray(raw.parts) || raw.parts.length === 0) {
    throw new Error("MINMOVE_MANIFEST_PARTS_MISSING");
  }

  const parts = raw.parts.map((part, index) => {
    const file = String(part?.file || "").trim();
    const compressedBytes = Number(part?.compressedBytes);
    const uncompressedPartBytes = Number(part?.uncompressedBytes);
    if (!file || file.includes("..") || file.startsWith("/") || file.includes(":")) {
      throw new Error(`MINMOVE_MANIFEST_PART_PATH_INVALID_${index}`);
    }
    if (!Number.isSafeInteger(compressedBytes) || compressedBytes <= 0) {
      throw new Error(`MINMOVE_MANIFEST_PART_SIZE_INVALID_${index}`);
    }
    if (!Number.isSafeInteger(uncompressedPartBytes) || uncompressedPartBytes <= 0) {
      throw new Error(`MINMOVE_MANIFEST_PART_RAW_SIZE_INVALID_${index}`);
    }
    return { file, compressedBytes, uncompressedBytes: uncompressedPartBytes };
  });

  const summedRawBytes = parts.reduce((sum, part) => sum + part.uncompressedBytes, 0);
  if (summedRawBytes !== uncompressedBytes) {
    throw new Error("MINMOVE_MANIFEST_TOTAL_MISMATCH");
  }

  return {
    uncompressedBytes,
    bundleVersion: Number(raw.bundleVersion) || 0,
    parts,
  };
}

function supportsChunkedLoader(api) {
  return !!api
    && typeof api.beginMinmove333Bundle === "function"
    && typeof api.appendMinmove333BundleGzipChunk === "function"
    && typeof api.finishMinmove333Bundle === "function";
}

export async function loadChunkedMinmove333Bundle(
  api,
  manifestUrls,
  {
    fetchImpl = globalThis.fetch?.bind(globalThis),
    onProgress = null,
  } = {},
) {
  if (!supportsChunkedLoader(api)) {
    return { ok: false, reason: "MINMOVE_CHUNK_API_UNAVAILABLE" };
  }
  if (typeof fetchImpl !== "function" && !manifestUrls.some(isNodeFileUrl)) {
    return { ok: false, reason: "MINMOVE_FETCH_UNAVAILABLE" };
  }

  let lastReason = "MINMOVE_MANIFEST_NOT_FOUND";
  for (const manifestUrl of manifestUrls) {
    try {
      const manifest = normalizeManifest(await readUrlJson(manifestUrl, fetchImpl));
      api.beginMinmove333Bundle(manifest.uncompressedBytes);
      let loadedBytes = 0;

      for (let index = 0; index < manifest.parts.length; index += 1) {
        const part = manifest.parts[index];
        const partUrl = new URL(part.file, manifestUrl).href;
        const bytes = await readUrlBytes(partUrl, fetchImpl);
        if (bytes.byteLength !== part.compressedBytes) {
          throw new Error(`MINMOVE_CHUNK_COMPRESSED_SIZE_MISMATCH_${index}`);
        }
        const wasmLoadedBytes = Number(api.appendMinmove333BundleGzipChunk(bytes));
        loadedBytes += part.uncompressedBytes;
        if (wasmLoadedBytes !== loadedBytes) {
          throw new Error(`MINMOVE_CHUNK_DECOMPRESSED_SIZE_MISMATCH_${index}`);
        }
        if (typeof onProgress === "function") {
          onProgress({
            type: "asset_load_progress",
            stageName: "minmove HTM tables",
            loadedBytes,
            totalBytes: manifest.uncompressedBytes,
            partIndex: index,
            totalParts: manifest.parts.length,
          });
        }
      }

      api.finishMinmove333Bundle(manifest.uncompressedBytes);
      return {
        ok: true,
        manifestUrl,
        bundleVersion: manifest.bundleVersion,
        totalBytes: manifest.uncompressedBytes,
        partCount: manifest.parts.length,
      };
    } catch (error) {
      lastReason = String(error?.message || error || "MINMOVE_CHUNK_LOAD_FAILED");
      try {
        api.abortMinmove333Bundle?.();
      } catch (_) {}
    }
  }

  return { ok: false, reason: lastReason };
}
