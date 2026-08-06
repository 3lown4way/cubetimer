use serde::Deserialize;

use crate::minmove_core::{CubeState, CORNER_COUNT, EDGE_COUNT};

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct CubieStateInput {
    pub cp: [u8; CORNER_COUNT],
    pub co: [u8; CORNER_COUNT],
    pub ep: [u8; EDGE_COUNT],
    pub eo: [u8; EDGE_COUNT],
}

fn permutation_is_odd<const N: usize>(permutation: &[u8; N]) -> bool {
    let mut odd = false;
    for first in 0..N {
        for second in (first + 1)..N {
            if permutation[first] > permutation[second] {
                odd = !odd;
            }
        }
    }
    odd
}

fn validate_permutation<const N: usize>(values: &[u8; N], label: &str) -> Result<(), String> {
    let mut seen = [false; N];
    for &value in values {
        let index = value as usize;
        if index >= N || seen[index] {
            return Err(format!("TWOPHASE_CUBIE_{label}_INVALID"));
        }
        seen[index] = true;
    }
    Ok(())
}

pub fn validate_cubie_state(input: CubieStateInput) -> Result<CubeState, String> {
    validate_permutation(&input.cp, "CP")?;
    validate_permutation(&input.ep, "EP")?;

    if input.co.iter().any(|&value| value >= 3)
        || input.co.iter().map(|&value| value as usize).sum::<usize>() % 3 != 0
    {
        return Err("TWOPHASE_CUBIE_CO_INVALID".into());
    }
    if input.eo.iter().any(|&value| value >= 2)
        || input.eo.iter().map(|&value| value as usize).sum::<usize>() % 2 != 0
    {
        return Err("TWOPHASE_CUBIE_EO_INVALID".into());
    }
    if permutation_is_odd(&input.cp) != permutation_is_odd(&input.ep) {
        return Err("TWOPHASE_CUBIE_PARITY_INVALID".into());
    }

    Ok(CubeState {
        cp: input.cp,
        co: input.co,
        ep: input.ep,
        eo: input.eo,
    })
}

pub fn parse_cubie_state_json(input_json: &str) -> Result<CubeState, String> {
    let input = serde_json::from_str::<CubieStateInput>(input_json)
        .map_err(|error| format!("TWOPHASE_CUBIE_JSON_INVALID:{error}"))?;
    validate_cubie_state(input)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solved() -> CubieStateInput {
        CubieStateInput {
            cp: [0, 1, 2, 3, 4, 5, 6, 7],
            co: [0; 8],
            ep: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
            eo: [0; 12],
        }
    }

    #[test]
    fn solved_cubie_state_is_accepted() {
        assert!(validate_cubie_state(solved()).unwrap().is_solved());
    }

    #[test]
    fn duplicate_corner_is_rejected() {
        let mut input = solved();
        input.cp[7] = 6;
        assert_eq!(
            validate_cubie_state(input).unwrap_err(),
            "TWOPHASE_CUBIE_CP_INVALID"
        );
    }

    #[test]
    fn odd_edge_flip_is_rejected() {
        let mut input = solved();
        input.eo[0] = 1;
        assert_eq!(
            validate_cubie_state(input).unwrap_err(),
            "TWOPHASE_CUBIE_EO_INVALID"
        );
    }

    #[test]
    fn permutation_parity_mismatch_is_rejected() {
        let mut input = solved();
        input.ep.swap(0, 1);
        assert_eq!(
            validate_cubie_state(input).unwrap_err(),
            "TWOPHASE_CUBIE_PARITY_INVALID"
        );
    }
}
