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

solver = Path('solver/cfop3x3.js')
generated = solver.read_text(encoding='utf-8')
anchor = '  const TT_MASK = TT_SIZE - 1;\n'
if anchor not in generated:
    raise RuntimeError('TT configuration anchor not found')
generated = generated.replace(
    anchor,
    anchor + '  const useTransposition = NPAIRS < 4;\n',
    1,
)
block_start = generated.find('      const remaining = bound - level;')
block_end = generated.find('\n\n      const nextLevel = level + 1;', block_start)
if block_start < 0 or block_end < 0:
    raise RuntimeError('TT hot-path block not found')
block = generated[block_start:block_end]
indented = '\n'.join('  ' + line for line in block.splitlines())
generated = generated[:block_start] + '      if (useTransposition) {\n' + indented + '\n      }' + generated[block_end:]
solver.write_text(generated, encoding='utf-8')
print('Restricted compact F2L transposition table to three-pair searches')
