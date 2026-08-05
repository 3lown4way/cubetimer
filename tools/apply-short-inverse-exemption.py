from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one {label} match, found {count}")
    return text.replace(old, new, 1)


policy_path = Path("solver/inverseSolutionPolicy.js")
policy = policy_path.read_text()
policy = replace_once(
    policy,
    'function splitOuterMoves(sequence) {',
    'export const LITERAL_INVERSE_EXEMPT_MOVE_COUNT = 4;\n\nfunction splitOuterMoves(sequence) {',
    "policy constant",
)
policy += '''\nexport function shouldRejectLiteralInverseSolution(scramble, solution) {\n  const scrambleLength = splitOuterMoves(scramble).length;\n  return (\n    scrambleLength > LITERAL_INVERSE_EXEMPT_MOVE_COUNT\n    && isLiteralInverseSolution(scramble, solution)\n  );\n}\n'''
policy_path.write_text(policy)

minmove_path = Path("solver/minmoveExactV2.js")
minmove = minmove_path.read_text()
minmove = replace_once(
    minmove,
    'import { isLiteralInverseSolution, normalizeOuterAlgorithm } from "./inverseSolutionPolicy.js";',
    'import {\n  LITERAL_INVERSE_EXEMPT_MOVE_COUNT,\n  normalizeOuterAlgorithm,\n  shouldRejectLiteralInverseSolution,\n} from "./inverseSolutionPolicy.js";',
    "minmove policy import",
)
minmove = minmove.replace("isLiteralInverseSolution(", "shouldRejectLiteralInverseSolution(")
minmove = replace_once(
    minmove,
    '''  const inverseUpperBoundLength = splitMoves(inverseScramble).length;
  let incumbentSolution = "";
  let incumbentLength = inverseUpperBoundLength;
  let incumbentSource = "inverse_upper_bound_only";''',
    '''  const inverseUpperBoundLength = splitMoves(inverseScramble).length;
  const rejectLiteralInverse = inverseUpperBoundLength > LITERAL_INVERSE_EXEMPT_MOVE_COUNT;
  let incumbentSolution = rejectLiteralInverse ? "" : inverseScramble;
  let incumbentLength = inverseUpperBoundLength;
  let incumbentSource = rejectLiteralInverse ? "inverse_upper_bound_only" : "short_inverse_exception";''',
    "short inverse incumbent",
)
minmove = replace_once(
    minmove,
    '''      excludedSolution: inverseScramble,''',
    '''      excludedSolution: rejectLiteralInverse ? inverseScramble : "",''',
    "normal direction exclusion",
)
minmove = replace_once(
    minmove,
    '''      excludedSolution: normalizedScramble,''',
    '''      excludedSolution: rejectLiteralInverse ? normalizedScramble : "",''',
    "inverse direction exclusion",
)
minmove_path.write_text(minmove)

worker_path = Path("solver/solverWorker.js")
worker = worker_path.read_text()
worker = replace_once(
    worker,
    'import { isLiteralInverseSolution } from "./inverseSolutionPolicy.js";',
    'import { shouldRejectLiteralInverseSolution } from "./inverseSolutionPolicy.js";',
    "worker policy import",
)
worker = worker.replace("isLiteralInverseSolution(", "shouldRejectLiteralInverseSolution(")
worker = replace_once(
    worker,
    '''            excludedSolution: inverseSolution || undefined,''',
    '''            excludedSolution: countAlgorithmMoves(scramble) > 4 ? inverseSolution : undefined,''',
    "short two-phase exclusion exemption",
)
worker_path.write_text(worker)

benchmark_path = Path("benchmark-inverse-output-contract.mjs")
benchmark = benchmark_path.read_text()
benchmark = replace_once(
    benchmark,
    '''  invertOuterAlgorithm,
  isLiteralInverseSolution,
} from "./solver/inverseSolutionPolicy.js";''',
    '''  invertOuterAlgorithm,
  isLiteralInverseSolution,
  shouldRejectLiteralInverseSolution,
} from "./solver/inverseSolutionPolicy.js";''',
    "benchmark policy import",
)
benchmark = replace_once(
    benchmark,
    '''assert.equal(isLiteralInverseSolution(SCRAMBLE, REPORTED_INVERSE), true);

const workerSource''',
    '''assert.equal(isLiteralInverseSolution(SCRAMBLE, REPORTED_INVERSE), true);
assert.equal(shouldRejectLiteralInverseSolution(SCRAMBLE, REPORTED_INVERSE), true);
const shortScramble = "R U R' U'";
const shortInverse = invertOuterAlgorithm(shortScramble);
assert.equal(isLiteralInverseSolution(shortScramble, shortInverse), true);
assert.equal(shouldRejectLiteralInverseSolution(shortScramble, shortInverse), false);

const workerSource''',
    "short exemption assertion",
)
benchmark = replace_once(
    benchmark,
    '''assert.match(workerSource, /excludedSolution:\\s*inverseSolution\\s*\\|\\|\\s*undefined/);''',
    '''assert.match(workerSource, /excludedSolution:\\s*countAlgorithmMoves\\(scramble\\)\\s*>\\s*4\\s*\\?\\s*inverseSolution\\s*:\\s*undefined/);''',
    "worker exclusion marker",
)
benchmark_path.write_text(benchmark)

Path("tools/apply-short-inverse-exemption.py").unlink(missing_ok=True)
