import fs from "node:fs";

function replaceOnce(path, before, after) {
  const source = fs.readFileSync(path, "utf8");
  if (source.includes(after)) return;
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${path}: expected one target, found ${count}`);
  fs.writeFileSync(path, source.replace(before, after));
}

replaceOnce(
  "index.html",
  `    <link rel="stylesheet" href="styles.css" />`,
  `    <link rel="stylesheet" href="styles.css" />
    <link rel="stylesheet" href="preview/nxn3dPreview.css" />`,
);

replaceOnce(
  "index.html",
  `            <section class="visualizer glass" id="scramblePreviewSection">
              <scramble-display
                id="scramblePreview"
                event="333"
                visualization="2D"
                hint-facelets="none"
              ></scramble-display>
            </section>`,
  `            <section class="visualizer glass" id="scramblePreviewSection">
              <div class="scramble-preview-toolbar">
                <div class="scramble-preview-heading">
                  <strong id="scramblePreviewPuzzleLabel">3×3×3</strong>
                  <span id="scramblePreviewModeStatus">드래그하여 회전</span>
                </div>
                <div class="scramble-preview-mode-switch" role="group" aria-label="미리보기 방식">
                  <button type="button" class="preview-mode-btn" data-preview-mode="2D" aria-pressed="false">2D</button>
                  <button type="button" class="preview-mode-btn active" data-preview-mode="3D" aria-pressed="true">3D</button>
                </div>
              </div>
              <div class="scramble-preview-stage">
                <scramble-display
                  id="scramblePreview"
                  event="333"
                  visualization="2D"
                  hint-facelets="none"
                  hidden
                ></scramble-display>
                <div id="scramblePreview3DHost" class="scramble-preview-3d-host" aria-label="3D 스크램블 미리보기"></div>
              </div>
            </section>`,
);

replaceOnce(
  "main.js",
  `import { TwistyPlayer } from "cubing/twisty";`,
  `import { TwistyPlayer } from "cubing/twisty";
import { createNxNPreviewController } from "./preview/nxn3dPreview.js";`,
);
replaceOnce(
  "main.js",
  `const scramblePreview = document.getElementById("scramblePreview");`,
  `const scramblePreview = document.getElementById("scramblePreview");
const scramblePreview3DHost = document.getElementById("scramblePreview3DHost");
const scramblePreviewModeButtons = document.querySelectorAll("[data-preview-mode]");
const scramblePreviewPuzzleLabel = document.getElementById("scramblePreviewPuzzleLabel");
const scramblePreviewModeStatus = document.getElementById("scramblePreviewModeStatus");`,
);
replaceOnce(
  "main.js",
  `const toggleOllPllPrediction = document.getElementById("toggleOllPllPrediction");

const STORAGE_KEY = "cubeTimerState";`,
  `const toggleOllPllPrediction = document.getElementById("toggleOllPllPrediction");

const nxnPreviewController = createNxNPreviewController({
  TwistyPlayer,
  twoDPreview: scramblePreview,
  threeDHost: scramblePreview3DHost,
  modeButtons: scramblePreviewModeButtons,
  puzzleLabel: scramblePreviewPuzzleLabel,
  modeStatus: scramblePreviewModeStatus,
  storage: window.localStorage,
});

const STORAGE_KEY = "cubeTimerState";`,
);
replaceOnce(
  "main.js",
  `  scramblePreview.setAttribute("visualization", "2D");
  scramblePreview.setAttribute("event", eventId);
  scramblePreview.setAttribute("scramble", currentScramble);`,
  `  nxnPreviewController.setScramble(currentScramble, eventId);`,
);

console.log("Patched index.html and main.js");
