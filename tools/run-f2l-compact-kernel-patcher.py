#!/usr/bin/env python3
from pathlib import Path

patcher = Path('tools/apply-f2l-compact-kernel.py')
source = patcher.read_text(encoding='utf-8')
old = '''if text.count(needle) < 2:
    raise RuntimeError("compact diagnostics anchors not found")
text = text.replace(needle, replacement, 2)
'''
new = '''if needle not in text:
    raise RuntimeError("primary compact diagnostics anchor not found")
text = text.replace(needle, replacement, 1)
needle_fallback = needle.replace("        if", "      if").replace("          stage", "        stage").replace("         }", "       }")
replacement_fallback = needle_fallback + """      if (Number.isFinite(compactResult?.transpositionHits)) {
        stage.performanceCollector.compactTranspositionHits = compactResult.transpositionHits;
      }
      if (Array.isArray(compactResult?.pairOrder)) {
        stage.performanceCollector.compactPairOrder = compactResult.pairOrder.slice();
      }
"""
if needle_fallback not in text:
    raise RuntimeError("fallback compact diagnostics anchor not found")
text = text.replace(needle_fallback, replacement_fallback, 1)
'''
if old not in source:
    raise RuntimeError('patcher compatibility block not found')
source = source.replace(old, new, 1)
exec(compile(source, str(patcher), 'exec'), {'__name__': '__main__', '__file__': str(patcher)})
