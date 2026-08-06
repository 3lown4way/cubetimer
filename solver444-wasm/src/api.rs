use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::{
    parse_alg444, solve_centers, solve_edges, CenterSolveError, Cube444, EdgeSolveError,
};

const API_VERSION: &str = "444-edges-v1";

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Solve444Request {
    #[serde(default)]
    scramble: String,
    #[serde(default)]
    deadline_ts: f64,
}

#[derive(Clone, Copy, Debug, Default)]
struct BoundaryState {
    deadline_ts: f64,
    parsed_move_count: usize,
    scramble_valid: bool,
    state_valid: bool,
    solved_state: bool,
    centers_solved: bool,
    center_move_count: usize,
    center_table_build_ms: f64,
    center_search_ms: f64,
    edges_paired: bool,
    edge_move_count: usize,
    edge_table_build_ms: f64,
    edge_search_ms: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Solve444Meta {
    api_version: &'static str,
    parsed_move_count: usize,
    scramble_valid: bool,
    state_valid: bool,
    solved_state: bool,
    centers_solved: bool,
    center_move_count: usize,
    center_table_build_ms: f64,
    center_search_ms: f64,
    edges_paired: bool,
    edge_move_count: usize,
    edge_table_build_ms: f64,
    edge_search_ms: f64,
    deadline_ts: f64,
}

impl From<BoundaryState> for Solve444Meta {
    fn from(state: BoundaryState) -> Self {
        Self {
            api_version: API_VERSION,
            parsed_move_count: state.parsed_move_count,
            scramble_valid: state.scramble_valid,
            state_valid: state.state_valid,
            solved_state: state.solved_state,
            centers_solved: state.centers_solved,
            center_move_count: state.center_move_count,
            center_table_build_ms: state.center_table_build_ms,
            center_search_ms: state.center_search_ms,
            edges_paired: state.edges_paired,
            edge_move_count: state.edge_move_count,
            edge_table_build_ms: state.edge_table_build_ms,
            edge_search_ms: state.edge_search_ms,
            deadline_ts: state.deadline_ts,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Solve444Stage {
    id: &'static str,
    name: &'static str,
    solution: String,
    move_count: usize,
    verified: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Solve444Response {
    ok: bool,
    event_id: &'static str,
    status: &'static str,
    reason: &'static str,
    detail: Option<String>,
    solution: &'static str,
    move_count: usize,
    verified: bool,
    stages: Vec<Solve444Stage>,
    meta: Solve444Meta,
}

fn now_ms() -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::now()
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs_f64() * 1000.0)
            .unwrap_or(0.0)
    }
}

fn deadline_reached(deadline_ts: f64) -> bool {
    deadline_ts.is_finite() && deadline_ts > 0.0 && now_ms() >= deadline_ts
}

fn response(
    status: &'static str,
    reason: &'static str,
    detail: Option<String>,
    stages: Vec<Solve444Stage>,
    state: BoundaryState,
) -> Solve444Response {
    Solve444Response {
        ok: false,
        event_id: "444",
        status,
        reason,
        detail,
        solution: "",
        move_count: 0,
        verified: false,
        stages,
        meta: state.into(),
    }
}

fn empty_response(
    status: &'static str,
    reason: &'static str,
    detail: Option<String>,
    state: BoundaryState,
) -> Solve444Response {
    response(status, reason, detail, Vec::new(), state)
}

fn serialize_response(value: &Solve444Response) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| {
        r#"{"ok":false,"eventId":"444","status":"error","reason":"444_SERIALIZATION_FAILED","detail":null,"solution":"","moveCount":0,"verified":false,"stages":[],"meta":{"apiVersion":"444-edges-v1","parsedMoveCount":0,"scrambleValid":false,"stateValid":false,"solvedState":false,"centersSolved":false,"centerMoveCount":0,"centerTableBuildMs":0,"centerSearchMs":0,"edgesPaired":false,"edgeMoveCount":0,"edgeTableBuildMs":0,"edgeSearchMs":0,"deadlineTs":0}}"#.to_string()
    })
}

fn format_moves(moves: &[crate::Move444]) -> String {
    moves
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn solve_444_boundary(request_json: &str) -> String {
    let request: Solve444Request = match serde_json::from_str(request_json) {
        Ok(request) => request,
        Err(error) => {
            return serialize_response(&empty_response(
                "invalid",
                "444_INVALID_REQUEST",
                Some(error.to_string()),
                BoundaryState::default(),
            ));
        }
    };

    let mut boundary = BoundaryState {
        deadline_ts: request.deadline_ts,
        ..BoundaryState::default()
    };
    if deadline_reached(boundary.deadline_ts) {
        return serialize_response(&empty_response(
            "timeout",
            "444_DEADLINE_REACHED",
            None,
            boundary,
        ));
    }

    let moves = match parse_alg444(&request.scramble) {
        Ok(moves) => moves,
        Err(error) => {
            return serialize_response(&empty_response(
                "invalid",
                "444_INVALID_SCRAMBLE",
                Some(error.to_string()),
                boundary,
            ));
        }
    };
    boundary.scramble_valid = true;
    boundary.parsed_move_count = moves.len();

    if deadline_reached(boundary.deadline_ts) {
        return serialize_response(&empty_response(
            "timeout",
            "444_DEADLINE_REACHED",
            None,
            boundary,
        ));
    }

    let mut state = Cube444::solved();
    state.apply_moves(&moves);
    if let Err(error) = state.validate() {
        return serialize_response(&empty_response(
            "invalid",
            "444_STATE_INVALID",
            Some(error.to_string()),
            boundary,
        ));
    }
    boundary.state_valid = true;
    boundary.solved_state = state.is_solved();

    let center_result = match solve_centers(&state, boundary.deadline_ts) {
        Ok(result) => result,
        Err(CenterSolveError::DeadlineReached) => {
            return serialize_response(&empty_response(
                "timeout",
                "444_DEADLINE_REACHED",
                None,
                boundary,
            ));
        }
        Err(error) => {
            return serialize_response(&empty_response(
                "error",
                "444_CENTER_SOLVER_FAILED",
                Some(error.to_string()),
                boundary,
            ));
        }
    };

    let mut reduced_state = state.clone();
    reduced_state.apply_moves(&center_result.moves);
    if !reduced_state.centers_solved() || reduced_state.validate().is_err() {
        return serialize_response(&empty_response(
            "error",
            "444_CENTER_VERIFICATION_FAILED",
            None,
            boundary,
        ));
    }

    boundary.centers_solved = true;
    boundary.center_move_count = center_result.moves.len();
    boundary.center_table_build_ms = center_result.table_build_ms;
    boundary.center_search_ms = center_result.search_ms;

    let center_stage = Solve444Stage {
        id: "centers",
        name: "Centers",
        solution: format_moves(&center_result.moves),
        move_count: center_result.moves.len(),
        verified: true,
    };
    let mut stages = vec![center_stage];

    let edge_result = match solve_edges(&reduced_state, boundary.deadline_ts) {
        Ok(result) => result,
        Err(EdgeSolveError::DeadlineReached) => {
            return serialize_response(&response(
                "partial",
                "444_EDGE_DEADLINE_REACHED",
                None,
                stages,
                boundary,
            ));
        }
        Err(error) => {
            return serialize_response(&response(
                "partial",
                "444_EDGE_SOLVER_FAILED",
                Some(error.to_string()),
                stages,
                boundary,
            ));
        }
    };

    let mut edge_verified_state = reduced_state.clone();
    edge_verified_state.apply_moves(&edge_result.moves);
    if !edge_verified_state.centers_solved()
        || !edge_verified_state.edges_paired()
        || edge_verified_state.validate().is_err()
    {
        return serialize_response(&response(
            "partial",
            "444_EDGE_VERIFICATION_FAILED",
            None,
            stages,
            boundary,
        ));
    }

    boundary.edges_paired = true;
    boundary.edge_move_count = edge_result.moves.len();
    boundary.edge_table_build_ms = edge_result.table_build_ms;
    boundary.edge_search_ms = edge_result.search_ms;

    stages.push(Solve444Stage {
        id: "edges",
        name: "Edge Pairing",
        solution: format_moves(&edge_result.moves),
        move_count: edge_result.moves.len(),
        verified: true,
    });

    // Centers and all twelve edge pairs are independently verified. The final
    // solution remains empty until parity normalization, virtual 3x3 conversion,
    // the existing Two-Phase bridge, and full-solution verification are complete.
    serialize_response(&response(
        "partial",
        "444_REDUCTION_INCOMPLETE",
        None,
        stages,
        boundary,
    ))
}

#[wasm_bindgen]
pub fn solve_444_json(request_json: &str) -> String {
    solve_444_boundary(request_json)
}

#[wasm_bindgen]
pub fn solver_444_api_version() -> String {
    API_VERSION.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solve(request: serde_json::Value) -> serde_json::Value {
        serde_json::from_str(&solve_444_boundary(&request.to_string())).unwrap()
    }

    #[test]
    fn valid_scramble_returns_verified_center_and_edge_stages() {
        let scramble = "Rw U2 F' Lw D B2";
        let result = solve(serde_json::json!({
            "scramble": scramble,
            "deadlineTs": 0
        }));
        assert_eq!(result["ok"], false);
        assert_eq!(result["status"], "partial");
        assert_eq!(result["reason"], "444_REDUCTION_INCOMPLETE");
        assert_eq!(result["solution"], "");
        assert_eq!(result["moveCount"], 0);
        assert_eq!(result["verified"], false);
        assert_eq!(result["stages"].as_array().unwrap().len(), 2);
        assert_eq!(result["stages"][0]["id"], "centers");
        assert_eq!(result["stages"][0]["name"], "Centers");
        assert_eq!(result["stages"][0]["verified"], true);
        assert_eq!(result["stages"][1]["id"], "edges");
        assert_eq!(result["stages"][1]["name"], "Edge Pairing");
        assert_eq!(result["stages"][1]["verified"], true);
        assert_eq!(result["meta"]["apiVersion"], API_VERSION);
        assert_eq!(result["meta"]["parsedMoveCount"], 6);
        assert_eq!(result["meta"]["scrambleValid"], true);
        assert_eq!(result["meta"]["stateValid"], true);
        assert_eq!(result["meta"]["centersSolved"], true);
        assert_eq!(result["meta"]["edgesPaired"], true);
        assert_eq!(
            result["stages"][0]["moveCount"],
            result["meta"]["centerMoveCount"]
        );
        assert_eq!(
            result["stages"][1]["moveCount"],
            result["meta"]["edgeMoveCount"]
        );

        let mut state = Cube444::solved();
        state.apply_alg(scramble).unwrap();
        for stage in result["stages"].as_array().unwrap() {
            state.apply_alg(stage["solution"].as_str().unwrap()).unwrap();
        }
        assert!(state.centers_solved());
        assert!(state.edges_paired());
        assert_eq!(state.validate(), Ok(()));
    }

    #[test]
    fn solved_scramble_returns_two_zero_move_stages() {
        let result = solve(serde_json::json!({ "scramble": "" }));
        assert_eq!(result["status"], "partial");
        assert_eq!(result["stages"].as_array().unwrap().len(), 2);
        assert_eq!(result["stages"][0]["solution"], "");
        assert_eq!(result["stages"][0]["moveCount"], 0);
        assert_eq!(result["stages"][1]["solution"], "");
        assert_eq!(result["stages"][1]["moveCount"], 0);
        assert_eq!(result["meta"]["centersSolved"], true);
        assert_eq!(result["meta"]["edgesPaired"], true);
    }

    #[test]
    fn invalid_scramble_is_not_promoted_to_a_solver_failure() {
        let result = solve(serde_json::json!({ "scramble": "3Rw U" }));
        assert_eq!(result["status"], "invalid");
        assert_eq!(result["reason"], "444_INVALID_SCRAMBLE");
        assert_eq!(result["solution"], "");
        assert_eq!(result["moveCount"], 0);
        assert_eq!(result["stages"], serde_json::json!([]));
    }

    #[test]
    fn expired_deadline_returns_timeout_without_a_candidate() {
        let result = solve(serde_json::json!({
            "scramble": "Rw U",
            "deadlineTs": 1
        }));
        assert_eq!(result["status"], "timeout");
        assert_eq!(result["reason"], "444_DEADLINE_REACHED");
        assert_eq!(result["solution"], "");
        assert_eq!(result["moveCount"], 0);
        assert_eq!(result["stages"], serde_json::json!([]));
    }

    #[test]
    fn malformed_request_is_rejected_without_panicking() {
        let result: serde_json::Value =
            serde_json::from_str(&solve_444_boundary("{not-json")).unwrap();
        assert_eq!(result["reason"], "444_INVALID_REQUEST");
        assert_eq!(result["solution"], "");
    }
}
