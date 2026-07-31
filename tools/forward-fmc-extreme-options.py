from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "solver/wasmSolver.js"
text = PATH.read_text()

old = '''      enableMultiSwitchNiss: options.enableMultiSwitchNiss === true,
      enableDeepMultiSwitchNiss: options.enableDeepMultiSwitchNiss === true,
    });
'''
new = '''      enableMultiSwitchNiss: options.enableMultiSwitchNiss === true,
      enableDeepMultiSwitchNiss: options.enableDeepMultiSwitchNiss === true,
      searchLevel: Number.isFinite(Number(options.searchLevel))
        ? Math.max(0, Math.floor(Number(options.searchLevel)))
        : 0,
      searchVariant: Number.isFinite(Number(options.searchVariant))
        ? Math.max(0, Math.floor(Number(options.searchVariant)))
        : 0,
      incumbentMoveCount: Number.isFinite(Number(options.incumbentMoveCount))
        ? Math.max(1, Math.floor(Number(options.incumbentMoveCount)))
        : 40,
    });
'''
if old not in text:
    raise SystemExit("MISSING:FMC_WASM_OPTION_JSON")
PATH.write_text(text.replace(old, new, 1))
print("Forwarded FMC Extreme search options to WASM")
