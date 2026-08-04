import fs from "node:fs";

const path = "tools/apply-fmc-deep-component-mask.mjs";
const before = fs.readFileSync(path, "utf8");
const needle = `  search = replaceOnce(
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
const replacement = needle.replace("search = replaceOnce", "search = replaceFirst");
if (!before.includes(needle)) throw new Error("Missing first-apply signature patch");
fs.writeFileSync(path, before.replace(needle, replacement));
await import(`./apply-fmc-deep-component-mask.mjs?firstApply=${Date.now()}`);
