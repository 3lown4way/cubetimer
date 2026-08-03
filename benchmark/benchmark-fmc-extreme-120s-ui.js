const FIXED_EXTREME_SECONDS = 120;

function isExtremeSelected() {
  const mode = document.getElementById("modeSelect");
  const quality = document.getElementById("fmcQualitySelect");
  return mode?.value === "fmc" && quality?.value === "extreme";
}

function applyExtremeContractUi() {
  const timeout = document.getElementById("timeoutInput");
  const timeoutUnit = document.getElementById("timeoutUnit");
  const warmup = document.getElementById("warmupCountInput");
  const footer = document.querySelector(".page-footer");
  const extreme = isExtremeSelected();

  if (timeout) {
    timeout.hidden = false;
    if (extreme) {
      timeout.value = String(FIXED_EXTREME_SECONDS);
      timeout.disabled = true;
      timeout.title = "FMC Extreme은 120초 고정 예산으로 실행됩니다.";
    } else {
      timeout.disabled = false;
      timeout.title = "";
    }
  }
  if (timeoutUnit) {
    timeoutUnit.textContent = extreme ? "초 · 고정" : "초";
  }
  if (warmup && extreme) {
    warmup.value = "0";
  }
  if (footer) {
    footer.textContent = extreme
      ? "FMC Extreme은 120초 동안 Adaptive → Full Human → Independent Frontier 순서로 탐색하며, 목표 미달이어도 현재 최선해를 보존합니다."
      : "FMC는 외부 Two-Phase fallback 없이 인간형 탐색 결과만 측정합니다.";
  }
}

for (const id of ["modeSelect", "fmcQualitySelect"]) {
  document.getElementById(id)?.addEventListener("change", () => queueMicrotask(applyExtremeContractUi));
}

const timeout = document.getElementById("timeoutInput");
if (timeout && typeof MutationObserver === "function") {
  new MutationObserver(() => {
    if (isExtremeSelected() && (timeout.hidden || timeout.disabled === false || timeout.value !== String(FIXED_EXTREME_SECONDS))) {
      queueMicrotask(applyExtremeContractUi);
    }
  }).observe(timeout, { attributes: true, attributeFilter: ["hidden", "disabled", "value"] });
}

queueMicrotask(applyExtremeContractUi);
