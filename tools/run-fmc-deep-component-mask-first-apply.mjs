import fs from "node:fs";

const path = "tools/apply-fmc-deep-component-mask.mjs";
let source = fs.readFileSync(path, "utf8");

const signatureNeedle = `  search = replaceOnce(
    search,
    \`    enable_multi_switch_niss: bool,
    enable_deep_multi_switch_niss: bool,
    search_level: u8,\`,
    \`    enable_multi_switch_niss: bool,
    enable_deep_multi_switch_niss: bool,
    deep_component_mask: u8,
    search_level: u8,\`,
    "inner solver signature",
  );`;
if (!source.includes(signatureNeedle)) throw new Error("Missing first-apply signature patch");
source = source.replace(
  signatureNeedle,
  signatureNeedle.replace("search = replaceOnce", "search = replaceFirst"),
);

const callBlock = `  const callNeedle = \`        enable_multi_switch_niss,
        enable_deep_multi_switch_niss,
        search_level,\`;
  const callReplacement = \`        enable_multi_switch_niss,
        enable_deep_multi_switch_niss,
        deep_component_mask,
        search_level,\`;
  let callCount = 0;
  while (search.includes(callNeedle)) {
    search = replaceFirst(search, callNeedle, callReplacement, \`inner solver call \${callCount + 1}\`);
    callCount += 1;
  }
  if (callCount !== 3) throw new Error(\`Expected 3 inner solver calls, found \${callCount}\`);`;
const regexCallBlock = `  const callPattern = /^([ \\t]*)enable_multi_switch_niss,\\n\\1enable_deep_multi_switch_niss,\\n\\1search_level,/gm;
  let callCount = 0;
  search = search.replace(callPattern, (_match, indent) => {
    callCount += 1;
    return \`\${indent}enable_multi_switch_niss,\\n\${indent}enable_deep_multi_switch_niss,\\n\${indent}deep_component_mask,\\n\${indent}search_level,\`;
  });
  if (callCount !== 3) throw new Error(\`Expected 3 inner solver calls, found \${callCount}\`);`;
if (!source.includes(callBlock)) throw new Error("Missing inner solver call patch");
source = source.replace(callBlock, regexCallBlock);

fs.writeFileSync(path, source);
await import(`./apply-fmc-deep-component-mask.mjs?firstApply=${Date.now()}`);
