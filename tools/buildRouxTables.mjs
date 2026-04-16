/**
 * Build Roux Pattern Tables (Prune Tables)
 * 
 * Builds exact distance lookup tables for FB and SB stages using BFS.
 * NOT Kociemba - just a custom lookup table for Roux stages.
 */

import { getDefaultPattern } from '../solver/context.js';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// FB/SB Definitions (verified)
// ============================================================

const FB_CORNERS = [2, 3, 5, 6];
const FB_EDGES = [3, 7, 9, 11];

const SB_CORNERS = [0, 1, 4, 7];
const SB_EDGES = [1, 5, 8, 10];

const ALL_MOVES = ["U", "U'", "U2", "D", "D'", "D2", "R", "R'", "R2", "L", "L'", "L2", "F", "F'", "F2", "B", "B'", "B2"];

// SB uses FB-preserving moves (only R, M, U, D and their variants)
// Since M = R L' + x rotation, we'll use: R, R', R2, U, U', U2, D, D', D2, and also L for rotation
const SB_MOVES = ["U", "U'", "U2", "D", "D'", "D2", "R", "R'", "R2", "L", "L'", "L2", "M", "M'", "M2", "r", "r'", "r2"];

// ============================================================
// State Encoding
// ============================================================

function encodeFBState(pattern) {
  const d = pattern.patternData;
  // Encode: corner positions + orientations, edge positions + orientations
  const parts = [];
  for (const i of FB_CORNERS) {
    parts.push(`${d.CORNERS.pieces[i]}:${d.CORNERS.orientation[i]}`);
  }
  for (const i of FB_EDGES) {
    parts.push(`${d.EDGES.pieces[i]}:${d.EDGES.orientation[i]}`);
  }
  return parts.join(",");
}

function encodeSBState(pattern) {
  const d = pattern.patternData;
  const parts = [];
  for (const i of SB_CORNERS) {
    parts.push(`${d.CORNERS.pieces[i]}:${d.CORNERS.orientation[i]}`);
  }
  for (const i of SB_EDGES) {
    parts.push(`${d.EDGES.pieces[i]}:${d.EDGES.orientation[i]}`);
  }
  return parts.join(",");
}

function isFBSolvedState(state) {
  // In solved state, all pieces are 0:0
  return state === "0:0,0:0,0:0,0:0,0:0,0:0,0:0,0:0";
}

function isSBSolvedState(state) {
  return state === "0:0,0:0,0:0,0:0,0:0,0:0,0:0,0:0";
}

// ============================================================
// Build FB Pattern Table
// ============================================================

async function buildFBTable() {
  console.log("Building FB pattern table...");
  const solvedPattern = await getDefaultPattern("333");
  
  const table = new Map();
  const solvedState = encodeFBState(solvedPattern);
  table.set(solvedState, 0);
  
  // BFS
  let frontier = [solvedPattern];
  let depth = 0;
  const maxDepth = 10;
  
  while (depth < maxDepth && frontier.length > 0) {
    const nextFrontier = [];
    const startTime = Date.now();
    
    for (const pattern of frontier) {
      const currentState = encodeFBState(pattern);
      const currentDist = table.get(currentState);
      
      for (const move of ALL_MOVES) {
        let nextPattern;
        try { nextPattern = pattern.applyAlg(move); } catch { continue; }
        
        const nextState = encodeFBState(nextPattern);
        if (!table.has(nextState)) {
          table.set(nextState, currentDist + 1);
          nextFrontier.push(nextPattern);
        }
      }
    }
    
    depth++;
    const elapsed = Date.now() - startTime;
    console.log(`  FB depth ${depth}: ${nextFrontier.length} states, total ${table.size}, ${elapsed}ms`);
    frontier = nextFrontier;
  }
  
  console.log(`FB table complete: ${table.size} states, max depth ${depth}`);
  return table;
}

// ============================================================
// Build SB Pattern Table
// ============================================================

async function buildSBTable() {
  console.log("Building SB pattern table...");
  const solvedPattern = await getDefaultPattern("333");
  
  const table = new Map();
  const solvedState = encodeSBState(solvedPattern);
  table.set(solvedState, 0);
  
  // BFS with SB moves only
  let frontier = [solvedPattern];
  let depth = 0;
  const maxDepth = 12;
  
  while (depth < maxDepth && frontier.length > 0) {
    const nextFrontier = [];
    const startTime = Date.now();
    
    for (const pattern of frontier) {
      const currentState = encodeSBState(pattern);
      const currentDist = table.get(currentState);
      
      for (const move of SB_MOVES) {
        let nextPattern;
        try { nextPattern = pattern.applyAlg(move); } catch { continue; }
        
        const nextState = encodeSBState(nextPattern);
        if (!table.has(nextState)) {
          table.set(nextState, currentDist + 1);
          nextFrontier.push(nextPattern);
        }
      }
    }
    
    depth++;
    const elapsed = Date.now() - startTime;
    console.log(`  SB depth ${depth}: ${nextFrontier.length} states, total ${table.size}, ${elapsed}ms`);
    frontier = nextFrontier;
  }
  
  console.log(`SB table complete: ${table.size} states, max depth ${depth}`);
  return table;
}

// ============================================================
// Save Tables
// ============================================================

function saveTable(table, filename) {
  const obj = {};
  for (const [key, value] of table.entries()) {
    obj[key] = value;
  }
  const json = JSON.stringify(obj);
  fs.writeFileSync(filename, json, 'utf8');
  console.log(`Saved ${filename}: ${json.length} bytes, ${table.size} entries`);
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log("=== Building Roux Pattern Tables ===\n");
  
  const fbTable = await buildFBTable();
  console.log("");
  
  const sbTable = await buildSBTable();
  console.log("");
  
  // Save
  const outDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'solver');
  saveTable(fbTable, path.join(outDir, 'rouxFBTable.json'));
  saveTable(sbTable, path.join(outDir, 'rouxSBTable.json'));
  
  console.log("\n=== Pattern Tables Built ===");
}

main().catch(console.error);
