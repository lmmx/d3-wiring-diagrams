//! A small deterministic generator of stars and diagrams for the law tests.
//!
//! The law tests loop over fixed seeds instead of using a property-testing
//! framework. Runs are reproducible, and a failure reports its seed.
#![allow(dead_code)]

use std::collections::HashMap;

use wiring_diagrams::rel::{Domains, Relation};
use wiring_diagrams::{Scalar, Star, WiringDiagram};

pub const TYPES: [&str; 2] = ["A", "B"];
pub const NAMES: [&str; 6] = ["a", "b", "c", "d", "é", "😀"];

/// The `SplitMix64` generator.
pub struct Gen(u64);

impl Gen {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }

    pub fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    pub fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }

    pub fn coin(&mut self) -> bool {
        self.next() & 1 == 1
    }

    pub fn shuffle(&mut self, n: usize) -> Vec<usize> {
        let mut xs: Vec<usize> = (0..n).collect();
        for i in (1..n).rev() {
            xs.swap(i, self.below(i + 1));
        }
        xs
    }

    pub fn star(&mut self) -> Star {
        let names: Vec<&str> = NAMES
            .iter()
            .copied()
            .filter(|_| self.below(2) == 0)
            .collect();
        Star::new(names.into_iter().map(|n| (n, TYPES[self.below(2)]))).unwrap()
    }

    pub fn diagram(
        &mut self,
        inner: Option<Vec<Star>>,
        outer: Option<Star>,
        max_arity: usize,
    ) -> WiringDiagram {
        let inner = inner.unwrap_or_else(|| {
            (0..self.below(max_arity + 1))
                .map(|_| self.star())
                .collect()
        });
        let outer = outer.unwrap_or_else(|| self.star());
        let mut cables: Vec<&str> = Vec::new();
        let mut solder = |g: &mut Self, ty: &'static str| {
            let same: Vec<usize> = (0..cables.len()).filter(|&c| cables[c] == ty).collect();
            if !same.is_empty() && g.coin() {
                same[g.below(same.len())]
            } else {
                cables.push(ty);
                cables.len() - 1
            }
        };
        let ty = |t: &str| if t == "A" { "A" } else { "B" };
        let inner_maps: Vec<Vec<(String, usize)>> = inner
            .iter()
            .map(|x| {
                x.iter()
                    .map(|(n, t)| (n.to_string(), solder(self, ty(t))))
                    .collect()
            })
            .collect();
        let outer_map: Vec<(String, usize)> = outer
            .iter()
            .map(|(n, t)| (n.to_string(), solder(self, ty(t))))
            .collect();
        for _ in 0..self.below(3) {
            cables.push(TYPES[self.below(2)]);
        }
        WiringDiagram::new(cables, inner_maps, outer_map).unwrap()
    }

    pub fn relation(&mut self, star: &Star) -> Relation<Scalar> {
        let doms = domains();
        let universe = Relation::full(star.clone(), &doms).unwrap();
        let all: Vec<Vec<Scalar>> = universe.rows().map(<[Scalar]>::to_vec).collect();
        let rows: Vec<Vec<Scalar>> = if all.is_empty() {
            Vec::new()
        } else {
            (0..self.below(6))
                .map(|_| all[self.below(all.len())].clone())
                .collect()
        };
        Relation::new(star.clone(), rows).unwrap()
    }
}

pub fn domains() -> Domains<Scalar> {
    HashMap::from([
        ("A".to_string(), vec![Scalar::Int(0), Scalar::Int(1)]),
        (
            "B".to_string(),
            ["x", "y", "z"]
                .iter()
                .map(|s| Scalar::Str((*s).into()))
                .collect(),
        ),
    ])
}

/// The seeds every law is checked on.
pub fn seeds() -> impl Iterator<Item = u64> {
    0..400
}
