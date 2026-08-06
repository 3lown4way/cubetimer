import fs from "node:fs";

const path = "solver444-wasm/src/edges.rs";
let source = fs.readFileSync(path, "utf8");

const entry = `pub fn solve_edges(state: &Cube444, deadline_ts: f64) -> Result<EdgeSolveResult, EdgeSolveError> {
    check_deadline(deadline_ts)?;
    if !state.centers_solved() {
        return Err(EdgeSolveError::CentersNotSolved);
    }

    let tables_were_ready = EDGE_TABLES.get().is_some();`;
const replacement = `pub fn solve_edges(state: &Cube444, deadline_ts: f64) -> Result<EdgeSolveResult, EdgeSolveError> {
    check_deadline(deadline_ts)?;
    if !state.centers_solved() {
        return Err(EdgeSolveError::CentersNotSolved);
    }
    // Reduction requires twelve paired dedges, not each dedge in its home slot.
    // Outer turns preserve pairing and must therefore require no pairing macros.
    if state.edges_paired() {
        return Ok(EdgeSolveResult {
            moves: Vec::new(),
            table_build_ms: 0.0,
            search_ms: 0.0,
        });
    }

    let tables_were_ready = EDGE_TABLES.get().is_some();`;
if (!source.includes(entry)) throw new Error("solve_edges entry not found");
source = source.replace(entry, replacement);

const testMarker = `    #[test]
    fn wing_geometry_and_home_slots_match_the_solved_cube() {`;
const testAddition = `    #[test]
    fn outer_turns_keep_all_edges_paired_without_reduction_moves() {
        for face in Face::ALL {
            for amount in 1..=3 {
                let mut state = Cube444::solved();
                state.apply_move(Move444::new(face, false, amount));
                assert!(state.centers_solved());
                assert!(state.edges_paired());
                let result = solve_edges(&state, 0.0).unwrap();
                assert!(result.moves.is_empty(), "unexpected pairing moves for {face:?}{amount}");
            }
        }
    }

${testMarker}`;
if (!source.includes(testMarker)) throw new Error("edge test marker not found");
source = source.replace(testMarker, testAddition);
fs.writeFileSync(path, source);
console.log("Added already-paired edge shortcut");
