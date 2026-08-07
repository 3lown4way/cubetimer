from pathlib import Path

ui = Path('solver/solver444UiActivation.js')
s = ui.read_text()

def replace_once(old, new, label):
    global s
    if old not in s:
        raise SystemExit(f'missing anchor: {label}')
    s = s.replace(old, new, 1)

replace_once(
    'const SOLVE_TIMEOUT_MS = 60_000;\nconst INSTALL_KEY = "__cubeTimer444UiActivationInstalled";',
    'const SOLVE_TIMEOUT_MS = 60_000;\nconst WORKER_BOOT_TIMEOUT_MS = 8_000;\nconst WORKER_CALL_GRACE_MS = 5_000;\nconst WORKER_BUILD_TOKEN = "20260808-444-bootstrap-1";\nconst INSTALL_KEY = "__cubeTimer444UiActivationInstalled";',
    'constants',
)

replace_once(
'''function createWorkerClient() {
  const worker = new Worker(new URL("./solverWorker.js", import.meta.url), { type: "module" });
  const api = wrap(worker);
  return { worker, api };
}
''',
'''function createWorkerClient(forceReload = false) {
  const workerUrl = new URL("./solverWorker.js", import.meta.url);
  workerUrl.searchParams.set("v", WORKER_BUILD_TOKEN);
  if (forceReload) workerUrl.searchParams.set("reload", String(Date.now()));
  const worker = new Worker(workerUrl, { type: "module" });
  const api = wrap(worker);
  return { worker, api };
}

function withUiTimeout(promise, timeoutMs, reason) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(reason)), timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function waitForWorkerPing(client) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      client.worker.removeEventListener("error", onError);
      client.worker.removeEventListener("messageerror", onMessageError);
      callback(value);
    };
    const onError = () => finish(reject, new Error("444_WORKER_BOOT_ERROR"));
    const onMessageError = () => finish(reject, new Error("444_WORKER_MESSAGE_ERROR"));
    const timer = window.setTimeout(
      () => finish(reject, new Error("444_WORKER_BOOT_TIMEOUT")),
      WORKER_BOOT_TIMEOUT_MS,
    );
    client.worker.addEventListener("error", onError);
    client.worker.addEventListener("messageerror", onMessageError);
    Promise.resolve(client.api.ping()).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}
''',
    'createWorkerClient',
)

replace_once(
    '    case "444_WORKER_FAILED":\n      return "4×4 솔버 Worker 실행 중 오류가 발생했습니다.";',
    '    case "444_WORKER_BOOT_TIMEOUT":\n      return "4×4 Worker 준비가 지연되어 새 Worker로 다시 연결하지 못했습니다.";\n    case "444_WORKER_BOOT_ERROR":\n    case "444_WORKER_MESSAGE_ERROR":\n      return "4×4 Worker를 불러오지 못했습니다. 새 버전으로 다시 연결해 주세요.";\n    case "444_WORKER_FAILED":\n      return "4×4 솔버 Worker 실행 중 오류가 발생했습니다.";',
    'reason labels',
)

replace_once(
'''  async function ensureWorker() {
    if (worker && solverApi) return solverApi;
    const client = createWorkerClient();
    worker = client.worker;
    solverApi = client.api;
    await solverApi.ping();
    return solverApi;
  }
''',
'''  async function ensureWorker() {
    if (worker && solverApi) return solverApi;
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const client = createWorkerClient(attempt > 0);
      try {
        const pong = await waitForWorkerPing(client);
        if (pong?.ok !== true) throw new Error("444_WORKER_BOOT_ERROR");
        worker = client.worker;
        solverApi = client.api;
        return solverApi;
      } catch (error) {
        lastError = error;
        client.worker.terminate();
      }
    }
    throw lastError || new Error("444_WORKER_BOOT_ERROR");
  }
''',
    'ensureWorker',
)

replace_once(
'''      const api = await ensureWorker();
      if (activeRun !== runId || !is444()) return;
      const deadlineTs = Date.now() + SOLVE_TIMEOUT_MS;
      const result = await api.solve(
        {''',
'''      const api = await ensureWorker();
      if (activeRun !== runId || !is444()) return;
      setStatus("4×4 Worker 연결 완료 · 엔진을 초기화하고 있습니다...");
      const deadlineTs = Date.now() + SOLVE_TIMEOUT_MS;
      const result = await withUiTimeout(
        api.solve(
          {''',
    'solve start',
)

replace_once(
'''        proxy((progress) => {
          if (activeRun !== runId || !is444()) return;
          setStatus(progressText(progress));
        }),
      );
      if (activeRun !== runId || !is444() || currentScramble() !== scramble) return;''',
'''          proxy((progress) => {
            if (activeRun !== runId || !is444()) return;
            setStatus(progressText(progress));
          }),
        ),
        SOLVE_TIMEOUT_MS + WORKER_CALL_GRACE_MS,
        "444_UI_SOLVE_TIMEOUT",
      );
      if (activeRun !== runId || !is444() || currentScramble() !== scramble) return;''',
    'solve end',
)

replace_once(
'''    } catch (error) {
      if (activeRun === runId && is444()) {
        renderFailure({ reason: "444_WORKER_FAILED", detail: error?.message || error });
      }
      disposeWorker();
''',
'''    } catch (error) {
      if (activeRun === runId && is444()) {
        const message = String(error?.message || error || "444_WORKER_FAILED");
        const reason = message === "444_UI_SOLVE_TIMEOUT"
          ? "444_DEADLINE_REACHED"
          : message.startsWith("444_WORKER_")
            ? message
            : "444_WORKER_FAILED";
        renderFailure({ reason, detail: message });
      }
      disposeWorker();
''',
    'solve catch',
)

ui.write_text(s)

preview = Path('solver/nxnTwistyPreview.js')
p = preview.read_text()
old = '  void import("./solver444UiActivation.js")'
new = '  void import("./solver444UiActivation.js?v=20260808-444-bootstrap-1")'
if old not in p:
    raise SystemExit('missing activation import anchor')
preview.write_text(p.replace(old, new, 1))

verify = Path('tools/verify-nxn-solver-preview.mjs')
v = verify.read_text()
v = v.replace(
    'assert.match(nxnSource, /import\\("\\.\\/solver444UiActivation\\.js"\\)/);',
    'assert.match(nxnSource, /import\\("\\.\\/solver444UiActivation\\.js(?:\\?v=[^"]+)?"\\)/);',
    1,
)
v = v.replace(
'''assert.match(
  solver444UiSource,
  /new Worker\\(new URL\\("\\.\\/solverWorker\\.js", import\\.meta\\.url\\), \\{ type: "module" \\}\\)/,
);''',
'''assert.match(solver444UiSource, /const workerUrl = new URL\\("\\.\\/solverWorker\\.js", import\\.meta\\.url\\)/);
assert.match(solver444UiSource, /new Worker\\(workerUrl, \\{ type: "module" \\}\\)/);''',
    1,
)
verify.write_text(v)

Path('tools/verify-444-ui-worker-bootstrap.mjs').write_text('''import assert from "node:assert/strict";\nimport fs from "node:fs";\nconst ui = fs.readFileSync(new URL("../solver/solver444UiActivation.js", import.meta.url), "utf8");\nconst preview = fs.readFileSync(new URL("../solver/nxnTwistyPreview.js", import.meta.url), "utf8");\nassert.match(ui, /WORKER_BOOT_TIMEOUT_MS = 8_000/);\nassert.match(ui, /workerUrl\\.searchParams\\.set\\("v", WORKER_BUILD_TOKEN\\)/);\nassert.match(ui, /workerUrl\\.searchParams\\.set\\("reload", String\\(Date\\.now\\(\\)\\)\\)/);\nassert.match(ui, /client\\.worker\\.addEventListener\\("error", onError\\)/);\nassert.match(ui, /client\\.worker\\.addEventListener\\("messageerror", onMessageError\\)/);\nassert.match(ui, /for \\(let attempt = 0; attempt < 2; attempt \\+= 1\\)/);\nassert.match(ui, /withUiTimeout\\(\\s*api\\.solve\\(/);\nassert.match(preview, /solver444UiActivation\\.js\\?v=20260808-444-bootstrap-1/);\nconsole.log("4x4 UI worker bootstrap timeout, retry, and cache-bust contract passed");\n''')

print('patched 4x4 worker bootstrap recovery')
