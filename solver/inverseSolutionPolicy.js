export const LITERAL_INVERSE_EXEMPT_MOVE_COUNT = 4;

function splitOuterMoves(sequence) {
  return String(sequence || "")
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.endsWith("2'") ? `${token[0]}2` : token);
}

function invertOuterMove(token) {
  const normalized = String(token || "").trim();
  if (!/^[URFDLB](2|'|2')?$/.test(normalized)) return "";
  if (normalized.endsWith("2") || normalized.endsWith("2'")) return `${normalized[0]}2`;
  if (normalized.endsWith("'")) return normalized.slice(0, -1);
  return `${normalized}'`;
}

export function normalizeOuterAlgorithm(sequence) {
  const moves = splitOuterMoves(sequence);
  if (moves.some((token) => !/^[URFDLB](2|'|2')?$/.test(token))) return "";
  return moves.join(" ");
}

export function invertOuterAlgorithm(sequence) {
  const moves = splitOuterMoves(sequence);
  if (!moves.length) return "";
  const inverse = [];
  for (let index = moves.length - 1; index >= 0; index -= 1) {
    const inverted = invertOuterMove(moves[index]);
    if (!inverted) return "";
    inverse.push(inverted);
  }
  return inverse.join(" ");
}

export function isSameOuterAlgorithm(left, right) {
  const normalizedLeft = normalizeOuterAlgorithm(left);
  const normalizedRight = normalizeOuterAlgorithm(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function isLiteralInverseSolution(scramble, solution) {
  const inverse = invertOuterAlgorithm(scramble);
  return Boolean(inverse && isSameOuterAlgorithm(solution, inverse));
}

export function shouldRejectLiteralInverseSolution(scramble, solution) {
  const scrambleLength = splitOuterMoves(scramble).length;
  return (
    scrambleLength > LITERAL_INVERSE_EXEMPT_MOVE_COUNT
    && isLiteralInverseSolution(scramble, solution)
  );
}
