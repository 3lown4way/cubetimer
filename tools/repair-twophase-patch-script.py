import re
from pathlib import Path

path = Path("tools/apply-twophase-inverse-derived-fix.py")
text = path.read_text()

if not text.startswith("import re\n"):
    text = "import re\n" + text

start_marker = 'call_tail = "            excluded_path.as_deref(),\\n        );"'
end_marker = "rust = replace_once(\n    rust,\n    '            reason: if options.strict_incumbent"
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("phase2 call patch block not found")

replacement = r'''call_pattern = re.compile(
    r"(?m)^(?P<indent>\s*)excluded_path\.as_deref\(\),\n(?P<close>\s*)\);$"
)
call_matches = list(call_pattern.finditer(rust))
if len(call_matches) != 2:
    raise SystemExit(f"expected two phase2 call sites, found {len(call_matches)}")

def add_exclusion_counter(match: re.Match[str]) -> str:
    indent = match.group("indent")
    close = match.group("close")
    return (
        f"{indent}excluded_path.as_deref(),\n"
        f"{indent}&mut excluded_variant_count,\n"
        f"{close});"
    )

rust = call_pattern.sub(add_exclusion_counter, rust, count=2)
'''
text = text[:start] + replacement + text[end:]

cleanup_marker = 'Path("tools/apply-twophase-inverse-derived-fix.py").unlink()\n'
if cleanup_marker not in text:
    raise SystemExit("cleanup marker not found")
text = text.replace(
    cleanup_marker,
    cleanup_marker + 'Path("tools/repair-twophase-patch-script.py").unlink()\n',
    1,
)
path.write_text(text)
