//! The paper's worked examples (`spec/examples`): terms evaluate, and Rel
//! reproduces the expected outer relation, both flat and level by level.

use std::path::PathBuf;

use serde_json::Value;
use wiring_diagrams::rel::{self, Domains, Relation};
use wiring_diagrams::{Scalar, Star, Term};

fn examples() -> Vec<(String, Value)> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../spec/examples");
    let index: Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("index.json")).unwrap()).unwrap();
    index
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            let slug = e["slug"].as_str().unwrap().to_string();
            let text = std::fs::read_to_string(dir.join(format!("{slug}.json"))).unwrap();
            (slug, serde_json::from_str(&text).unwrap())
        })
        .collect()
}

/// `Rel` of a term, evaluated level by level (no flattening).
fn nested(
    term: &Term,
    leaves: &mut std::slice::Iter<'_, Relation<Scalar>>,
    doms: &Domains<Scalar>,
) -> Relation<Scalar> {
    let args: Vec<_> = term
        .children()
        .iter()
        .map(|kid| match kid {
            Some(kid) => nested(kid, leaves, doms),
            None => leaves.next().unwrap().clone(),
        })
        .collect();
    rel::apply(term.diagram(), &args, doms).unwrap()
}

#[test]
fn examples_reproduce_their_expected_relations() {
    let all = examples();
    assert_eq!(all.len(), 9);
    for (slug, ex) in all {
        let term = Term::from_json_value(ex["term"].clone()).unwrap();
        let phi = term.evaluate();
        assert_eq!(term.leaf_labels().len(), phi.arity(), "{slug}");
        let Some(alg) = ex.get("algebra") else {
            continue;
        };
        let doms: Domains<Scalar> = serde_json::from_value(alg["domains"].clone()).unwrap();
        let rels: Vec<Relation<Scalar>> = phi
            .inner()
            .iter()
            .zip(alg["relations"].as_array().unwrap())
            .map(|(x, r)| Relation::from_json_value(x.clone(), r.clone()).unwrap())
            .collect();
        if alg["kind"] == "rel_recursive" {
            // phi: X -> [Z => Z]; Z is the `out.*` half of the outer star
            let z = Star::new(
                phi.outer()
                    .iter()
                    .filter_map(|(n, t)| n.strip_prefix("out.").map(|n| (n.to_string(), t))),
            )
            .unwrap();
            let expected = Relation::from_json_value(z.clone(), alg["expected"].clone()).unwrap();
            assert_eq!(
                rel::recursive(&phi, &rels, &z, &doms).unwrap(),
                expected,
                "{slug}"
            );
            continue;
        }
        let expected =
            Relation::from_json_value(phi.outer().clone(), alg["expected"].clone()).unwrap();
        let got = rel::apply(&phi, &rels, &doms).unwrap();
        assert_eq!(got, expected, "{slug}");
        assert_eq!(
            nested(&term, &mut rels.iter(), &doms),
            got,
            "{slug} (nested)"
        );
    }
}
