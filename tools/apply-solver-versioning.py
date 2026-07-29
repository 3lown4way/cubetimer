from pathlib import Path

main_path = Path("main.js")
main = main_path.read_text()
old = '''    const crossColorSetting = appState.settings.crossColor || "D";
    const solverMode = appState.settings.solverMode || "strict";
    const f2lMethod = appState.settings.f2lMethod || DEFAULT_F2L_METHOD;
'''
new = '''    const crossColorSetting = appState.settings.crossColor || "D";
    const solverMode = appState.settings.solverMode || "strict";
    const solverVersion = VALID_SOLVER_VERSIONS.has(appState.settings.solverVersion)
      ? appState.settings.solverVersion
      : "v2";
    const f2lMethod = appState.settings.f2lMethod || DEFAULT_F2L_METHOD;
'''

if new not in main:
    if old not in main:
        raise RuntimeError("solverVersion declaration marker not found")
    main = main.replace(old, new, 1)

main_path.write_text(main)
print("solverVersion declaration applied")
