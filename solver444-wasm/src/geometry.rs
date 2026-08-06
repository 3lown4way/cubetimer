use crate::moves::{Face, Move444};

pub const N: usize = 4;
pub const FACELET_COUNT: usize = 6 * N * N;
pub const COORDS: [i8; N] = [-3, -1, 1, 3];

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Ord, PartialOrd)]
pub struct Vec3 {
    pub x: i8,
    pub y: i8,
    pub z: i8,
}

impl Vec3 {
    pub const fn new(x: i8, y: i8, z: i8) -> Self {
        Self { x, y, z }
    }

    pub fn axis(self, face: Face) -> i8 {
        match face {
            Face::R | Face::L => self.x,
            Face::U | Face::D => self.y,
            Face::F | Face::B => self.z,
        }
    }

    pub fn rotate_quarter(self, face: Face) -> Self {
        match face {
            // Clockwise turns viewed from outside the named face.
            Face::R => Self::new(self.x, -self.z, self.y),
            Face::L => Self::new(self.x, self.z, -self.y),
            Face::U => Self::new(self.z, self.y, -self.x),
            Face::D => Self::new(-self.z, self.y, self.x),
            Face::F => Self::new(self.y, -self.x, self.z),
            Face::B => Self::new(-self.y, self.x, self.z),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct StickerGeometry {
    pub pos: Vec3,
    pub normal: Vec3,
}

pub fn sticker_geometry(index: usize) -> StickerGeometry {
    assert!(index < FACELET_COUNT, "facelet index out of range");
    let face = index / (N * N);
    let within = index % (N * N);
    let row = within / N;
    let col = within % N;

    match face {
        // U: top row is adjacent to B; bottom row is adjacent to F.
        0 => StickerGeometry {
            pos: Vec3::new(COORDS[col], 3, COORDS[row]),
            normal: Vec3::new(0, 1, 0),
        },
        // R: left edge is adjacent to F; right edge is adjacent to B.
        1 => StickerGeometry {
            pos: Vec3::new(3, COORDS[N - 1 - row], COORDS[N - 1 - col]),
            normal: Vec3::new(1, 0, 0),
        },
        // F.
        2 => StickerGeometry {
            pos: Vec3::new(COORDS[col], COORDS[N - 1 - row], 3),
            normal: Vec3::new(0, 0, 1),
        },
        // D: top row is adjacent to F; bottom row is adjacent to B.
        3 => StickerGeometry {
            pos: Vec3::new(COORDS[col], -3, COORDS[N - 1 - row]),
            normal: Vec3::new(0, -1, 0),
        },
        // L: left edge is adjacent to B; right edge is adjacent to F.
        4 => StickerGeometry {
            pos: Vec3::new(-3, COORDS[N - 1 - row], COORDS[col]),
            normal: Vec3::new(-1, 0, 0),
        },
        // B: left edge is adjacent to R; right edge is adjacent to L.
        5 => StickerGeometry {
            pos: Vec3::new(COORDS[N - 1 - col], COORDS[N - 1 - row], -3),
            normal: Vec3::new(0, 0, -1),
        },
        _ => unreachable!(),
    }
}

pub fn geometry_index(target: StickerGeometry) -> usize {
    for index in 0..FACELET_COUNT {
        if sticker_geometry(index) == target {
            return index;
        }
    }
    panic!("invalid sticker geometry: {target:?}");
}

fn layer_selected(pos: Vec3, mv: Move444) -> bool {
    let axis = pos.axis(mv.face());
    let side = mv.face().axis_sign();
    if mv.is_wide() {
        axis == side * 3 || axis == side
    } else {
        axis == side * 3
    }
}

pub fn quarter_turn_permutation(mv: Move444) -> [u8; FACELET_COUNT] {
    let base = mv.with_amount(1);
    let mut permutation = [0u8; FACELET_COUNT];
    for (old_index, target_index) in permutation.iter_mut().enumerate() {
        let mut geometry = sticker_geometry(old_index);
        if layer_selected(geometry.pos, base) {
            geometry.pos = geometry.pos.rotate_quarter(base.face());
            geometry.normal = geometry.normal.rotate_quarter(base.face());
        }
        *target_index = geometry_index(geometry) as u8;
    }
    permutation
}

pub fn move_permutation(mv: Move444) -> [u8; FACELET_COUNT] {
    let quarter = quarter_turn_permutation(mv);
    let mut result = core::array::from_fn(|index| index as u8);
    for _ in 0..mv.amount() {
        let previous = result;
        for (old_index, target_index) in result.iter_mut().enumerate() {
            *target_index = quarter[previous[old_index] as usize];
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    const U: usize = 0;
    const R: usize = 16;
    const F: usize = 32;
    const D: usize = 48;
    const L: usize = 64;
    const B: usize = 80;

    fn row(face: usize, row: usize) -> [usize; N] {
        core::array::from_fn(|col| face + row * N + col)
    }

    fn col(face: usize, col: usize) -> [usize; N] {
        core::array::from_fn(|row| face + row * N + col)
    }

    fn assert_strip(
        permutation: &[u8; FACELET_COUNT],
        source: [usize; N],
        target: [usize; N],
        reversed: bool,
    ) {
        for (offset, source_index) in source.into_iter().enumerate() {
            let target_offset = if reversed { N - 1 - offset } else { offset };
            assert_eq!(
                permutation[source_index] as usize, target[target_offset],
                "facelet {source_index} mapped to {}, expected {}",
                permutation[source_index], target[target_offset]
            );
        }
    }

    #[test]
    fn all_facelets_have_unique_geometry() {
        let mut geometries = Vec::new();
        for index in 0..FACELET_COUNT {
            let geometry = sticker_geometry(index);
            assert!(
                !geometries.contains(&geometry),
                "duplicate geometry at {index}"
            );
            geometries.push(geometry);
            assert_eq!(geometry_index(geometry), index);
        }
    }

    #[test]
    fn each_move_permutation_is_bijective() {
        for mv in Move444::all() {
            let permutation = move_permutation(mv);
            let mut seen = [false; FACELET_COUNT];
            for target in permutation {
                assert!(!seen[target as usize], "duplicate target for {mv}");
                seen[target as usize] = true;
            }
            assert!(seen.into_iter().all(|value| value));
        }
    }

    #[test]
    fn outer_and_wide_turns_move_the_expected_number_of_facelets() {
        for face in Face::ALL {
            let outer = quarter_turn_permutation(Move444::new(face, false, 1));
            let wide = quarter_turn_permutation(Move444::new(face, true, 1));
            let outer_moved = outer
                .iter()
                .enumerate()
                .filter(|(index, target)| *index != **target as usize)
                .count();
            let wide_moved = wide
                .iter()
                .enumerate()
                .filter(|(index, target)| *index != **target as usize)
                .count();
            assert_eq!(outer_moved, 32, "outer move count mismatch for {face:?}");
            assert_eq!(wide_moved, 48, "wide move count mismatch for {face:?}");
        }
    }

    #[test]
    fn u_clockwise_strip_cycle_matches_wca_notation() {
        let permutation = quarter_turn_permutation(Move444::new(Face::U, false, 1));
        assert_strip(&permutation, row(F, 0), row(R, 0), false);
        assert_strip(&permutation, row(R, 0), row(B, 0), false);
        assert_strip(&permutation, row(B, 0), row(L, 0), false);
        assert_strip(&permutation, row(L, 0), row(F, 0), false);
    }

    #[test]
    fn d_clockwise_strip_cycle_matches_wca_notation() {
        let permutation = quarter_turn_permutation(Move444::new(Face::D, false, 1));
        assert_strip(&permutation, row(F, 3), row(L, 3), false);
        assert_strip(&permutation, row(L, 3), row(B, 3), false);
        assert_strip(&permutation, row(B, 3), row(R, 3), false);
        assert_strip(&permutation, row(R, 3), row(F, 3), false);
    }

    #[test]
    fn f_clockwise_strip_cycle_matches_wca_notation() {
        let permutation = quarter_turn_permutation(Move444::new(Face::F, false, 1));
        assert_strip(&permutation, row(U, 3), col(R, 0), false);
        assert_strip(&permutation, col(R, 0), row(D, 0), true);
        assert_strip(&permutation, row(D, 0), col(L, 3), false);
        assert_strip(&permutation, col(L, 3), row(U, 3), true);
    }

    #[test]
    fn b_clockwise_strip_cycle_matches_wca_notation() {
        let permutation = quarter_turn_permutation(Move444::new(Face::B, false, 1));
        assert_strip(&permutation, row(U, 0), col(L, 0), true);
        assert_strip(&permutation, col(L, 0), row(D, 3), false);
        assert_strip(&permutation, row(D, 3), col(R, 3), true);
        assert_strip(&permutation, col(R, 3), row(U, 0), false);
    }

    #[test]
    fn r_clockwise_strip_cycle_matches_wca_notation() {
        let permutation = quarter_turn_permutation(Move444::new(Face::R, false, 1));
        assert_strip(&permutation, col(U, 3), col(F, 3), false);
        assert_strip(&permutation, col(F, 3), col(D, 3), false);
        assert_strip(&permutation, col(D, 3), col(B, 0), true);
        assert_strip(&permutation, col(B, 0), col(U, 3), true);
    }

    #[test]
    fn l_clockwise_strip_cycle_matches_wca_notation() {
        let permutation = quarter_turn_permutation(Move444::new(Face::L, false, 1));
        assert_strip(&permutation, col(U, 0), col(B, 3), true);
        assert_strip(&permutation, col(B, 3), col(D, 0), true);
        assert_strip(&permutation, col(D, 0), col(F, 0), false);
        assert_strip(&permutation, col(F, 0), col(U, 0), false);
    }
}
