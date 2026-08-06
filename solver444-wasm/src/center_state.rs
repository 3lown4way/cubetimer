use crate::geometry::{sticker_geometry, FACELET_COUNT};
use crate::Cube444;

impl Cube444 {
    pub fn centers_solved(&self) -> bool {
        for facelet in 0..FACELET_COUNT {
            let position = sticker_geometry(facelet).pos;
            let exposed_axes = [position.x, position.y, position.z]
                .into_iter()
                .filter(|coordinate| coordinate.abs() == 3)
                .count();
            if exposed_axes == 1 && self.stickers()[facelet] != (facelet / 16) as u8 {
                return false;
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solved_cube_has_solved_centers() {
        assert!(Cube444::solved().centers_solved());
    }

    #[test]
    fn wide_turn_breaks_centers_and_inverse_restores_them() {
        let mut state = Cube444::solved();
        state.apply_alg("Rw").unwrap();
        assert!(!state.centers_solved());
        state.apply_alg("Rw'").unwrap();
        assert!(state.centers_solved());
    }

    #[test]
    fn outer_turns_preserve_center_completion() {
        let mut state = Cube444::solved();
        state.apply_alg("R U2 F' D L2 B").unwrap();
        assert!(state.centers_solved());
    }
}
