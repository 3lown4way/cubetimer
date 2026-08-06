use core::fmt;
use core::str::FromStr;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Ord, PartialOrd)]
pub enum Face {
    U,
    R,
    F,
    D,
    L,
    B,
}

impl Face {
    pub const ALL: [Self; 6] = [Self::U, Self::R, Self::F, Self::D, Self::L, Self::B];

    pub const fn axis_sign(self) -> i8 {
        match self {
            Self::U | Self::R | Self::F => 1,
            Self::D | Self::L | Self::B => -1,
        }
    }

    pub const fn as_char(self) -> char {
        match self {
            Self::U => 'U',
            Self::R => 'R',
            Self::F => 'F',
            Self::D => 'D',
            Self::L => 'L',
            Self::B => 'B',
        }
    }

    fn from_char(value: char) -> Option<Self> {
        match value.to_ascii_uppercase() {
            'U' => Some(Self::U),
            'R' => Some(Self::R),
            'F' => Some(Self::F),
            'D' => Some(Self::D),
            'L' => Some(Self::L),
            'B' => Some(Self::B),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Ord, PartialOrd)]
pub struct Move444 {
    face: Face,
    wide: bool,
    amount: u8,
}

impl Move444 {
    pub const fn new(face: Face, wide: bool, amount: u8) -> Self {
        assert!(amount >= 1 && amount <= 3, "move amount must be 1, 2, or 3");
        Self { face, wide, amount }
    }

    pub const fn face(self) -> Face {
        self.face
    }

    pub const fn is_wide(self) -> bool {
        self.wide
    }

    pub const fn amount(self) -> u8 {
        self.amount
    }

    pub const fn with_amount(self, amount: u8) -> Self {
        Self::new(self.face, self.wide, amount)
    }

    pub const fn inverse(self) -> Self {
        Self::new(
            self.face,
            self.wide,
            match self.amount {
                1 => 3,
                2 => 2,
                3 => 1,
                _ => unreachable!(),
            },
        )
    }

    pub fn all() -> Vec<Self> {
        let mut moves = Vec::with_capacity(36);
        for face in Face::ALL {
            for wide in [false, true] {
                for amount in 1..=3 {
                    moves.push(Self::new(face, wide, amount));
                }
            }
        }
        moves
    }
}

impl fmt::Display for Move444 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.face.as_char())?;
        if self.wide {
            write!(formatter, "w")?;
        }
        match self.amount {
            1 => Ok(()),
            2 => write!(formatter, "2"),
            3 => write!(formatter, "'"),
            _ => unreachable!(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MoveParseError {
    Empty,
    InvalidFace(char),
    InvalidSuffix(String),
    UnsupportedLayerPrefix(String),
}

impl fmt::Display for MoveParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => write!(formatter, "empty move token"),
            Self::InvalidFace(face) => write!(formatter, "invalid 4x4 face: {face}"),
            Self::InvalidSuffix(suffix) => write!(formatter, "invalid 4x4 move suffix: {suffix}"),
            Self::UnsupportedLayerPrefix(token) => {
                write!(formatter, "unsupported 4x4 layer prefix: {token}")
            }
        }
    }
}

impl std::error::Error for MoveParseError {}

impl FromStr for Move444 {
    type Err = MoveParseError;

    fn from_str(token: &str) -> Result<Self, Self::Err> {
        let token = token.trim();
        if token.is_empty() {
            return Err(MoveParseError::Empty);
        }
        if token.as_bytes()[0].is_ascii_digit() {
            return Err(MoveParseError::UnsupportedLayerPrefix(token.to_owned()));
        }

        let mut chars = token.chars();
        let first = chars.next().ok_or(MoveParseError::Empty)?;
        let face = Face::from_char(first).ok_or(MoveParseError::InvalidFace(first))?;
        let lower_alias = first.is_ascii_lowercase();
        let mut suffix: String = chars.collect();
        let mut wide = lower_alias;

        if suffix.starts_with('w') || suffix.starts_with('W') {
            if lower_alias {
                return Err(MoveParseError::InvalidSuffix(suffix));
            }
            wide = true;
            suffix.remove(0);
        }

        let amount = match suffix.as_str() {
            "" => 1,
            "2" | "2'" => 2,
            "'" => 3,
            _ => return Err(MoveParseError::InvalidSuffix(suffix)),
        };
        Ok(Self::new(face, wide, amount))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_moves_round_trip_through_notation() {
        for mv in Move444::all() {
            assert_eq!(mv.to_string().parse::<Move444>().unwrap(), mv);
        }
    }

    #[test]
    fn lowercase_aliases_mean_wide_moves() {
        assert_eq!(
            "r".parse::<Move444>().unwrap(),
            Move444::new(Face::R, true, 1)
        );
        assert_eq!(
            "u2".parse::<Move444>().unwrap(),
            Move444::new(Face::U, true, 2)
        );
        assert_eq!(
            "f'".parse::<Move444>().unwrap(),
            Move444::new(Face::F, true, 3)
        );
    }

    #[test]
    fn rejects_unsupported_notation() {
        assert!(matches!(
            "3Rw".parse::<Move444>(),
            Err(MoveParseError::UnsupportedLayerPrefix(_))
        ));
        assert!("M".parse::<Move444>().is_err());
        assert!("Rw3".parse::<Move444>().is_err());
        assert!("x".parse::<Move444>().is_err());
    }
}
