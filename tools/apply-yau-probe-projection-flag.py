from pathlib import Path

path = Path('solver/solver444.js')
s = path.read_text()
old = '''      enableRescue: options?.__yauFastFrameProbe !== true,
    },'''
new = '''      enableRescue: options?.__yauFastFrameProbe !== true,
      projectTargetState: options?.__yauFastFrameProbe === true,
    },'''
count = s.count(old)
if count < 2:
    raise SystemExit(f'expected at least two Yau rescue option anchors, got {count}')
s = s.replace(old, new, 2)
path.write_text(s)
print('patched target projection flag onto Yau frame probes')
