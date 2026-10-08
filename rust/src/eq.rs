//! The algebra Eq of equivalence relations (Spivak, Example 3.1.3).
//!
//! `Eq(X)` is the set of partitions of the wires of `X`. `Eq(φ)` connects
//! wires globally whenever they are connected through the diagram. Types are
//! ignored, so this is an algebra on `S` pulled back along `U: T → S`.

use std::collections::HashMap;

use crate::diagram::WiringDiagram;
use crate::error::{Error, ErrorKind, Result};
use crate::star::Star;
use crate::union_find::UnionFind;

/// A partition of a star's wires: a block id for each wire in canonical
/// order, numbered by first appearance so equal partitions are equal values.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Partition {
    star: Star,
    blocks: Vec<u32>,
}

impl Partition {
    /// A partition from any block labelling, one per wire.
    ///
    /// # Errors
    /// [`ErrorKind::InvalidPartition`] if `blocks.len() != star.len()`.
    pub fn new(star: Star, blocks: &[u32]) -> Result<Self> {
        if blocks.len() != star.len() {
            return Err(Error::new(
                ErrorKind::InvalidPartition,
                format!("{} block ids for {} wires", blocks.len(), star.len()),
            ));
        }
        Ok(Self {
            star,
            blocks: restricted_growth(blocks),
        })
    }

    /// Every wire in its own block.
    pub fn discrete(star: Star) -> Self {
        let blocks = (0..star.len() as u32).collect();
        Self { star, blocks }
    }

    /// The star the partition is on.
    pub fn star(&self) -> &Star {
        &self.star
    }

    /// Block id of each wire, in canonical order.
    pub fn blocks(&self) -> &[u32] {
        &self.blocks
    }
}

fn restricted_growth(labels: &[u32]) -> Vec<u32> {
    let mut seen: HashMap<u32, u32> = HashMap::new();
    labels
        .iter()
        .map(|&b| {
            let next = seen.len() as u32;
            *seen.entry(b).or_insert(next)
        })
        .collect()
}

/// `Eq(φ)(E₁, …, Eₙ)`: the partition of the outer star induced through the cables.
///
/// # Errors
/// [`ErrorKind::ArityMismatch`] and [`ErrorKind::StarMismatch`] for arguments that do not fit `phi`.
pub fn apply(phi: &WiringDiagram, partitions: &[Partition]) -> Result<Partition> {
    if partitions.len() != phi.arity() {
        return Err(Error::new(
            ErrorKind::ArityMismatch,
            format!(
                "diagram has {} inner stars, got {}",
                phi.arity(),
                partitions.len()
            ),
        ));
    }
    let mut uf = UnionFind::new(phi.cables().len());
    for (i, p) in partitions.iter().enumerate() {
        if p.star != phi.inner()[i] {
            return Err(Error::new(
                ErrorKind::StarMismatch,
                format!(
                    "partition {i} is on {:?}, expected {:?}",
                    p.star,
                    phi.inner()[i]
                ),
            ));
        }
        let wiring = phi.inner_cables(i);
        let mut first: HashMap<u32, u32> = HashMap::new();
        for (w, &b) in p.blocks.iter().enumerate() {
            let c = wiring[w];
            uf.union(*first.entry(b).or_insert(c), c);
        }
    }
    let roots: Vec<u32> = phi.outer_cables().iter().map(|&c| uf.find(c)).collect();
    Ok(Partition {
        star: phi.outer().clone(),
        blocks: restricted_growth(&roots),
    })
}
