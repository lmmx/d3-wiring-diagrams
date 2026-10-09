//! Morphisms of the operad: typed wiring diagrams (Spivak, Examples 2.1.7, 4.1.1).
//!
//! A wiring diagram `φ: X₁, …, Xₙ → Y` is a cospan of typed finite sets
//! `X₁ ⊔ … ⊔ Xₙ →f C ←g Y`, where `C` is the set of cables, each with a type,
//! and `f`, `g` preserve types. Diagrams that differ only by renaming cables
//! are the same morphism. [`WiringDiagram`] stores the canonical
//! representative, so the derived `==` and `Hash` are equality of morphisms.
//!
//! Canonical form: wires within a star are ordered by name; cables are numbered
//! by first appearance, scanning the inner stars in order and then the outer
//! star; cables soldered to no wire ("floating") come last, sorted by type.

use std::collections::HashSet;
use std::fmt;
use std::ops::Range;

use crate::error::{Error, ErrorKind, Result};
use crate::star::{Label, Star};
use crate::union_find::UnionFind;

/// Index of a cable within a diagram.
pub type Cable = u32;

/// A typed wiring diagram `φ: X₁, …, Xₙ → Y` in canonical form.
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct WiringDiagram {
    cables: Vec<Label>,
    inner: Vec<Star>,
    /// `inner_cables[offsets[i]..offsets[i + 1]]` is `f` restricted to `Xᵢ`.
    offsets: Vec<u32>,
    inner_cables: Vec<Cable>,
    outer: Star,
    outer_cables: Vec<Cable>,
}

impl WiringDiagram {
    /// Build a diagram from cable types and `(wire, cable)` lists for each
    /// inner star and for the outer star.
    ///
    /// The type of every wire is the type of its cable, so a type-incorrect
    /// cospan cannot be expressed.
    ///
    /// # Errors
    /// [`ErrorKind::CableOutOfRange`] for an index `>= cables.len()`, and
    /// [`ErrorKind::DuplicateWire`] for a name repeated within one star.
    pub fn new<T, N, M, I>(
        cables: impl IntoIterator<Item = T>,
        inner: I,
        outer: impl IntoIterator<Item = (M, usize)>,
    ) -> Result<Self>
    where
        T: AsRef<str>,
        N: AsRef<str>,
        M: AsRef<str>,
        I: IntoIterator,
        I::Item: IntoIterator<Item = (N, usize)>,
    {
        // Equal strings share one allocation: diagrams repeat type and wire names a lot.
        let mut interner = Interner::default();
        let types: Vec<Label> = cables
            .into_iter()
            .map(|t| interner.get(t.as_ref()))
            .collect();
        let k = types.len();
        if u32::try_from(k).is_err() {
            return Err(Error::new(
                ErrorKind::CableOutOfRange,
                "more than u32::MAX cables",
            ));
        }
        let mut stars = Vec::new();
        let mut raw = Vec::new();
        let mut pairs = Vec::new();
        for (i, w) in inner.into_iter().enumerate() {
            pairs.clear();
            pairs.extend(w.into_iter().map(|(n, c)| (interner.get(n.as_ref()), c)));
            let star = wiring(&types, Side::Inner(i), &mut pairs, &mut raw)?;
            stars.push(star);
        }
        pairs.clear();
        pairs.extend(
            outer
                .into_iter()
                .map(|(n, c)| (interner.get(n.as_ref()), c)),
        );
        let mut outer_raw = Vec::with_capacity(pairs.len());
        let outer = wiring(&types, Side::Outer, &mut pairs, &mut outer_raw)?;
        let refs: Vec<&Label> = types.iter().collect();
        Ok(canonical(
            &refs,
            stars,
            &raw,
            outer,
            &outer_raw,
            0..k as Cable,
        ))
    }

    // -- constituents ----------------------------------------------------------

    /// `σ: C → Types`, the type of each cable.
    pub fn cables(&self) -> &[Label] {
        &self.cables
    }

    /// The domain objects `X₁, …, Xₙ` (inner stars).
    pub fn inner(&self) -> &[Star] {
        &self.inner
    }

    /// The codomain object `Y` (outer star).
    pub fn outer(&self) -> &Star {
        &self.outer
    }

    /// The number of inner stars.
    pub fn arity(&self) -> usize {
        self.inner.len()
    }

    /// `f` restricted to `Xᵢ`: the cable of each wire, in canonical wire order.
    pub fn inner_cables(&self, i: usize) -> &[Cable] {
        &self.inner_cables[self.offsets[i] as usize..self.offsets[i + 1] as usize]
    }

    /// `g`: the cable of each outer wire, in canonical wire order.
    pub fn outer_cables(&self) -> &[Cable] {
        &self.outer_cables
    }

    /// Cables soldered to no wire. Canonical form puts them last.
    pub fn floating_cables(&self) -> Range<usize> {
        let used = self
            .inner_cables
            .iter()
            .chain(&self.outer_cables)
            .map(|&c| c as usize + 1)
            .max();
        used.unwrap_or(0)..self.cables.len()
    }

    // -- operad structure ------------------------------------------------------

    /// `id_X: X → X`, the cospan `X → X ← X` of identity maps.
    pub fn identity(star: &Star) -> Self {
        let n = star.len() as Cable;
        Self {
            cables: star.types().to_vec(),
            inner: vec![star.clone()],
            offsets: vec![0, n],
            inner_cables: (0..n).collect(),
            outer: star.clone(),
            outer_cables: (0..n).collect(),
        }
    }

    /// Operadic composition `self ∘ (ψ₁, …, ψₙ)`: substitute `ψᵢ` into `Xᵢ`.
    ///
    /// This is the pushout of `C ← ⊔Xᵢ → ⊔Cᵢ` (Spivak, (2.1.7)), computed by a
    /// union–find over `C ⊔ C₁ ⊔ … ⊔ Cₙ` with one union per wire of each
    /// intermediate star. The cost is O(N α(N)) in the total number of wires and
    /// cables, plus sorting the floating cables of the result.
    ///
    /// # Errors
    /// [`ErrorKind::ArityMismatch`] if `children.len() != self.arity()`, and
    /// [`ErrorKind::StarMismatch`] if `children[i].outer() != self.inner()[i]`.
    pub fn compose(&self, children: &[WiringDiagram]) -> Result<Self> {
        if children.len() != self.arity() {
            return Err(Error::new(
                ErrorKind::ArityMismatch,
                format!(
                    "diagram has {} inner stars but {} were given",
                    self.arity(),
                    children.len()
                ),
            ));
        }
        let slots: Vec<Option<&WiringDiagram>> = children.iter().map(Some).collect();
        self.substitute(&slots)
    }

    /// Partial composition `self ∘ᵢ child`: substitute into inner star `i` only.
    ///
    /// Equal to `compose` with identities in every other slot, but O(size of
    /// `self` + size of `child`): the other inner stars are carried over
    /// without building identity diagrams.
    ///
    /// # Errors
    /// [`ErrorKind::ArityMismatch`] if `i` is out of range, and
    /// [`ErrorKind::StarMismatch`] if `child.outer() != self.inner()[i]`.
    pub fn compose_at(&self, i: usize, child: &WiringDiagram) -> Result<Self> {
        if i >= self.arity() {
            return Err(Error::new(
                ErrorKind::ArityMismatch,
                format!("no inner star {i} in a diagram of arity {}", self.arity()),
            ));
        }
        let mut slots = vec![None; self.arity()];
        slots[i] = Some(child);
        self.substitute(&slots)
    }

    /// The pushout behind both kinds of composition. Slot `i` is either a
    /// diagram to substitute into `Xᵢ` or `None`, which keeps `Xᵢ` as it is
    /// (composition with `id_Xᵢ`, without materialising the identity).
    fn substitute(&self, slots: &[Option<&WiringDiagram>]) -> Result<Self> {
        let mut types: Vec<&Label> = self.cables.iter().collect();
        let mut base = Vec::with_capacity(slots.len());
        for (i, slot) in slots.iter().enumerate() {
            if let Some(child) = slot {
                if child.outer != self.inner[i] {
                    return Err(Error::new(
                        ErrorKind::StarMismatch,
                        format!(
                            "inner star {i} is {:?} but child {i} has outer star {:?}",
                            self.inner[i], child.outer
                        ),
                    ));
                }
                base.push(types.len() as Cable);
                types.extend(child.cables.iter());
            } else {
                base.push(0);
            }
        }
        let total = types.len();
        if u32::try_from(total).is_err() {
            return Err(Error::new(
                ErrorKind::CableOutOfRange,
                "more than u32::MAX cables",
            ));
        }

        let mut uf = UnionFind::new(total);
        for (i, slot) in slots.iter().enumerate() {
            if let Some(child) = slot {
                for (&a, &b) in self.inner_cables(i).iter().zip(&child.outer_cables) {
                    uf.union(a, base[i] + b);
                }
            }
        }
        let root: Vec<Cable> = (0..total as Cable).map(|x| uf.find(x)).collect();

        let mut stars = Vec::new();
        let mut raw = Vec::new();
        for (i, slot) in slots.iter().enumerate() {
            if let Some(child) = slot {
                stars.extend(child.inner.iter().cloned());
                let off = base[i];
                raw.extend(child.inner_cables.iter().map(|&c| root[(off + c) as usize]));
            } else {
                stars.push(self.inner[i].clone());
                raw.extend(self.inner_cables(i).iter().map(|&c| root[c as usize]));
            }
        }
        let outer_raw: Vec<Cable> = self
            .outer_cables
            .iter()
            .map(|&c| root[c as usize])
            .collect();
        let classes = (0..total as Cable).filter(|&x| root[x as usize] == x);
        Ok(canonical(
            &types,
            stars,
            &raw,
            self.outer.clone(),
            &outer_raw,
            classes,
        ))
    }

    /// The symmetric group action: inner star `k` of the result is inner star
    /// `sigma[k]` of `self`.
    ///
    /// # Errors
    /// [`ErrorKind::NotAPermutation`] unless `sigma` is a permutation of `0..arity`.
    pub fn permute(&self, sigma: &[usize]) -> Result<Self> {
        let n = self.arity();
        let mut seen = vec![false; n];
        let ok = sigma.len() == n
            && sigma
                .iter()
                .all(|&s| s < n && !std::mem::replace(&mut seen[s], true));
        if !ok {
            return Err(Error::new(
                ErrorKind::NotAPermutation,
                format!("{sigma:?} is not a permutation of 0..{n}"),
            ));
        }
        let stars = sigma.iter().map(|&s| self.inner[s].clone()).collect();
        let raw: Vec<Cable> = sigma
            .iter()
            .flat_map(|&s| self.inner_cables(s).iter().copied())
            .collect();
        let types: Vec<&Label> = self.cables.iter().collect();
        let k = self.cables.len() as Cable;
        Ok(canonical(
            &types,
            stars,
            &raw,
            self.outer.clone(),
            &self.outer_cables,
            0..k,
        ))
    }

    /// The operad functor induced by a function on type names.
    ///
    /// Mapping every type to one name is the forgetful functor `U: T → S`, and
    /// applied to a diagram of S, mapping to `A` is `F_A: S → T` (Spivak, §4.1).
    #[must_use]
    pub fn map_types(&self, mut f: impl FnMut(&str) -> Label) -> Self {
        let types: Vec<Label> = self.cables.iter().map(|t| f(t)).collect();
        let retype = |star: &Star, cs: &[Cable]| {
            Star::from_sorted(
                star.names().into(),
                cs.iter().map(|&c| types[c as usize].clone()).collect(),
            )
        };
        let stars = (0..self.arity())
            .map(|i| retype(&self.inner[i], self.inner_cables(i)))
            .collect();
        let outer = retype(&self.outer, &self.outer_cables);
        let refs: Vec<&Label> = types.iter().collect();
        let k = types.len() as Cable;
        canonical(
            &refs,
            stars,
            &self.inner_cables,
            outer,
            &self.outer_cables,
            0..k,
        )
    }

    /// `(wire, cable)` pairs of inner star `i`, in canonical order.
    pub fn inner_wiring(&self, i: usize) -> impl ExactSizeIterator<Item = (&str, Cable)> + Clone {
        self.inner[i]
            .names()
            .iter()
            .map(|n| &**n)
            .zip(self.inner_cables(i).iter().copied())
    }

    /// `(wire, cable)` pairs of the outer star, in canonical order.
    pub fn outer_wiring(&self) -> impl ExactSizeIterator<Item = (&str, Cable)> + Clone {
        self.outer
            .names()
            .iter()
            .map(|n| &**n)
            .zip(self.outer_cables.iter().copied())
    }
}

/// Which star a wiring belongs to, for error messages.
#[derive(Clone, Copy)]
enum Side {
    Inner(usize),
    Outer,
}

impl fmt::Display for Side {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Inner(i) => write!(f, "inner star {i}"),
            Self::Outer => f.write_str("outer"),
        }
    }
}

/// Shares one `Label` between equal strings.
#[derive(Default)]
struct Interner(HashSet<Label>);

impl Interner {
    fn get(&mut self, s: &str) -> Label {
        if let Some(label) = self.0.get(s) {
            return label.clone();
        }
        let label: Label = s.into();
        self.0.insert(label.clone());
        label
    }
}

/// Validate one star's `(wire, cable)` list, derive the star's types from the
/// cables, and append its cables (in canonical wire order) to `raw`.
fn wiring(
    types: &[Label],
    side: Side,
    pairs: &mut [(Label, usize)],
    raw: &mut Vec<Cable>,
) -> Result<Star> {
    let k = types.len();
    pairs.sort_unstable_by(|a, b| a.0.cmp(&b.0));
    if let Some(w) = pairs.windows(2).find(|w| w[0].0 == w[1].0) {
        return Err(Error::new(
            ErrorKind::DuplicateWire,
            format!("{side} wire {:?} appears twice", w[0].0),
        ));
    }
    if let Some((n, c)) = pairs.iter().find(|(_, c)| *c >= k) {
        return Err(Error::new(
            ErrorKind::CableOutOfRange,
            format!("{side} wire {n:?} -> cable {c}, but there are {k} cables"),
        ));
    }
    raw.extend(pairs.iter().map(|(_, c)| *c as Cable));
    Ok(Star::from_sorted(
        pairs.iter().map(|(n, _)| n.clone()).collect(),
        pairs.iter().map(|(_, c)| types[*c].clone()).collect(),
    ))
}

/// Relabel raw cable ids by first appearance, then append the floating cables
/// sorted by type. `types[c]` is the type of raw cable `c`, and `classes`
/// enumerates every raw cable of the cospan, including those no wire touches.
fn canonical(
    types: &[&Label],
    inner: Vec<Star>,
    inner_raw: &[Cable],
    outer: Star,
    outer_raw: &[Cable],
    classes: impl Iterator<Item = Cable>,
) -> WiringDiagram {
    const UNSEEN: Cable = Cable::MAX;
    let mut relabel = vec![UNSEEN; types.len()];
    let mut cables: Vec<Label> = Vec::new();
    let mut label = |c: Cable| {
        let slot = &mut relabel[c as usize];
        if *slot == UNSEEN {
            *slot = cables.len() as Cable;
            cables.push(types[c as usize].clone());
        }
        *slot
    };
    let inner_cables: Vec<Cable> = inner_raw.iter().map(|&c| label(c)).collect();
    let outer_cables: Vec<Cable> = outer_raw.iter().map(|&c| label(c)).collect();
    let mut floating: Vec<Label> = classes
        .filter(|&c| relabel[c as usize] == UNSEEN)
        .map(|c| types[c as usize].clone())
        .collect();
    floating.sort_unstable();
    cables.extend(floating);

    let mut offsets = Vec::with_capacity(inner.len() + 1);
    offsets.push(0);
    let mut acc = 0;
    for star in &inner {
        acc += star.len() as u32;
        offsets.push(acc);
    }
    WiringDiagram {
        cables,
        inner,
        offsets,
        inner_cables,
        outer,
        outer_cables,
    }
}

// Shows the cospan as the JSON form does; `offsets` and the inner stars are derived from it.
#[allow(clippy::missing_fields_in_debug)]
impl fmt::Debug for WiringDiagram {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        struct Wiring<I>(I);
        impl<'a, I: Clone + Iterator<Item = (&'a str, Cable)>> fmt::Debug for Wiring<I> {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.debug_map().entries(self.0.clone()).finish()
            }
        }
        f.debug_struct("WiringDiagram")
            .field("cables", &self.cables)
            .field(
                "inner",
                &(0..self.arity())
                    .map(|i| Wiring(self.inner_wiring(i)))
                    .collect::<Vec<_>>(),
            )
            .field("outer", &Wiring(self.outer_wiring()))
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wd(cables: &[&str], inner: &[&[(&str, usize)]], outer: &[(&str, usize)]) -> WiringDiagram {
        WiringDiagram::new(
            cables.iter().copied(),
            inner.iter().map(|w| w.iter().copied()),
            outer.iter().copied(),
        )
        .unwrap()
    }

    #[test]
    fn renaming_cables_gives_the_same_morphism() {
        let a = wd(&["A", "B", "A"], &[&[("x", 0), ("y", 1)]], &[("z", 2)]);
        let b = wd(&["B", "A", "A"], &[&[("x", 2), ("y", 0)]], &[("z", 1)]);
        assert_eq!(a, b);
        assert_eq!(a.inner_cables(0), [0, 1]);
    }

    #[test]
    fn floating_cables_sort_last_by_type() {
        let a = wd(&["B", "A", "A"], &[], &[("o", 1)]);
        let types: Vec<&str> = a.cables().iter().map(|t| &**t).collect();
        assert_eq!(types, ["A", "A", "B"]);
        assert_eq!(a.floating_cables(), 1..3);
    }

    #[test]
    fn closed_loops_become_floating_cables() {
        let outer = wd(&["A"], &[&[("p", 0)]], &[]);
        let inner = wd(&["A"], &[], &[("p", 0)]);
        let composite = outer.compose(&[inner]).unwrap();
        assert_eq!(composite.arity(), 0);
        assert_eq!(composite.floating_cables(), 0..1);
    }

    #[test]
    fn construction_errors() {
        let none: [(&str, usize); 0] = [];
        let err = WiringDiagram::new(["A"], [[("x", 1)]], none).unwrap_err();
        assert_eq!(err.kind(), ErrorKind::CableOutOfRange);
        let err = WiringDiagram::new(["A"], [[("x", 0), ("x", 0)]], none).unwrap_err();
        assert_eq!(err.kind(), ErrorKind::DuplicateWire);
    }
}
