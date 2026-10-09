//! The single error type of the crate.

use std::fmt;

/// What went wrong. The snake-case names ([`ErrorKind::as_str`]) are shared
/// with the Python and JS implementations and checked by the conformance suite.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ErrorKind {
    /// Two wires of one star have the same name.
    DuplicateWire,
    /// A wire is soldered onto a cable index that does not exist.
    CableOutOfRange,
    /// The number of arguments differs from the number of inner stars.
    ArityMismatch,
    /// A substituted diagram's outer star (or an argument's star) differs from the inner star it fills.
    StarMismatch,
    /// The given sequence is not a permutation of the inner stars.
    NotAPermutation,
    /// A diagram's outer star is not the expected internal hom `[Y ⇒ Z]`.
    HomMismatch,
    /// An internalization split point is larger than the arity.
    SplitOutOfRange,
    /// A relation row has the wrong number of values.
    RelationArity,
    /// Rel needed to enumerate a type that has no declared finite domain.
    MissingDomain,
    /// A partition does not assign one non-negative block id to each wire.
    InvalidPartition,
    /// Input JSON does not have the documented shape.
    InvalidJson,
}

impl ErrorKind {
    /// The shared snake-case name of this kind.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::DuplicateWire => "duplicate_wire",
            Self::CableOutOfRange => "cable_out_of_range",
            Self::ArityMismatch => "arity_mismatch",
            Self::StarMismatch => "star_mismatch",
            Self::NotAPermutation => "not_a_permutation",
            Self::HomMismatch => "hom_mismatch",
            Self::SplitOutOfRange => "split_out_of_range",
            Self::RelationArity => "relation_arity",
            Self::MissingDomain => "missing_domain",
            Self::InvalidPartition => "invalid_partition",
            Self::InvalidJson => "invalid_json",
        }
    }
}

/// An error with a [`kind`](Error::kind) and a human-readable message.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error {
    kind: ErrorKind,
    message: String,
}

impl Error {
    pub(crate) fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    /// The machine-readable kind.
    pub fn kind(&self) -> ErrorKind {
        self.kind
    }

    /// The human-readable message (without the kind prefix).
    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.kind.as_str(), self.message)
    }
}

impl std::error::Error for Error {}

/// `Result` with this crate's [`Error`].
pub type Result<T, E = Error> = std::result::Result<T, E>;
