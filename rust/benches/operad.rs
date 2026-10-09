//! Throughput of composition and of the relational algebra.
//!
//! `cargo bench` — the numbers in docs/performance.md come from here.
#![allow(missing_docs)] // criterion's macros generate undocumented items

use std::collections::HashMap;

use criterion::{BenchmarkId, Criterion, Throughput, criterion_group, criterion_main};
use wiring_diagrams::rel::{self, Relation};
use wiring_diagrams::{Star, WiringDiagram};

/// `n` inner stars in a ring: star `i` has wires `l`, `r`, `o`; `r` of star
/// `i` shares a cable with `l` of star `i + 1`, and every `o` goes out.
fn ring(n: usize, ty: &str) -> WiringDiagram {
    let inner = (0..n).map(|i| vec![("l", i), ("r", (i + 1) % n), ("o", n + i)]);
    let outer: Vec<(String, usize)> = (0..n).map(|i| (format!("o{i:06}"), n + i)).collect();
    WiringDiagram::new(std::iter::repeat_n(ty, 2 * n), inner, outer).unwrap()
}

/// A diagram filling a `{l, r, o}` star with a chain of `m` such stars.
fn chain(m: usize) -> WiringDiagram {
    let inner = (0..m).map(|i| vec![("l", i), ("r", i + 1), ("o", m + 1 + i)]);
    let outer = [("l", 0), ("r", m), ("o", m + 1)];
    WiringDiagram::new(std::iter::repeat_n("A", 2 * m + 1), inner, outer).unwrap()
}

fn compose(c: &mut Criterion) {
    let mut g = c.benchmark_group("compose");
    for n in [100, 1_000, 10_000] {
        let outer = ring(n, "A");
        let kids = vec![chain(8); n];
        let wires = (n * 8 * 3 + n * 3) as u64;
        g.throughput(Throughput::Elements(wires));
        g.bench_with_input(BenchmarkId::new("ring_of_chains", n), &n, |b, _| {
            b.iter(|| outer.compose(&kids).unwrap());
        });
    }
    let outer = ring(10_000, "A");
    let kid = chain(8);
    g.bench_function("compose_at/10000", |b| {
        b.iter(|| outer.compose_at(5_000, &kid).unwrap());
    });
    g.finish();

    let mut g = c.benchmark_group("canonical");
    for n in [1_000, 10_000] {
        let phi = ring(n, "A");
        let json = serde_json::to_string(&phi).unwrap();
        g.bench_with_input(BenchmarkId::new("from_json", n), &json, |b, s| {
            b.iter(|| WiringDiagram::from_json(s).unwrap());
        });
        let sigma: Vec<usize> = (0..n).rev().collect();
        g.bench_with_input(BenchmarkId::new("permute", n), &sigma, |b, s| {
            b.iter(|| phi.permute(s).unwrap());
        });
    }
    g.finish();
}

fn relational(c: &mut Criterion) {
    // Rel over a chain of m binary relations "x_{i+1} = x_i + 1 mod d" with only the
    // two ends exposed: a path query that the greedy plan joins in order.
    let mut g = c.benchmark_group("rel");
    for (m, d) in [(8, 64_i64), (32, 64), (8, 512)] {
        let star = Star::new([("l", "N"), ("r", "N")]).unwrap();
        let succ = Relation::new(star.clone(), (0..d).map(|x| vec![x, (x + 1) % d])).unwrap();
        let inner = (0..m).map(|i| vec![("l", i), ("r", i + 1)]);
        let phi = WiringDiagram::new(std::iter::repeat_n("N", m + 1), inner, [("a", 0), ("b", m)])
            .unwrap();
        let rels = vec![succ; m];
        let domains: HashMap<String, Vec<i64>> = HashMap::from([("N".into(), (0..d).collect())]);
        g.bench_function(format!("path/m={m}/d={d}"), |b| {
            b.iter(|| rel::apply(&phi, &rels, &domains).unwrap());
        });
    }
    g.finish();
}

criterion_group!(benches, compose, relational);
criterion_main!(benches);
