from pathlib import Path

path = Path("tools/apply-fmc-real-deadline.py")
text = path.read_text()
old = '''htr_call = "            force_rzp,\\n            enable_htr_skeletons,\\n        );"
htr_replacement = "            force_rzp,\\n            enable_htr_skeletons && budget.remaining_ms() >= 1500.0,\\n        );"
if fmc.count(htr_call) != 4:
    raise SystemExit(f"expected 4 single-axis HTR calls, found {fmc.count(htr_call)}")
fmc = fmc.replace(htr_call, htr_replacement)
'''
new = '''htr_call = "            force_rzp,\\n            enable_htr_skeletons,\\n        );"
htr_replacement = "            force_rzp,\\n            enable_htr_skeletons && budget.remaining_ms() >= 1500.0,\\n        );"
if fmc.count(htr_call) != 2:
    raise SystemExit(f"expected 2 direct/NISS HTR calls, found {fmc.count(htr_call)}")
fmc = fmc.replace(htr_call, htr_replacement)

premove_htr_call = "                    force_rzp,\\n                    enable_htr_skeletons,\\n                );"
premove_htr_replacement = "                    force_rzp,\\n                    enable_htr_skeletons && budget.remaining_ms() >= 1500.0,\\n                );"
if fmc.count(premove_htr_call) != 2:
    raise SystemExit(f"expected 2 premove HTR calls, found {fmc.count(premove_htr_call)}")
fmc = fmc.replace(premove_htr_call, premove_htr_replacement)
'''
if old not in text:
    raise SystemExit("HTR patcher block not found")
path.write_text(text.replace(old, new, 1))
