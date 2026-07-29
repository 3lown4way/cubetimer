#!/usr/bin/env python3
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"anchor not found: {label}")
    return text.replace(old, new, 1)

p1_path = Path('solver/solver3x3Phase/phase1.js')
p1 = p1_path.read_text(encoding='utf-8')
p1 = replace_once(
    p1,
    'let drReverseComplete = false;\n',
    '''let drReverseComplete = false;\n\n// Reused for the lifetime of the worker. Clearing a Map retains its buckets,\n// avoiding repeated allocation and GC during consecutive solves.\nconst phase1SearchScratch = {\n  path: [],\n  failCache: new Map(),\n};\n''',
    'phase1 scratch declaration',
)
p1 = replace_once(
    p1,
    '  const path = [];\n',
    '''  const path = phase1SearchScratch.path;\n  path.length = 0;\n''',
    'phase1 path',
)
p1 = replace_once(
    p1,
    '  let failCache = new Map();\n',
    '''  const failCache = phase1SearchScratch.failCache;\n  failCache.clear();\n''',
    'phase1 fail cache',
)
p1_path.write_text(p1, encoding='utf-8')

p2_path = Path('solver/solver3x3Phase/phase2.js')
p2 = p2_path.read_text(encoding='utf-8')
p2 = replace_once(
    p2,
    'let allowedMovesByLastFace = null;\n',
    '''let allowedMovesByLastFace = null;\n\n// Worker-lifetime scratch storage for the JS fallback. The WASM path remains\n// unchanged, while repeated fallback solves avoid rebuilding large Maps.\nconst phase2SearchScratch = {\n  path: [],\n  failCache: new Map(),\n  simplifyBuffer: [],\n};\n''',
    'phase2 scratch declaration',
)
p2 = replace_once(
    p2,
    'function simplifyP2Slots(slots) {\n  const out = [];\n',
    '''function simplifyP2Slots(slots, out = []) {\n  out.length = 0;\n''',
    'phase2 simplify buffer',
)
p2 = replace_once(
    p2,
    '  const path = [];\n',
    '''  const path = phase2SearchScratch.path;\n  path.length = 0;\n''',
    'phase2 path',
)
p2 = replace_once(
    p2,
    '  let failCache = new Map();\n',
    '''  const failCache = phase2SearchScratch.failCache;\n  failCache.clear();\n''',
    'phase2 fail cache',
)
p2 = replace_once(
    p2,
    '      const simplified = simplifyP2Slots(path);\n',
    '''      const simplified = simplifyP2Slots(path, phase2SearchScratch.simplifyBuffer);\n''',
    'phase2 simplify call',
)
p2_path.write_text(p2, encoding='utf-8')
print('Applied worker memory pool')
