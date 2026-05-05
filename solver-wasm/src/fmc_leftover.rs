use crate::minmove_core::{CubeState, CORNER_COUNT, EDGE_COUNT};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LeftoverInfo {
    pub kind: String,
    pub corner_unsolved_count: u8,
    pub edge_unsolved_count: u8,
    pub corner_orientation_solved: bool,
    pub edge_orientation_solved: bool,
    pub signature: String,
}

pub fn classify_leftovers(state: &CubeState) -> LeftoverInfo {
    let mut corner_unsolved_positions = Vec::new();
    let mut edge_unsolved_positions = Vec::new();

    for index in 0..CORNER_COUNT {
        if state.cp[index] != index as u8 {
            corner_unsolved_positions.push(index as u8);
        }
    }
    for index in 0..EDGE_COUNT {
        if state.ep[index] != index as u8 {
            edge_unsolved_positions.push(index as u8);
        }
    }

    let corner_orientation_solved = state.co.iter().all(|&value| value == 0);
    let edge_orientation_solved = state.eo.iter().all(|&value| value == 0);
    let corner_unsolved_count = corner_unsolved_positions.len() as u8;
    let edge_unsolved_count = edge_unsolved_positions.len() as u8;

    let kind = if corner_unsolved_count == 0
        && edge_unsolved_count == 0
        && corner_orientation_solved
        && edge_orientation_solved
    {
        "solved"
    } else if corner_unsolved_count == 3
        && edge_unsolved_count == 0
        && corner_orientation_solved
        && edge_orientation_solved
    {
        "3C"
    } else if corner_unsolved_count == 0
        && edge_unsolved_count == 3
        && corner_orientation_solved
        && edge_orientation_solved
    {
        "3E"
    } else if corner_unsolved_count == 2
        && edge_unsolved_count == 2
        && corner_orientation_solved
        && edge_orientation_solved
    {
        "2C2E"
    } else {
        "other"
    };

    let corner_positions = corner_unsolved_positions
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let edge_positions = edge_unsolved_positions
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join(",");

    LeftoverInfo {
        kind: kind.to_string(),
        corner_unsolved_count,
        edge_unsolved_count,
        corner_orientation_solved,
        edge_orientation_solved,
        signature: format!(
            "C{corner_unsolved_count}-E{edge_unsolved_count}-CO{}-EO{}-CP[{corner_positions}]-EP[{edge_positions}]",
            if corner_orientation_solved { 1 } else { 0 },
            if edge_orientation_solved { 1 } else { 0 },
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::{classify_leftovers, LeftoverInfo};
    use crate::minmove_core::CubeState;

    fn solved_state() -> CubeState {
        CubeState::solved()
    }

    #[test]
    fn classify_solved_state() {
        let info = classify_leftovers(&solved_state());
        assert_eq!(
            info,
            LeftoverInfo {
                kind: "solved".to_string(),
                corner_unsolved_count: 0,
                edge_unsolved_count: 0,
                corner_orientation_solved: true,
                edge_orientation_solved: true,
                signature: "C0-E0-CO1-EO1-CP[]-EP[]".to_string(),
            }
        );
    }

    #[test]
    fn classify_three_corner_cycle() {
        let mut state = CubeState::solved();
        state.cp[0] = 1;
        state.cp[1] = 2;
        state.cp[2] = 0;

        let info = classify_leftovers(&state);
        assert_eq!(info.kind, "3C");
        assert_eq!(info.corner_unsolved_count, 3);
        assert_eq!(info.edge_unsolved_count, 0);
        assert!(info.corner_orientation_solved);
        assert!(info.edge_orientation_solved);
        assert_eq!(info.signature, "C3-E0-CO1-EO1-CP[0,1,2]-EP[]");
    }

    #[test]
    fn classify_other_state() {
        let mut state = CubeState::solved();
        state.cp[0] = 1;
        state.cp[1] = 2;
        state.cp[2] = 0;
        state.ep[0] = 1;
        state.ep[1] = 2;
        state.ep[2] = 0;
        state.eo[0] = 1;

        let info = classify_leftovers(&state);
        assert_eq!(info.kind, "other");
        assert_eq!(info.corner_unsolved_count, 3);
        assert_eq!(info.edge_unsolved_count, 3);
        assert!(info.corner_orientation_solved);
        assert!(!info.edge_orientation_solved);
        assert_eq!(info.signature, "C3-E3-CO1-EO0-CP[0,1,2]-EP[0,1,2]");
    }

    #[test]
    fn classify_three_edge_cycle() {
        let mut state = CubeState::solved();
        state.ep[0] = 1;
        state.ep[1] = 2;
        state.ep[2] = 0;

        let info = classify_leftovers(&state);
        assert_eq!(info.kind, "3E");
    }

    #[test]
    fn classify_two_corner_two_edge_swap() {
        let mut state = CubeState::solved();
        state.cp.swap(0, 1);
        state.ep.swap(0, 1);

        let info = classify_leftovers(&state);
        assert_eq!(info.kind, "2C2E");
    }
}
