//! The operad of wiring diagrams (Spivak, *The operad of wiring diagrams*,
//! arXiv:1305.0297).
//!
//! * [`Star`] — objects (typed stars)
//! * [`WiringDiagram`] — morphisms (typed cospans up to isomorphism), with
//!   [`identity`](WiringDiagram::identity), [`compose`](WiringDiagram::compose),
//!   [`compose_at`](WiringDiagram::compose_at), [`permute`](WiringDiagram::permute)
//!   and [`map_types`](WiringDiagram::map_types)
//! * [`closed`] — internal hom, evaluation, (ex/in)ternalization
//! * [`rel`] — the relational algebra, including recursion
//! * [`eq`] — the algebra of equivalence relations
//! * [`Term`] — trees of diagrams, with presentation labels
//!
//! ```
//! use wiring_diagrams::{Star, WiringDiagram};
//!
//! // NOT from NAND (Example 2.2.11): solder both NAND inputs onto one cable.
//! let not = WiringDiagram::new(
//!     ["Bool", "Bool"],
//!     [[("A", 0), ("B", 0), ("out", 1)]],
//!     [("in", 0), ("out", 1)],
//! )?;
//! let nand = Star::new([("A", "Bool"), ("B", "Bool"), ("out", "Bool")])?;
//! assert_eq!(not.inner(), [nand.clone()]);
//! assert_eq!(not.compose(&[WiringDiagram::identity(&nand)])?, not);
//! # Ok::<(), wiring_diagrams::Error>(())
//! ```

pub mod closed;
mod diagram;
pub mod eq;
mod error;
#[cfg(feature = "serde")]
mod json;
pub mod rel;
mod scalar;
mod star;
mod term;
mod union_find;

pub use diagram::{Cable, WiringDiagram};
pub use error::{Error, ErrorKind, Result};
pub use scalar::Scalar;
pub use star::{Label, Star};
pub use term::Term;
