use core::fmt;

use crate::moves::{Move444, MoveParseError};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AlgParseError {
    pub token_index: usize,
    pub token: String,
    pub source: MoveParseError,
}

impl fmt::Display for AlgParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "invalid move at token {} ({}): {}",
            self.token_index + 1,
            self.token,
            self.source
        )
    }
}

impl std::error::Error for AlgParseError {}

pub fn parse_alg444(input: &str) -> Result<Vec<Move444>, AlgParseError> {
    input
        .split_whitespace()
        .enumerate()
        .map(|(token_index, token)| {
            token.parse::<Move444>().map_err(|source| AlgParseError {
                token_index,
                token: token.to_owned(),
                source,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_wca_style_scramble() {
        let moves = parse_alg444("Rw U2 Fw' L D2 Bw R' Uw2").unwrap();
        assert_eq!(moves.len(), 8);
        assert_eq!(moves[0].to_string(), "Rw");
        assert_eq!(moves[2].to_string(), "Fw'");
    }

    #[test]
    fn reports_the_bad_token_position() {
        let error = parse_alg444("Rw U2 3Rw F").unwrap_err();
        assert_eq!(error.token_index, 2);
        assert_eq!(error.token, "3Rw");
    }
}
