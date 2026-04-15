/**
 * Roux-specific prune tables and heuristics
 * Inspired by CFOP cross/F2L prune tables
 */

// FB state encoding: 7 pieces (4 corners + 3 edges)
// Each piece: position (0-7 for corners, 0-11 for edges) + orientation
// Simplified: just track which pieces are in FB slots

// FB slots: corners [0,3,4,7], edges [3,6,8]
// FB pieces: corners [0,3,4,7], edges [3,6,8]

const FB_CORNER_POSITIONS = [0, 3, 4, 7];
const FB_EDGE_POSITIONS = [3, 6, 8];
const SB_CORNER_POSITIONS = [1, 2, 5, 6];
const SB_EDGE_POSITIONS = [1, 4, 5];

// FB progress: count how many FB pieces are in correct FB slots
function getFBProgress(data, solvedData) {
  let cornerProgress = 0;
  let edgeProgress = 0;
  
  for (const pos of FB_CORNER_POSITIONS) {
    if (data.CORNERS.pieces[pos] >= 0 && data.CORNERS.pieces[pos] <= 7) {
      // Check if it's one of the FB corner pieces
      if (FB_CORNER_POSITIONS.includes(data.CORNERS.pieces[pos])) {
        cornerProgress++;
      }
    }
  }
  
  for (const pos of FB_EDGE_POSITIONS) {
    if (data.EDGES.pieces[pos] >= 0 && data.EDGES.pieces[pos] <= 11) {
      if (FB_EDGE_POSITIONS.includes(data.EDGES.pieces[pos])) {
        edgeProgress++;
      }
    }
  }
  
  return {
    cornerProgress,
    edgeProgress,
    totalProgress: cornerProgress + edgeProgress,
    maxProgress: FB_CORNER_POSITIONS.length + FB_EDGE_POSITIONS.length,
  };
}

// SB progress: count how many SB pieces are in correct SB slots
function getSBProgress(data, solvedData) {
  let cornerProgress = 0;
  let edgeProgress = 0;
  
  for (const pos of SB_CORNER_POSITIONS) {
    if (data.CORNERS.pieces[pos] >= 0 && data.CORNERS.pieces[pos] <= 7) {
      if (SB_CORNER_POSITIONS.includes(data.CORNERS.pieces[pos])) {
        cornerProgress++;
      }
    }
  }
  
  for (const pos of SB_EDGE_POSITIONS) {
    if (data.EDGES.pieces[pos] >= 0 && data.EDGES.pieces[pos] <= 11) {
      if (SB_EDGE_POSITIONS.includes(data.EDGES.pieces[pos])) {
        edgeProgress++;
      }
    }
  }
  
  return {
    cornerProgress,
    edgeProgress,
    totalProgress: cornerProgress + edgeProgress,
    maxProgress: SB_CORNER_POSITIONS.length + SB_EDGE_POSITIONS.length,
  };
}

// Score FB using CFOP-style multi-level metric
function scoreFBImproved(pattern, ctx) {
  if (!pattern?.patternData || !ctx?.solvedPattern?.patternData) return 0;
  
  const data = pattern.patternData;
  const solvedData = ctx.solvedPattern.patternData;
  
  const progress = getFBProgress(data, solvedData);
  
  // Level 1: progress score (0-7)
  const progressScore = progress.totalProgress * 100;
  
  // Level 2: exact placement bonus
  let exactScore = 0;
  for (const pos of FB_CORNER_POSITIONS) {
    if (data.CORNERS.pieces[pos] === solvedData.CORNERS.pieces[pos]) {
      exactScore += 50;
      if (data.CORNERS.orientation[pos] === solvedData.CORNERS.orientation[pos]) {
        exactScore += 25;
      }
    }
  }
  for (const pos of FB_EDGE_POSITIONS) {
    if (data.EDGES.pieces[pos] === solvedData.EDGES.pieces[pos]) {
      exactScore += 50;
      if (data.EDGES.orientation[pos] === solvedData.EDGES.orientation[pos]) {
        exactScore += 25;
      }
    }
  }
  
  // Level 3: penalty for pieces outside FB
  let penalty = 0;
  for (const pos of FB_CORNER_POSITIONS) {
    if (!FB_CORNER_POSITIONS.includes(data.CORNERS.pieces[pos])) {
      penalty += 30;
    }
  }
  for (const pos of FB_EDGE_POSITIONS) {
    if (!FB_EDGE_POSITIONS.includes(data.EDGES.pieces[pos])) {
      penalty += 30;
    }
  }
  
  return progressScore + exactScore - penalty;
}

// Score SB using CFOP-style multi-level metric
function scoreSBImproved(pattern, ctx) {
  if (!pattern?.patternData || !ctx?.solvedPattern?.patternData) return 0;
  
  const data = pattern.patternData;
  const solvedData = ctx.solvedPattern.patternData;
  
  const progress = getSBProgress(data, solvedData);
  
  // Level 1: progress score (0-7)
  const progressScore = progress.totalProgress * 100;
  
  // Level 2: exact placement bonus
  let exactScore = 0;
  for (const pos of SB_CORNER_POSITIONS) {
    if (data.CORNERS.pieces[pos] === solvedData.CORNERS.pieces[pos]) {
      exactScore += 50;
      if (data.CORNERS.orientation[pos] === solvedData.CORNERS.orientation[pos]) {
        exactScore += 25;
      }
    }
  }
  for (const pos of SB_EDGE_POSITIONS) {
    if (data.EDGES.pieces[pos] === solvedData.EDGES.pieces[pos]) {
      exactScore += 50;
      if (data.EDGES.orientation[pos] === solvedData.EDGES.orientation[pos]) {
        exactScore += 25;
      }
    }
  }
  
  // Level 3: penalty for pieces outside SB
  let penalty = 0;
  for (const pos of SB_CORNER_POSITIONS) {
    if (!SB_CORNER_POSITIONS.includes(data.CORNERS.pieces[pos])) {
      penalty += 30;
    }
  }
  for (const pos of SB_EDGE_POSITIONS) {
    if (!SB_EDGE_POSITIONS.includes(data.EDGES.pieces[pos])) {
      penalty += 30;
    }
  }
  
  return progressScore + exactScore - penalty;
}

export {
  getFBProgress,
  getSBProgress,
  scoreFBImproved,
  scoreSBImproved,
  FB_CORNER_POSITIONS,
  FB_EDGE_POSITIONS,
  SB_CORNER_POSITIONS,
  SB_EDGE_POSITIONS,
};
