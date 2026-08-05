from pathlib import Path

path = Path("tools/apply-exact-inverse-exclusion.py")
text = path.read_text()
old = '''rust = replace_once(
    rust,
    ''' + "'''        self.fail_cache.insert_or(cache_key, bit);\n        min_next.unwrap_or((bound as u16) + 1)'''" + ''',
    ''' + "'''        if self.excluded_global_path.is_none() {\n            self.fail_cache.insert_or(cache_key, bit);\n        }\n        min_next.unwrap_or((bound as u16) + 1)'''" + ''',
    "phase2 exclusion-safe cache",
)
'''
new = '''phase2_marker = "struct Phase2SearchCtx<'a, 'b> {"
phase2_prefix, phase2_body = rust.split(phase2_marker, 1)
phase2_body = replace_once(
    phase2_body,
    ''' + "'''        self.fail_cache.insert_or(cache_key, bit);\n        min_next.unwrap_or((bound as u16) + 1)'''" + ''',
    ''' + "'''        if self.excluded_global_path.is_none() {\n            self.fail_cache.insert_or(cache_key, bit);\n        }\n        min_next.unwrap_or((bound as u16) + 1)'''" + ''',
    "phase2 exclusion-safe cache",
)
rust = phase2_prefix + phase2_marker + phase2_body
'''
if text.count(old) != 1:
    raise SystemExit(f"expected one patcher cache block, found {text.count(old)}")
path.write_text(text.replace(old, new, 1))
Path("tools/fix-exact-patcher-cache-target.py").unlink(missing_ok=True)
