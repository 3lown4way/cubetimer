from pathlib import Path


path = Path("tools/apply-fmc-wca-reverse-guard.py")
text = path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one {label} match, found {count}")
    text = text.replace(old, new, 1)


replace_once(
    "const FMC_REVERSE_NEAR_TOTAL_SLACK: usize = 2;\n",
    "const FMC_REVERSE_NEAR_TOTAL_SLACK: usize = 2;\n"
    "const FMC_REVERSE_NEAR_TOTAL_MIN_LEN: usize = 10;\n",
    "Rust minimum length constant",
)
replace_once(
    "    let lcs = longest_common_subsequence_len(&canonical, reverse_scramble_canonical);\n",
    "    if canonical.len().min(reverse_scramble_canonical.len())\n"
    "        < FMC_REVERSE_NEAR_TOTAL_MIN_LEN\n"
    "    {\n"
    "        return false;\n"
    "    }\n\n"
    "    let lcs = longest_common_subsequence_len(&canonical, reverse_scramble_canonical);\n",
    "Rust minimum length guard",
)
replace_once(
    "const FMC_REVERSE_NEAR_TOTAL_SLACK = 2;\n",
    "const FMC_REVERSE_NEAR_TOTAL_SLACK = 2;\n"
    "const FMC_REVERSE_NEAR_TOTAL_MIN_LEN = 10;\n",
    "JavaScript minimum length constant",
)
replace_once(
    "  const lcs = longestCommonSubsequenceLength(solution, reverse);\n",
    "  if (Math.min(solution.length, reverse.length) < FMC_REVERSE_NEAR_TOTAL_MIN_LEN) {\n"
    "    return false;\n"
    "  }\n"
    "  const lcs = longestCommonSubsequenceLength(solution, reverse);\n",
    "JavaScript minimum length guard",
)
replace_once(
    'Path("tools/apply-fmc-wca-reverse-guard.py").unlink()\n',
    'Path("tools/apply-fmc-wca-reverse-guard.py").unlink()\n'
    'Path("tools/repair-fmc-wca-reverse-guard.py").unlink()\n',
    "repair script cleanup",
)

path.write_text(text)
