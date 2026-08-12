export const LITERAL_INVERSE_EXEMPT_MOVE_COUNT = 4;

function splitOuterMoves(sequence) {
  return String(sequence || "")
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.endsWith("2'") ? `${token[0]}2` : token);
}

function outerMoveTurnAmount(token) {
  const normalized = String(token || "").trim();
  if (!/^[URFDLB](2|'|2')?$/.test(normalized)) return null;
  if (normalized.endsWith("2") || normalized.endsWith("2'")) return 2;
  if (normalized.endsWith("'")) return 3;
  return 1;
}

function outerMoveFromTurnAmount(face, amount) {
  const normalized = ((Number(amount) % 4) + 4) % 4;
  if (normalized === 0) return "";
  if (normalized === 1) return face;
  if (normalized === 2) return `${face}2`;
  return `${face}'`;
}

function canonicalizeOuterMoves(moves) {
  const canonical = [];
  for (const token of moves) {
    const amount = outerMoveTurnAmount(token);
    if (amount === null) return null;
    const face = token[0];
    const previous = canonical[canonical.length - 1];
    if (previous && previous[0] === face) {
      const previousAmount = outerMoveTurnAmount(previous);
      const combined = outerMoveFromTurnAmount(face, previousAmount + amount);
      if (combined) {
        canonical[canonical.length - 1] = combined;
      } else {
        canonical.pop();
      }
      continue;
    }
    canonical.push(outerMoveFromTurnAmount(face, amount));
  }
  return canonical;
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
  const canonical = canonicalizeOuterMoves(moves);
  return canonical ? canonical.join(" ") : "";
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
  return normalizeOuterAlgorithm(inverse.join(" "));
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
