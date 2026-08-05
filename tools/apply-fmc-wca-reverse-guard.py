from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one {label} match, found {count}")
    return text.replace(old, new, 1)


rust_path = Path("solver-wasm/src/fmc_search.rs")
rust = rust_path.read_text()
old_rust_guard = r'''fn is_trivial_reverse_solution(solution: &[u8], reverse_scramble_canonical: &[u8]) -> bool {
    canonicalize_commuting_axis_blocks(solution) == reverse_scramble_canonical
}

fn retain_nontrivial_reverse_candidates(
    candidates: &mut Vec<FmcCandidate>,
    reverse_scramble_canonical: &[u8],
) -> usize {
    let before = candidates.len();
    candidates.retain(|candidate| {
        !is_trivial_reverse_solution(&candidate.moves, reverse_scramble_canonical)
    });
    before.saturating_sub(candidates.len())
}
'''
new_rust_guard = r'''// WCA E2e++ gives a four-move inverse-scramble prefix as an explicit DNF example.
// The longer-block and near-total checks are conservative software equivalents of
// E2e+'s prohibition on sharing significant parts with the inverse scramble.
const FMC_REVERSE_PREFIX_DNF_LEN: usize = 4;
const FMC_REVERSE_CONTIGUOUS_DNF_LEN: usize = 6;
const FMC_REVERSE_NEAR_TOTAL_SLACK: usize = 2;

fn common_prefix_len(left: &[u8], right: &[u8]) -> usize {
    left.iter()
        .zip(right.iter())
        .take_while(|(left_move, right_move)| left_move == right_move)
        .count()
}

fn longest_common_contiguous_len(left: &[u8], right: &[u8]) -> usize {
    let mut previous = vec![0usize; right.len() + 1];
    let mut current = vec![0usize; right.len() + 1];
    let mut best = 0usize;
    for &left_move in left {
        current.fill(0);
        for (index, &right_move) in right.iter().enumerate() {
            if left_move == right_move {
                current[index + 1] = previous[index] + 1;
                best = best.max(current[index + 1]);
            }
        }
        std::mem::swap(&mut previous, &mut current);
    }
    best
}

fn longest_common_subsequence_len(left: &[u8], right: &[u8]) -> usize {
    let mut previous = vec![0usize; right.len() + 1];
    let mut current = vec![0usize; right.len() + 1];
    for &left_move in left {
        current.fill(0);
        for (index, &right_move) in right.iter().enumerate() {
            current[index + 1] = if left_move == right_move {
                previous[index] + 1
            } else {
                current[index].max(previous[index + 1])
            };
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[right.len()]
}

fn is_disallowed_reverse_derived_solution(
    solution: &[u8],
    reverse_scramble_canonical: &[u8],
) -> bool {
    let canonical = canonicalize_commuting_axis_blocks(solution);
    if canonical == reverse_scramble_canonical {
        return true;
    }
    if common_prefix_len(&canonical, reverse_scramble_canonical) >= FMC_REVERSE_PREFIX_DNF_LEN {
        return true;
    }
    if longest_common_contiguous_len(&canonical, reverse_scramble_canonical)
        >= FMC_REVERSE_CONTIGUOUS_DNF_LEN
    {
        return true;
    }

    let lcs = longest_common_subsequence_len(&canonical, reverse_scramble_canonical);
    canonical.len().saturating_sub(lcs) <= FMC_REVERSE_NEAR_TOTAL_SLACK
        && reverse_scramble_canonical.len().saturating_sub(lcs)
            <= FMC_REVERSE_NEAR_TOTAL_SLACK
}

fn retain_wca_legal_reverse_candidates(
    candidates: &mut Vec<FmcCandidate>,
    reverse_scramble_canonical: &[u8],
) -> usize {
    let before = candidates.len();
    candidates.retain(|candidate| {
        !is_disallowed_reverse_derived_solution(&candidate.moves, reverse_scramble_canonical)
    });
    before.saturating_sub(candidates.len())
}
'''
rust = replace_once(rust, old_rust_guard, new_rust_guard, "Rust reverse guard")
rust = rust.replace(
    "is_trivial_reverse_solution",
    "is_disallowed_reverse_derived_solution",
)
rust = rust.replace(
    "retain_nontrivial_reverse_candidates",
    "retain_wca_legal_reverse_candidates",
)
rust += r'''

#[cfg(test)]
mod reverse_derivation_policy_tests {
    use super::is_disallowed_reverse_derived_solution;

    fn reverse_fixture() -> Vec<u8> {
        // U R F D L B U2 R2 F2 D2 L2 B2: every neighboring move changes axis.
        vec![0, 3, 6, 9, 12, 15, 1, 4, 7, 10, 13, 16]
    }

    #[test]
    fn rejects_wca_four_move_inverse_prefix() {
        let reverse = reverse_fixture();
        assert!(is_disallowed_reverse_derived_solution(
            &[0, 3, 6, 9, 5, 8, 2],
            &reverse,
        ));
    }

    #[test]
    fn allows_three_move_prefix_without_other_significant_overlap() {
        let reverse = reverse_fixture();
        assert!(!is_disallowed_reverse_derived_solution(
            &[0, 3, 6, 12, 15, 2, 5],
            &reverse,
        ));
    }

    #[test]
    fn rejects_six_move_internal_inverse_block() {
        let reverse = reverse_fixture();
        assert!(is_disallowed_reverse_derived_solution(
            &[4, 7, 3, 6, 9, 12, 15, 1, 14],
            &reverse,
        ));
    }

    #[test]
    fn allows_five_move_internal_overlap() {
        let reverse = reverse_fixture();
        assert!(!is_disallowed_reverse_derived_solution(
            &[4, 7, 3, 6, 9, 12, 15, 14],
            &reverse,
        ));
    }

    #[test]
    fn rejects_near_total_inverse_derivation_without_long_block() {
        let reverse = reverse_fixture();
        let variant = vec![2, 3, 6, 9, 12, 15, 2, 4, 7, 10, 13, 16];
        assert!(is_disallowed_reverse_derived_solution(&variant, &reverse));
    }

    #[test]
    fn allows_independent_niss_style_path() {
        let reverse = reverse_fixture();
        let independent = vec![2, 5, 8, 11, 14, 17, 0, 4, 8, 10, 14, 16];
        assert!(!is_disallowed_reverse_derived_solution(
            &independent,
            &reverse,
        ));
    }
}
'''
rust_path.write_text(rust)

js_path = Path("solver/fmcSolver.js")
js = js_path.read_text()
old_js_guard = r'''function isReverseScrambleSolution(solutionText, reverseScrambleCanonical) {
  if (!solutionText || !reverseScrambleCanonical) return false;
  return canonicalizeAlg(solutionText) === reverseScrambleCanonical;
}
'''
new_js_guard = r'''const FMC_REVERSE_PREFIX_DNF_LEN = 4;
const FMC_REVERSE_CONTIGUOUS_DNF_LEN = 6;
const FMC_REVERSE_NEAR_TOTAL_SLACK = 2;

function commonPrefixLength(left, right) {
  const limit = Math.min(left.length, right.length);
  let length = 0;
  while (length < limit && left[length] === right[length]) length += 1;
  return length;
}

function longestCommonContiguousLength(left, right) {
  let previous = new Array(right.length + 1).fill(0);
  let current = new Array(right.length + 1).fill(0);
  let best = 0;
  for (const leftMove of left) {
    current.fill(0);
    for (let index = 0; index < right.length; index += 1) {
      if (leftMove === right[index]) {
        current[index + 1] = previous[index] + 1;
        best = Math.max(best, current[index + 1]);
      }
    }
    [previous, current] = [current, previous];
  }
  return best;
}

function longestCommonSubsequenceLength(left, right) {
  let previous = new Array(right.length + 1).fill(0);
  let current = new Array(right.length + 1).fill(0);
  for (const leftMove of left) {
    current.fill(0);
    for (let index = 0; index < right.length; index += 1) {
      current[index + 1] = leftMove === right[index]
        ? previous[index] + 1
        : Math.max(current[index], previous[index + 1]);
    }
    [previous, current] = [current, previous];
  }
  return previous[right.length];
}

function isReverseScrambleSolution(solutionText, reverseScrambleCanonical) {
  if (!solutionText || !reverseScrambleCanonical) return false;
  const solution = splitMoves(canonicalizeAlg(solutionText));
  const reverse = splitMoves(reverseScrambleCanonical);
  if (solution.join(" ") === reverse.join(" ")) return true;
  if (commonPrefixLength(solution, reverse) >= FMC_REVERSE_PREFIX_DNF_LEN) return true;
  if (longestCommonContiguousLength(solution, reverse) >= FMC_REVERSE_CONTIGUOUS_DNF_LEN) {
    return true;
  }
  const lcs = longestCommonSubsequenceLength(solution, reverse);
  return solution.length - lcs <= FMC_REVERSE_NEAR_TOTAL_SLACK
    && reverse.length - lcs <= FMC_REVERSE_NEAR_TOTAL_SLACK;
}
'''
js = replace_once(js, old_js_guard, new_js_guard, "JavaScript reverse guard")
js = js.replace(
    "// FMC rule: a solution that is simply the inverse scramble is not allowed.",
    "// FMC rule: reject solutions directly derived from significant parts of the inverse scramble.",
)
js_path.write_text(js)

benchmark_path = Path("benchmark-fmc-reverse-scramble-guard.mjs")
benchmark = benchmark_path.read_text()
old_cases_start = benchmark.index("const cases = [")
old_cases_end = benchmark.index("];", old_cases_start) + 2
new_cases = r'''const LONG_SCRAMBLE = "B2 L2 D2 F2 R2 U2 B' L' D' F' R' U'";

const cases = [
  {
    name: "exact inverse",
    scramble: "R U D R'",
    solution: "R D' U' R'",
    expected: true,
  },
  {
    name: "opposite-face commuting inverse",
    scramble: "R U D R'",
    solution: "R U' D' R'",
    expected: true,
  },
  {
    name: "WCA four-move inverse prefix",
    scramble: LONG_SCRAMBLE,
    solution: "U R F D R' F' U'",
    expected: true,
  },
  {
    name: "three-move inverse prefix remains legal",
    scramble: LONG_SCRAMBLE,
    solution: "U R F L B U' R'",
    expected: false,
  },
  {
    name: "six-move internal inverse block",
    scramble: LONG_SCRAMBLE,
    solution: "R2 F2 R F D L B U2 L'",
    expected: true,
  },
  {
    name: "five-move internal overlap remains legal",
    scramble: LONG_SCRAMBLE,
    solution: "R2 F2 R F D L B L'",
    expected: false,
  },
  {
    name: "near-total inverse derivation split into short blocks",
    scramble: LONG_SCRAMBLE,
    solution: "U' R F D L B U' R2 F2 D2 L2 B2",
    expected: true,
  },
  {
    name: "independent NISS-style path",
    scramble: LONG_SCRAMBLE,
    solution: "U' R' F' D' L' B' U R2 F' D2 L' B2",
    expected: false,
  },
]'''
benchmark = benchmark[:old_cases_start] + new_cases + benchmark[old_cases_end:]
benchmark_path.write_text(benchmark)

Path(".github/workflows/apply-fmc-wca-reverse-guard-once.yml").unlink()
Path("tools/apply-fmc-wca-reverse-guard.py").unlink()
