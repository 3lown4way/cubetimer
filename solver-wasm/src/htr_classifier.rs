use crate::minmove_core::{
    encode_perm8, decode_perm8, CubeState, CP_SIZE,
};
use wasm_bindgen::prelude::*;

const FACT: [usize; 8] = [1, 1, 2, 6, 24, 120, 720, 5040];

#[wasm_bindgen]
pub struct HTRSubset {
    pub cxe_type: u8,
    pub qt_estimate: u8,
    pub quality: u8,
}

impl Default for HTRSubset {
    fn default() -> Self {
        Self {
            cxe_type: 0,
            qt_estimate: 5,
            quality: 0,
        }
    }
}

impl HTRSubset {
    pub fn new(cxe_type: u8, qt_estimate: u8, quality: u8) -> Self {
        Self {
            cxe_type,
            qt_estimate,
            quality,
        }
    }
}

pub fn calculate_perm_parity(perm_idx: usize, size: usize) -> u8 {
    let mut parity = 0u8;
    let mut pool: Vec<usize> = (0..size).collect();
    let mut idx = perm_idx;
    for i in 0..size {
        let f = FACT[size - 1 - i];
        let digit = idx / f;
        idx %= f;
        for j in digit..size - 1 {
            pool[j] = pool[j + 1];
        }
        if digit % 2 == 1 {
            parity ^= 1;
        }
    }
    parity
}

pub fn is_cp_identity(cp_idx: usize) -> bool {
    cp_idx == 0
}

pub fn count_misoriented_corners(cp_idx: usize) -> u8 {
    if cp_idx == 0 {
        return 0;
    }
    let mut cp = [0u8; 8];
    decode_perm8(cp_idx, &mut cp);
    let mut misoriented = 0u8;
    for i in 0..8 {
        if cp[i] != i as u8 {
            misoriented += 1;
        }
    }
    misoriented
}

pub fn estimate_quarter_turns(cxe_type: u8, misoriented: u8) -> u8 {
    match cxe_type {
        0 => {
            if misoriented == 0 {
                0
            } else if misoriented <= 2 {
                3
            } else {
                4
            }
        }
        2 => {
            if misoriented <= 2 {
                3
            } else if misoriented <= 4 {
                4
            } else {
                5
            }
        }
        4 => {
            if misoriented == 4 {
                2
            } else if misoriented <= 4 {
                3
            } else {
                4
            }
        }
        _ => 5,
    }
}

pub fn classify_quality(qt_estimate: u8) -> u8 {
    if qt_estimate <= 2 {
        2
    } else if qt_estimate <= 3 {
        1
    } else {
        0
    }
}

#[wasm_bindgen]
pub fn classify_htr_subset(cp_idx: u32, ep_idx: u32, sep_idx: u32) -> HTRSubset {
    let cp = cp_idx as usize;
    let ep = ep_idx as usize;
    let _sep = sep_idx as usize;

    let cp_parity = calculate_perm_parity(cp, 8);
    let ep_parity = calculate_perm_parity(ep, 8);
    let cp_is_identity = is_cp_identity(cp);
    let misoriented = count_misoriented_corners(cp);

    let cxe_type = if cp_is_identity {
        0
    } else if cp_parity == 1 && ep_parity == 1 {
        2
    } else {
        4
    };

    let qt_estimate = estimate_quarter_turns(cxe_type, misoriented);
    let quality = classify_quality(qt_estimate);

    HTRSubset::new(cxe_type, qt_estimate, quality)
}

#[wasm_bindgen]
pub fn get_htr_subset_name(cxe_type: u8) -> String {
    match cxe_type {
        0 => "0CXE".to_string(),
        2 => "2CXE".to_string(),
        4 => "4CXE".to_string(),
        _ => "UNKNOWN".to_string(),
    }
}

#[wasm_bindgen]
pub fn get_htr_quality_name(quality: u8) -> String {
    match quality {
        2 => "good".to_string(),
        1 => "medium".to_string(),
        _ => "bad".to_string(),
    }
}
