from pathlib import Path

path = Path("tools/apply-fmc-quality-ui.py")
text = path.read_text()
old = '''def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)
'''
new = '''def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if label == "FMC quality solve variable" and count == 2:
        first = text.find(old)
        second = text.find(old, first + len(old))
        if second < 0:
            raise SystemExit(f"{label}: second match not found")
        return text[:second] + text[second:].replace(old, new, 1)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)
'''
if text.count(old) != 1:
    raise SystemExit(f"replace helper anchor count: {text.count(old)}")
path.write_text(text.replace(old, new, 1))
print("Narrowed FMC quality solve-variable replacement to the request block")
