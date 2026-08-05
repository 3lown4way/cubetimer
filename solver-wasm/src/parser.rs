// The legacy 2x2 WASM search currently uses the U/F/R generator set.
// Reject unsupported face turns explicitly so a caller can fall back to the
// full 18-move JavaScript solver instead of silently solving a different state.
pub fn parse_scramble(scramble: &str) -> Option<Vec<usize>> {
    let mut moves = Vec::new();
    for token in scramble.split_whitespace() {
        let trimmed = token.trim();
        if trimmed.is_empty() {
            continue;
        }
        // Accept optional prefixes such as "333:" used by some import formats.
        let core = if let Some(pos) = trimmed.find(':') {
            &trimmed[pos + 1..]
        } else {
            trimmed
        };
        let move_index = match core {
            "U" => 0,
            "U2" => 1,
            "U'" => 2,
            "F" => 3,
            "F2" => 4,
            "F'" => 5,
            "R" => 6,
            "R2" => 7,
            "R'" => 8,
            // D/L/B are valid WCA moves but are not represented by this
            // reduced Rust move table. Returning None is intentional: the
            // worker must use the complete JS fallback for these scrambles.
            _ => return None,
        };
        moves.push(move_index);
    }
    Some(moves)
}

pub fn apply_scramble_to_solved(moves: &[usize]) -> crate::state::State {
    let mut state = crate::state::State::solved();
    for &move_index in moves {
        debug_assert!(move_index < crate::tables::NMOVES);
        state = state.apply_move(move_index);
    }
    state
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_generator_moves() {
        assert_eq!(
            parse_scramble("U F2 R'"),
            Some(vec![0usize, 4usize, 8usize])
        );
    }

    #[test]
    fn rejects_faces_not_present_in_reduced_move_table() {
        for scramble in ["D", "L2", "B'", "U D R"] {
            assert_eq!(parse_scramble(scramble), None);
        }
    }

    #[test]
    fn never_silently_skips_a_parsed_move() {
        let moves = parse_scramble("U F R2").expect("supported scramble");
        let expected = crate::state::State::solved()
            .apply_move(0)
            .apply_move(3)
            .apply_move(7);
        assert_eq!(apply_scramble_to_solved(&moves), expected);
    }
}
