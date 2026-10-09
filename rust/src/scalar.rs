//! A ready-made value type for relations.

use std::sync::Arc;

/// A JSON scalar, usable as a relation value (`Relation<Scalar>`).
///
/// Ordered booleans < integers < strings < null, matching the row order of
/// the generated spec files. Non-integral numbers are not supported.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Scalar {
    /// `true` / `false`
    Bool(bool),
    /// an integer that fits in `i64`
    Int(i64),
    /// a string
    Str(Arc<str>),
    /// `null`
    Null,
}
