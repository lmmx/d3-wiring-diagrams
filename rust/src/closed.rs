//! The closed structure of the operad (Spivak, Definition 5.1.1, Proposition 5.1.4).
//!
//! The internal hom `[Y₁, …, Yₙ ⇒ Z]` is the coproduct `Y₁ ⊔ … ⊔ Yₙ ⊔ Z`. A
//! coproduct of named sets needs fresh names, so wire `a` of `Yᵢ` is called
//! `"{i}.{a}"` and wire `b` of `Z` is called `"out.{b}"`. The text before the
//! first `.` is a decimal index or `out`, which makes the encoding injective.

use std::collections::HashMap;

use crate::diagram::{Cable, WiringDiagram};
use crate::error::{Error, ErrorKind, Result};
use crate::star::Star;

/// Name in `[Y ⇒ Z]` of wire `name` of `Yᵢ` (`Some(i)`) or of `Z` (`None`).
pub fn hom_wire(i: Option<usize>, name: &str) -> String {
    match i {
        Some(i) => format!("{i}.{name}"),
        None => format!("out.{name}"),
    }
}

/// The internal hom object `[Y₁, …, Yₙ ⇒ Z] = Y₁ ⊔ … ⊔ Yₙ ⊔ Z`.
pub fn internal_hom(ys: &[Star], z: &Star) -> Star {
    let pairs = ys
        .iter()
        .enumerate()
        .flat_map(|(i, y)| y.iter().map(move |(a, t)| (hom_wire(Some(i), a), t)))
        .chain(z.iter().map(|(b, t)| (hom_wire(None, b), t)));
    Star::new(pairs).expect("hom_wire is injective")
}

/// `ev: [Y ⇒ Z], Y₁, …, Yₙ → Z`. There is one cable per wire of `[Y ⇒ Z]`,
/// each `Yᵢ` folds onto its copy, and `Z` is soldered onto its copy.
pub fn evaluation(ys: &[Star], z: &Star) -> WiringDiagram {
    let hom = internal_hom(ys, z);
    let cable = |name: &str| hom.index_of(name).expect("wire of [Y ⇒ Z]");
    let mut inner: Vec<Vec<(String, usize)>> = vec![
        hom.names()
            .iter()
            .enumerate()
            .map(|(c, n)| (n.to_string(), c))
            .collect(),
    ];
    for (i, y) in ys.iter().enumerate() {
        inner.push(
            y.names()
                .iter()
                .map(|a| (a.to_string(), cable(&hom_wire(Some(i), a))))
                .collect(),
        );
    }
    let outer = z
        .names()
        .iter()
        .map(|b| (b.to_string(), cable(&hom_wire(None, b))));
    WiringDiagram::new(hom.types().iter().cloned(), inner, outer)
        .expect("well-formed by construction")
}

/// `extl: O(X; [Y ⇒ Z]) → O(X, Y; Z)`.
///
/// Equal to `evaluation(ys, z).compose(&[phi, id_Y₁, …, id_Yₙ])`, which is
/// the definition in the paper. It is computed directly in O(size) by moving
/// the `Yᵢ` part of `g` into `f`.
///
/// # Errors
/// [`ErrorKind::HomMismatch`] unless `phi.outer() == internal_hom(ys, z)`.
pub fn externalize(phi: &WiringDiagram, ys: &[Star], z: &Star) -> Result<WiringDiagram> {
    let hom = internal_hom(ys, z);
    if *phi.outer() != hom {
        return Err(Error::new(
            ErrorKind::HomMismatch,
            format!("outer star {:?} is not [Y ⇒ Z] = {hom:?}", phi.outer()),
        ));
    }
    let g: HashMap<&str, Cable> = phi.outer_wiring().collect();
    let mut inner: Vec<Vec<(String, usize)>> = (0..phi.arity())
        .map(|i| {
            phi.inner_wiring(i)
                .map(|(n, c)| (n.to_string(), c as usize))
                .collect()
        })
        .collect();
    for (i, y) in ys.iter().enumerate() {
        inner.push(
            y.names()
                .iter()
                .map(|a| (a.to_string(), g[&*hom_wire(Some(i), a)] as usize))
                .collect(),
        );
    }
    let outer = z
        .names()
        .iter()
        .map(|b| (b.to_string(), g[&*hom_wire(None, b)] as usize));
    WiringDiagram::new(phi.cables().iter().cloned(), inner, outer)
}

/// `intl: O(X₁..Xₘ, Y₁..Yₙ; Z) → O(X₁..Xₘ; [Y ⇒ Z])`, the inverse of [`externalize`].
///
/// # Errors
/// [`ErrorKind::SplitOutOfRange`] if `m > psi.arity()`.
pub fn internalize(psi: &WiringDiagram, m: usize) -> Result<WiringDiagram> {
    if m > psi.arity() {
        return Err(Error::new(
            ErrorKind::SplitOutOfRange,
            format!("cannot split {} inner stars at {m}", psi.arity()),
        ));
    }
    let inner: Vec<Vec<(String, usize)>> = (0..m)
        .map(|i| {
            psi.inner_wiring(i)
                .map(|(n, c)| (n.to_string(), c as usize))
                .collect()
        })
        .collect();
    let outer = (m..psi.arity())
        .flat_map(|i| {
            psi.inner_wiring(i)
                .map(move |(a, c)| (hom_wire(Some(i - m), a), c as usize))
        })
        .chain(
            psi.outer_wiring()
                .map(|(b, c)| (hom_wire(None, b), c as usize)),
        );
    WiringDiagram::new(psi.cables().iter().cloned(), inner, outer)
}
