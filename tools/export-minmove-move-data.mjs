import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cube3x3x3 } from "../vendor/cubing/puzzles/index.js";

const MOVE_NAMES = Object.freeze([
  "U", "U2", "U'",
  "R", "R2", "R'",
  "F", "F2", "F'",
  "D", "D2", "D'",
  "L", "L2", "L'",
  "B", "B2", "B'",
]);

const FACE_INDEX = Object.freeze({ U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 });

function asArray(value, label) {
  if (!value || typeof value.length !== "number") {
    throw new Error(`MINMOVE_EXPORT_${label}_MISSING`);
  }
  return Array.from(value, (entry) => Number(entry));
}

function findOrbit(patternData, pieceCount, label) {
  const matches = [];
  for (const [name, orbit] of Object.entries(patternData || {})) {
    const pieces = orbit?.pieces ?? orbit?.permutation;
    const orientation = orbit?.orientation;
    if (pieces?.length === pieceCount && orientation?.length === pieceCount) {
      matches.push({ name, orbit, pieces: asArray(pieces, `${label}_PIECES`), orientation: asArray(orientation, `${label}_ORIENTATION`) });
    }
  }
  if (matches.length !== 1) {
    throw new Error(`MINMOVE_EXPORT_${label}_ORBIT_AMBIGUOUS:${matches.map((entry) => entry.name).join(",")}`);
  }
  return matches[0];
}

function identity(size) {
  return Array.from({ length: size }, (_, index) => index);
}

function zeros(size) {
  return Array.from({ length: size }, () => 0);
}

function composeTransform(left, right, modulus) {
  const size = left.permutation.length;
  const permutation = new Array(size);
  const orientation = new Array(size);
  for (let newPosition = 0; newPosition < size; newPosition += 1) {
    const intermediatePosition = right.permutation[newPosition];
    permutation[newPosition] = left.permutation[intermediatePosition];
    orientation[newPosition] = (
      left.orientation[intermediatePosition] + right.orientation[newPosition]
    ) % modulus;
  }
  return { permutation, orientation };
}

function powerTransform(transform, exponent, modulus) {
  let result = {
    permutation: identity(transform.permutation.length),
    orientation: zeros(transform.orientation.length),
  };
  for (let index = 0; index < exponent; index += 1) {
    result = composeTransform(result, transform, modulus);
  }
  return result;
}

function assertIdentity(transform, label) {
  const expectedPermutation = identity(transform.permutation.length);
  const expectedOrientation = zeros(transform.orientation.length);
  if (
    transform.permutation.some((value, index) => value !== expectedPermutation[index])
    || transform.orientation.some((value, index) => value !== expectedOrientation[index])
  ) {
    throw new Error(`MINMOVE_EXPORT_${label}_NOT_IDENTITY`);
  }
}

function assertPermutation(values, size, label) {
  if (values.length !== size) throw new Error(`MINMOVE_EXPORT_${label}_LENGTH`);
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.some((value, index) => value !== index)) {
    throw new Error(`MINMOVE_EXPORT_${label}_INVALID_PERMUTATION`);
  }
}

function assertOrientations(values, modulus, label) {
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value >= modulus)) {
    throw new Error(`MINMOVE_EXPORT_${label}_INVALID_ORIENTATION`);
  }
}

async function main() {
  const loader = typeof cube3x3x3 === "function" ? await cube3x3x3() : cube3x3x3;
  const kpuzzle = await loader.kpuzzle();
  const solved = kpuzzle.defaultPattern();

  const transforms = [];
  for (const moveName of MOVE_NAMES) {
    const moved = solved.applyAlg(moveName);
    const patternData = moved?.patternData;
    const corners = findOrbit(patternData, 8, "CORNERS");
    const edges = findOrbit(patternData, 12, "EDGES");

    assertPermutation(corners.pieces, 8, `${moveName}_CORNERS`);
    assertPermutation(edges.pieces, 12, `${moveName}_EDGES`);
    assertOrientations(corners.orientation, 3, `${moveName}_CORNERS`);
    assertOrientations(edges.orientation, 2, `${moveName}_EDGES`);

    transforms.push({
      moveName,
      corner: { permutation: corners.pieces, orientation: corners.orientation },
      edge: { permutation: edges.pieces, orientation: edges.orientation },
    });
  }

  for (let face = 0; face < 6; face += 1) {
    const quarter = transforms[face * 3];
    const half = transforms[face * 3 + 1];
    const inverse = transforms[face * 3 + 2];

    assertIdentity(powerTransform(quarter.corner, 4, 3), `${quarter.moveName}_CORNER_ORDER4`);
    assertIdentity(powerTransform(quarter.edge, 4, 2), `${quarter.moveName}_EDGE_ORDER4`);
    assertIdentity(powerTransform(half.corner, 2, 3), `${half.moveName}_CORNER_ORDER2`);
    assertIdentity(powerTransform(half.edge, 2, 2), `${half.moveName}_EDGE_ORDER2`);
    assertIdentity(composeTransform(quarter.corner, inverse.corner, 3), `${quarter.moveName}_CORNER_INVERSE`);
    assertIdentity(composeTransform(quarter.edge, inverse.edge, 2), `${quarter.moveName}_EDGE_INVERSE`);
  }

  const output = {
    move_names: MOVE_NAMES,
    move_face: MOVE_NAMES.map((moveName) => FACE_INDEX[moveName[0]]),
    corner_perm_map: transforms.flatMap((entry) => entry.corner.permutation),
    corner_ori_delta: transforms.flatMap((entry) => entry.corner.orientation),
    edge_perm_map: transforms.flatMap((entry) => entry.edge.permutation),
    edge_ori_delta: transforms.flatMap((entry) => entry.edge.orientation),
  };

  if (
    output.corner_perm_map.length !== 18 * 8
    || output.corner_ori_delta.length !== 18 * 8
    || output.edge_perm_map.length !== 18 * 12
    || output.edge_ori_delta.length !== 18 * 12
  ) {
    throw new Error("MINMOVE_EXPORT_OUTPUT_LENGTH_INVALID");
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const outputDir = path.resolve(scriptDir, "../solver-wasm/assets");
  const outputPath = path.join(outputDir, "minmove_move_data.json");
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Wrote minmove move data: ${outputPath}`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
