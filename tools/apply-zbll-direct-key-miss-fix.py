from pathlib import Path

path = Path("solver/cfop3x3.js")
text = path.read_text()
old = '''    // Library is comprehensive — state not in map means no formula applies
    return null;
  }

  for (let r = 0; r < FORMULA_ROTATIONS.length; r++) {'''
new = '''    // A generated key miss must not terminate Pure ZB. Re-check the same direct
    // ZBLL formula set by replaying its y/AUF variants against the actual state.
    // This remains the selected ZBLL stage; it is not OLL+PLL, generic search,
    // Two-Phase, an alternate F2L route, or any cross-method fallback.
  }

  for (let r = 0; r < FORMULA_ROTATIONS.length; r++) {'''
if old not in text:
    raise SystemExit("ZBLL library key-miss return anchor not found")
text = text.replace(old, new, 1)
path.write_text(text)
Path("tools/apply-zbll-direct-key-miss-fix.py").unlink()
