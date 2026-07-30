from pathlib import Path

path = Path("solver-wasm/src/fmc_insertion.rs")
text = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    text = text.replace(old, new, 1)


replace_once(
    "use std::collections::HashMap;",
    "use std::collections::hash_map::Entry;\nuse std::collections::HashMap;",
    "entry import",
)

replace_once(
    """                let key = state_key(&next_state);
                if map.contains_key(&key) {
                    continue;
                }

                let path: Vec<u8> = if backward {
                    // prepend m so the path reads: meeting_point → root
                    let mut p = vec![m];
                    p.extend_from_slice(&node.path);
                    p
                } else {
                    let mut p = node.path.clone();
                    p.push(m);
                    p
                };

                map.insert(key, path.clone());
""",
    """                let key = state_key(&next_state);
                let Entry::Vacant(entry) = map.entry(key) else {
                    continue;
                };

                let path: Vec<u8> = if backward {
                    // prepend m so the path reads: meeting_point → root
                    let mut p = vec![m];
                    p.extend_from_slice(&node.path);
                    p
                } else {
                    let mut p = node.path.clone();
                    p.push(m);
                    p
                };

                entry.insert(path.clone());
""",
    "single hash insertion",
)

path.write_text(text, encoding="utf-8")
