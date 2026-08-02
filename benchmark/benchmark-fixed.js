import "./benchmark-twophase-reliability.js?v=20260803-0834";
import "./benchmark-enhanced.js";
import "./benchmark-method-stages.js";
import "./benchmark-copy-record.js";
import "./benchmark-fmc-cancellation-view.js?v=20260803-0810";

if (!document.querySelector('link[data-benchmark-layout-fix]')) {
  const layoutFixStylesheet = document.createElement("link");
  layoutFixStylesheet.rel = "stylesheet";
  layoutFixStylesheet.href = "./benchmark-layout-fix.css?v=20260801-1";
  layoutFixStylesheet.dataset.benchmarkLayoutFix = "true";
  document.head.appendChild(layoutFixStylesheet);
}
