#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InsertionAlg {
    pub signature: &'static str,
    pub algorithm: &'static str,
}

static THREE_C_ALGORITHMS: &[InsertionAlg] = &[
    InsertionAlg {
        signature: "3C",
        algorithm: "R U R' D R U' R' D'",
    },
    InsertionAlg {
        signature: "3C",
        algorithm: "L' U' L D' L' U L D",
    },
    InsertionAlg {
        signature: "3C",
        algorithm: "F R U' R' U' R U R' F'",
    },
];

pub fn all_3c_algorithms_for_signature(signature: &str) -> Vec<InsertionAlg> {
    if signature.starts_with("3C") {
        THREE_C_ALGORITHMS.to_vec()
    } else {
        Vec::new()
    }
}

/// Compatibility wrapper: this API name suggests exact matching,
/// but behavior intentionally returns the full 3C library by prefix.
pub fn match_3c_algorithms(signature: &str) -> Vec<InsertionAlg> {
    all_3c_algorithms_for_signature(signature)
}

#[cfg(test)]
mod tests {
    use super::{all_3c_algorithms_for_signature, match_3c_algorithms, THREE_C_ALGORITHMS};

    #[test]
    fn returns_3c_library_for_3c_signature_prefix() {
        let matches = all_3c_algorithms_for_signature("3C-ABCD");
        assert!(!THREE_C_ALGORITHMS.is_empty());
        assert_eq!(matches, THREE_C_ALGORITHMS);
    }

    #[test]
    fn returns_empty_for_non_3c_signature() {
        let matches = all_3c_algorithms_for_signature("2C-ABCD");
        assert!(matches.is_empty());
    }

    #[test]
    fn compatibility_wrapper_matches_honest_function() {
        let signature = "3C-anything";
        assert_eq!(
            match_3c_algorithms(signature),
            all_3c_algorithms_for_signature(signature)
        );
    }
}
