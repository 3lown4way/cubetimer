from pathlib import Path

p = Path('solver/edgePairing444.js')
text = p.read_text()
text = text.replace(
    'const budgetMs = Math.max(350, Math.min(5200, Number(options?.timeBudgetMs) || 3000));',
    'const budgetMs = Math.max(350, Math.min(4200, Number(options?.timeBudgetMs) || 2400));',
    1,
)
p.write_text(text)

p = Path('solver/solver444.js')
text = p.read_text()
text = text.replace(
    'timeBudgetMs: options?.__yauFastFrameProbe === true ? 950 : 3000,',
    'timeBudgetMs: options?.__yauFastFrameProbe === true ? 950 : 2400,',
    1,
)
p.write_text(text)
print('restored Cross3 local budget to 2400ms')
