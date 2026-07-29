#!/usr/bin/env python3
from pathlib import Path

patcher = Path('tools/apply-f2l-compact-kernel.py')
source = patcher.read_text(encoding='utf-8')
start = source.find('# Record compact diagnostics in both compact-first and fallback branches.')
end = source.find('PATH.write_text(text, encoding="utf-8")', start)
if start < 0 or end < 0:
    raise RuntimeError('diagnostics compatibility section not found')
source = source[:start] + source[end:]
exec(compile(source, str(patcher), 'exec'), {'__name__': '__main__', '__file__': str(patcher)})
