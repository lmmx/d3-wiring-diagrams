//! Objects of the operad: typed stars (Spivak, Example 4.1.1).

use std::fmt;
use std::sync::Arc;

use crate::error::{Error, ErrorKind, Result};

/// A wire name or a type name. Cloning is a reference-count increment.
pub type Label = Arc<str>;

/// A typed star `(X, τ)`: a finite set of named wires, each with a value type.
///
/// The wires form a set, so the order they are given in has no meaning. They
/// are stored sorted by name. `str`'s `Ord` is byte order on UTF-8, which is
/// Unicode code point order, the same order the Python and JS implementations
/// use. So index `k` names the same wire in every language.
///
/// Cloning is cheap: the wires are shared behind an `Arc`.
#[derive(Clone)]
pub struct Star(Arc<StarData>);

#[derive(PartialEq, Eq, Hash)]
struct StarData {
    names: Box<[Label]>,
    types: Box<[Label]>,
}

impl Star {
    /// Build a star from `(name, type)` pairs.
    ///
    /// # Errors
    /// [`ErrorKind::DuplicateWire`] if a name repeats.
    pub fn new<N, T>(wires: impl IntoIterator<Item = (N, T)>) -> Result<Self>
    where
        N: Into<Label>,
        T: Into<Label>,
    {
        let mut pairs: Vec<(Label, Label)> = wires
            .into_iter()
            .map(|(n, t)| (n.into(), t.into()))
            .collect();
        pairs.sort_unstable_by(|a, b| a.0.cmp(&b.0));
        if let Some(w) = pairs.windows(2).find(|w| w[0].0 == w[1].0) {
            return Err(Error::new(
                ErrorKind::DuplicateWire,
                format!("wire {:?} appears twice", w[0].0),
            ));
        }
        let (names, types) = pairs.into_iter().unzip::<_, _, Vec<_>, Vec<_>>();
        Ok(Self::from_sorted(names.into(), types.into()))
    }

    /// A star of the singly-typed operad S: every wire has type `ty`.
    pub fn untyped<N: Into<Label>>(names: impl IntoIterator<Item = N>, ty: &str) -> Result<Self> {
        let ty: Label = ty.into();
        Self::new(names.into_iter().map(|n| (n, ty.clone())))
    }

    pub(crate) fn from_sorted(names: Box<[Label]>, types: Box<[Label]>) -> Self {
        debug_assert!(names.windows(2).all(|w| w[0] < w[1]));
        debug_assert_eq!(names.len(), types.len());
        Self(Arc::new(StarData { names, types }))
    }

    /// Wire names in canonical (code point) order.
    pub fn names(&self) -> &[Label] {
        &self.0.names
    }

    /// Wire types, aligned with [`names`](Self::names).
    pub fn types(&self) -> &[Label] {
        &self.0.types
    }

    /// Number of wires.
    pub fn len(&self) -> usize {
        self.0.names.len()
    }

    /// Whether the star has no wires.
    pub fn is_empty(&self) -> bool {
        self.0.names.is_empty()
    }

    /// Position of wire `name` in canonical order (binary search).
    pub fn index_of(&self, name: &str) -> Option<usize> {
        self.0.names.binary_search_by(|n| (**n).cmp(name)).ok()
    }

    /// Type of wire `name`.
    pub fn type_of(&self, name: &str) -> Option<&str> {
        self.index_of(name).map(|i| &*self.0.types[i])
    }

    /// `(name, type)` pairs in canonical order.
    pub fn iter(&self) -> impl ExactSizeIterator<Item = (&str, &str)> {
        self.0
            .names
            .iter()
            .zip(self.0.types.iter())
            .map(|(n, t)| (&**n, &**t))
    }
}

impl PartialEq for Star {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0) || self.0 == other.0
    }
}

impl Eq for Star {}

impl std::hash::Hash for Star {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.0.hash(state);
    }
}

impl fmt::Debug for Star {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("{")?;
        for (k, (n, t)) in self.iter().enumerate() {
            if k > 0 {
                f.write_str(", ")?;
            }
            write!(f, "{n}: {t}")?;
        }
        f.write_str("}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_point_order() {
        let x = Star::new([
            ("😀", "A"),
            ("b", "A"),
            ("\u{ffff}", "B"),
            ("é", "A"),
            ("Z", "B"),
        ])
        .unwrap();
        let names: Vec<&str> = x.names().iter().map(|n| &**n).collect();
        assert_eq!(names, ["Z", "b", "é", "\u{ffff}", "😀"]);
        assert_eq!(x.index_of("é"), Some(2));
        assert_eq!(x.type_of("Z"), Some("B"));
    }

    #[test]
    fn duplicate_wire() {
        let err = Star::new([("a", "A"), ("a", "B")]).unwrap_err();
        assert_eq!(err.kind(), ErrorKind::DuplicateWire);
    }
}
