//! The operad laws, the closed structure, and functoriality of Rel and Eq.

mod common;

use common::{Gen, domains, seeds};
use wiring_diagrams::closed::{evaluation, externalize, internalize};
use wiring_diagrams::eq::{self, Partition};
use wiring_diagrams::rel;
use wiring_diagrams::{Label, WiringDiagram};

fn id(x: &wiring_diagrams::Star) -> WiringDiagram {
    WiringDiagram::identity(x)
}

/// `(φ, ψ)` with `ψ[i].outer() == φ.inner()[i]`.
fn two_level(g: &mut Gen) -> (WiringDiagram, Vec<WiringDiagram>) {
    let phi = g.diagram(None, None, 3);
    let psis = phi
        .inner()
        .iter()
        .map(|x| g.diagram(None, Some(x.clone()), 3))
        .collect();
    (phi, psis)
}

#[test]
fn identity_laws() {
    for seed in seeds() {
        let phi = Gen::new(seed).diagram(None, None, 3);
        let ids: Vec<_> = phi.inner().iter().map(id).collect();
        assert_eq!(phi.compose(&ids).unwrap(), phi, "seed {seed}");
        assert_eq!(
            id(phi.outer()).compose(std::slice::from_ref(&phi)).unwrap(),
            phi,
            "seed {seed}"
        );
    }
}

#[test]
fn associativity() {
    for seed in seeds() {
        let mut g = Gen::new(seed);
        let (phi, psis) = two_level(&mut g);
        let chis: Vec<Vec<WiringDiagram>> = psis
            .iter()
            .map(|psi| {
                psi.inner()
                    .iter()
                    .map(|x| g.diagram(None, Some(x.clone()), 2))
                    .collect()
            })
            .collect();
        let inner_first: Vec<_> = psis
            .iter()
            .zip(&chis)
            .map(|(p, c)| p.compose(c).unwrap())
            .collect();
        let lhs = phi.compose(&inner_first).unwrap();
        let rhs = phi.compose(&psis).unwrap().compose(&chis.concat()).unwrap();
        assert_eq!(lhs, rhs, "seed {seed}");
    }
}

#[test]
fn equivariance() {
    for seed in seeds() {
        let mut g = Gen::new(seed);
        let (phi, psis) = two_level(&mut g);
        let sigma = g.shuffle(phi.arity());
        let permuted: Vec<_> = sigma.iter().map(|&s| psis[s].clone()).collect();
        let lhs = phi.permute(&sigma).unwrap().compose(&permuted).unwrap();
        let mut starts = vec![0];
        for p in &psis {
            starts.push(starts.last().unwrap() + p.arity());
        }
        let block: Vec<usize> = sigma
            .iter()
            .flat_map(|&s| starts[s]..starts[s + 1])
            .collect();
        let rhs = phi.compose(&psis).unwrap().permute(&block).unwrap();
        assert_eq!(lhs, rhs, "seed {seed}");
    }
}

#[test]
fn permutation_is_a_right_action() {
    for seed in seeds() {
        let mut g = Gen::new(seed);
        let phi = g.diagram(None, None, 4);
        let (s, t) = (g.shuffle(phi.arity()), g.shuffle(phi.arity()));
        let st: Vec<usize> = t.iter().map(|&k| s[k]).collect();
        assert_eq!(
            phi.permute(&s).unwrap().permute(&t).unwrap(),
            phi.permute(&st).unwrap(),
            "seed {seed}"
        );
    }
}

#[test]
fn partial_composition_agrees_with_full() {
    for seed in seeds() {
        let mut g = Gen::new(seed);
        let (phi, psis) = two_level(&mut g);
        if phi.arity() == 0 {
            continue;
        }
        let i = g.below(phi.arity());
        let mut kids: Vec<_> = phi.inner().iter().map(id).collect();
        kids[i] = psis[i].clone();
        assert_eq!(
            phi.compose_at(i, &psis[i]).unwrap(),
            phi.compose(&kids).unwrap(),
            "seed {seed}"
        );
    }
}

#[test]
fn map_types_is_an_operad_functor() {
    let forget = |_: &str| Label::from("*");
    for seed in seeds() {
        let (phi, psis) = two_level(&mut Gen::new(seed));
        let lhs = phi.compose(&psis).unwrap().map_types(forget);
        let mapped: Vec<_> = psis.iter().map(|p| p.map_types(forget)).collect();
        assert_eq!(
            lhs,
            phi.map_types(forget).compose(&mapped).unwrap(),
            "seed {seed}"
        );
    }
}

#[test]
fn closed_structure() {
    for seed in seeds() {
        let mut g = Gen::new(seed);
        let phi = g.diagram(None, None, 4);
        let m = g.below(phi.arity() + 1);
        let ys = phi.inner()[m..].to_vec();
        let curried = internalize(&phi, m).unwrap();
        let back = externalize(&curried, &ys, phi.outer()).unwrap();
        assert_eq!(back, phi, "seed {seed}");
        let mut kids = vec![curried];
        kids.extend(ys.iter().map(id));
        assert_eq!(
            evaluation(&ys, phi.outer()).compose(&kids).unwrap(),
            back,
            "seed {seed}"
        );
    }
}

#[test]
fn rel_respects_composition_identity_and_symmetry() {
    let doms = domains();
    for seed in seeds() {
        let mut g = Gen::new(seed);
        let (phi, psis) = two_level(&mut g);
        let leaves: Vec<Vec<_>> = psis
            .iter()
            .map(|p| p.inner().iter().map(|x| g.relation(x)).collect())
            .collect();
        let mids: Vec<_> = psis
            .iter()
            .zip(&leaves)
            .map(|(p, rs)| rel::apply(p, rs, &doms).unwrap())
            .collect();
        let stepwise = rel::apply(&phi, &mids, &doms).unwrap();
        let flat = rel::apply(&phi.compose(&psis).unwrap(), &leaves.concat(), &doms).unwrap();
        assert_eq!(stepwise, flat, "composition, seed {seed}");

        for (x, r) in phi.inner().iter().zip(&mids) {
            assert_eq!(
                rel::apply(&id(x), std::slice::from_ref(r), &doms).unwrap(),
                *r,
                "identity, seed {seed}"
            );
        }

        let sigma = g.shuffle(phi.arity());
        let permuted: Vec<_> = sigma.iter().map(|&s| mids[s].clone()).collect();
        let lhs = rel::apply(&phi.permute(&sigma).unwrap(), &permuted, &doms).unwrap();
        assert_eq!(lhs, stepwise, "equivariance, seed {seed}");
    }
}

#[test]
fn rel_preserves_unions() {
    let doms = domains();
    for seed in seeds() {
        let mut g = Gen::new(seed);
        let phi = g.diagram(None, None, 3);
        if phi.arity() == 0 {
            continue;
        }
        let rs: Vec<_> = phi.inner().iter().map(|x| g.relation(x)).collect();
        let i = g.below(phi.arity());
        let extra = g.relation(&phi.inner()[i]);
        let mut joined = rs.clone();
        joined[i] = rs[i].union(&extra).unwrap();
        let mut alt = rs.clone();
        alt[i] = extra;
        let lhs = rel::apply(&phi, &joined, &doms).unwrap();
        let rhs = rel::apply(&phi, &rs, &doms)
            .unwrap()
            .union(&rel::apply(&phi, &alt, &doms).unwrap())
            .unwrap();
        assert_eq!(lhs, rhs, "seed {seed}");
    }
}

#[test]
fn eq_respects_composition() {
    for seed in seeds() {
        let mut g = Gen::new(seed);
        let (phi, psis) = two_level(&mut g);
        let leaves: Vec<Vec<Partition>> = psis
            .iter()
            .map(|p| {
                p.inner()
                    .iter()
                    .map(|x| {
                        let blocks: Vec<u32> = (0..x.len()).map(|_| g.below(3) as u32).collect();
                        Partition::new(x.clone(), &blocks).unwrap()
                    })
                    .collect()
            })
            .collect();
        let mids: Vec<_> = psis
            .iter()
            .zip(&leaves)
            .map(|(p, ps)| eq::apply(p, ps).unwrap())
            .collect();
        let stepwise = eq::apply(&phi, &mids).unwrap();
        let flat = eq::apply(&phi.compose(&psis).unwrap(), &leaves.concat()).unwrap();
        assert_eq!(stepwise, flat, "seed {seed}");
    }
}
