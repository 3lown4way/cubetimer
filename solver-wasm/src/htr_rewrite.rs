use crate::htr_classifier::classify_htr_subset;

pub struct HTRRewriteResult {
    pub improved: bool,
    pub original_len: usize,
    pub new_len: usize,
    pub new_moves: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct HTRTrigger {
    pub local_moves: &'static [u8],
    pub target_moves: &'static [u8],
    pub subset: u8,
    pub qt_savings: u8,
}

const PHASE2_LOCAL: &[u8] = &[0, 1, 2, 3, 4, 5, 12, 15, 13, 14];

pub const HTR_TRIGGERS: &[HTRTrigger] = &[
    // 4CXE triggers (4 corners need exchange - qt 1-3)
    HTRTrigger { local_moves: &[1, 6, 1], target_moves: &[6], subset: 4, qt_savings: 2 }, // U2 R2 U2 -> R2
    HTRTrigger { local_moves: &[1, 8, 1], target_moves: &[8], subset: 4, qt_savings: 2 }, // U2 F2 U2 -> F2
    HTRTrigger { local_moves: &[1, 9, 1], target_moves: &[9], subset: 4, qt_savings: 2 }, // U2 B2 U2 -> B2
    HTRTrigger { local_moves: &[1, 7, 1], target_moves: &[7], subset: 4, qt_savings: 2 }, // U2 L2 U2 -> L2
    HTRTrigger { local_moves: &[4, 6, 4], target_moves: &[6], subset: 4, qt_savings: 2 }, // D2 R2 D2 -> R2
    HTRTrigger { local_moves: &[4, 7, 4], target_moves: &[7], subset: 4, qt_savings: 2 }, // D2 L2 D2 -> L2
    HTRTrigger { local_moves: &[4, 8, 4], target_moves: &[8], subset: 4, qt_savings: 2 }, // D2 F2 D2 -> F2
    HTRTrigger { local_moves: &[4, 9, 4], target_moves: &[9], subset: 4, qt_savings: 2 }, // D2 B2 D2 -> B2
    HTRTrigger { local_moves: &[1, 1], target_moves: &[], subset: 4, qt_savings: 2 }, // U2 U2 -> nothing
    HTRTrigger { local_moves: &[4, 4], target_moves: &[], subset: 4, qt_savings: 2 }, // D2 D2 -> nothing
    HTRTrigger { local_moves: &[1, 2, 1, 2], target_moves: &[], subset: 4, qt_savings: 4 }, // U2 U' U2 U' -> nothing

    // 2CXE triggers (2 corners need exchange - qt 3-5)
    HTRTrigger { local_moves: &[1, 6, 4], target_moves: &[6, 4], subset: 2, qt_savings: 1 }, // U2 R2 D2 -> R2 D2
    HTRTrigger { local_moves: &[6, 1, 4], target_moves: &[6, 4], subset: 2, qt_savings: 1 }, // R2 U2 D2 -> R2 D2
    HTRTrigger { local_moves: &[8, 1, 9], target_moves: &[8, 9], subset: 2, qt_savings: 1 }, // F2 U2 B2 -> F2 B2
    HTRTrigger { local_moves: &[1, 8, 1], target_moves: &[8], subset: 2, qt_savings: 2 }, // U2 F2 U2 -> F2
    HTRTrigger { local_moves: &[1, 6, 8], target_moves: &[8, 6], subset: 2, qt_savings: 1 }, // U2 R2 F2 -> F2 R2

    // 0CXE triggers (corners solved - 0qt is best, can also use 3qt, 4qt patterns)
    HTRTrigger { local_moves: &[6, 6], target_moves: &[], subset: 0, qt_savings: 2 }, // R2 R2 -> nothing
    HTRTrigger { local_moves: &[7, 7], target_moves: &[], subset: 0, qt_savings: 2 }, // L2 L2 -> nothing
    HTRTrigger { local_moves: &[8, 8], target_moves: &[], subset: 0, qt_savings: 2 }, // F2 F2 -> nothing
    HTRTrigger { local_moves: &[9, 9], target_moves: &[], subset: 0, qt_savings: 2 }, // B2 B2 -> nothing
    HTRTrigger { local_moves: &[6, 4, 6], target_moves: &[6], subset: 0, qt_savings: 2 }, // R2 D2 R2 -> R2
    HTRTrigger { local_moves: &[7, 4, 7], target_moves: &[7], subset: 0, qt_savings: 2 }, // L2 D2 L2 -> L2
];

pub fn try_htr_rewrite(
    p2_moves: &[u8],
    cp: u32,
    ep: u32,
    sep: u32,
    _eo_moves: &[u8],
    _dr_moves: &[u8],
) -> HTRRewriteResult {
    let subset = classify_htr_subset(cp, ep, sep);

    if subset.quality == 0 {
        return HTRRewriteResult {
            improved: false,
            original_len: p2_moves.len(),
            new_len: p2_moves.len(),
            new_moves: p2_moves.to_vec(),
        };
    }

    let original_len = p2_moves.len();
    let mut best_moves = p2_moves.to_vec();
    let mut best_len = original_len;

    for trigger in HTR_TRIGGERS {
        if trigger.subset != subset.cxe_type && subset.cxe_type != 0 {
            continue;
        }

        if let Some((idx, len)) = find_trigger_in_moves(p2_moves, trigger.local_moves) {
            let mut new_moves = Vec::with_capacity(best_len);
            new_moves.extend_from_slice(&p2_moves[..idx]);
            new_moves.extend_from_slice(trigger.target_moves);
            new_moves.extend_from_slice(&p2_moves[idx + len..]);

            let simplified = simplify_moves(&new_moves);
            let new_len = simplified.len();
            if new_len < best_len {
                best_moves = simplified;
                best_len = new_len;
            }
        }
    }

    HTRRewriteResult {
        improved: best_len < original_len,
        original_len,
        new_len: best_len,
        new_moves: best_moves,
    }
}

fn find_trigger_in_moves(moves: &[u8], pattern: &[u8]) -> Option<(usize, usize)> {
    if pattern.is_empty() || moves.len() < pattern.len() {
        return None;
    }

    for i in 0..=moves.len() - pattern.len() {
        let mut found = true;
        for j in 0..pattern.len() {
            if moves[i + j] != pattern[j] {
                found = false;
                break;
            }
        }
        if found {
            return Some((i, pattern.len()));
        }
    }
    None
}

pub fn simplify_moves(input: &[u8]) -> Vec<u8> {
    if input.is_empty() {
        return vec![];
    }

    let mut result = Vec::with_capacity(input.len());
    let mut i = 0;

    while i < input.len() {
        let curr = input[i];
        let curr_face = curr / 3;
        let curr_turn = curr % 3;

        if i + 1 < input.len() {
            let next = input[i + 1];
            let next_face = next / 3;
            let next_turn = next % 3;

            if curr_face == next_face {
                let combined_turn = (curr_turn + next_turn) % 4;
                if combined_turn == 0 {
                    i += 2;
                    continue;
                }
                result.push(curr_face * 3 + (combined_turn - 1) as u8);
                i += 2;
                continue;
            }
        }

        if i + 2 < input.len() && input[i] == curr && input[i + 1] == curr && input[i + 2] == curr {
            result.push(curr_face * 3 + 2);
            i += 3;
            continue;
        }

        result.push(curr);
        i += 1;
    }

    result
}

pub fn to_global_indices(local_moves: &[u8]) -> Vec<u8> {
    local_moves.iter().map(|&local| PHASE2_LOCAL[local as usize]).collect()
}

pub fn to_local_index(global_move: u8) -> Option<u8> {
    PHASE2_LOCAL.iter().position(|&g| g == global_move).map(|p| p as u8)
}