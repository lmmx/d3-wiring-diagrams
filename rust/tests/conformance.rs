//! Run the shared conformance suite (`spec/conformance`) through the Rust API.

use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;

use serde_json::{Value, json};
use wiring_diagrams::closed::{evaluation, externalize, internal_hom, internalize};
use wiring_diagrams::eq::{self, Partition};
use wiring_diagrams::rel::{self, Relation};
use wiring_diagrams::{Error, Label, Result, Scalar, Star, WiringDiagram};

fn spec(path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../spec")
        .join(path)
}

fn cases(family: &str) -> Vec<Value> {
    let text = std::fs::read_to_string(spec(&format!("conformance/{family}.json"))).unwrap();
    let data: Value = serde_json::from_str(&text).unwrap();
    data["cases"].as_array().unwrap().clone()
}

fn d(v: &Value) -> Result<WiringDiagram> {
    WiringDiagram::from_json_value(v.clone())
}

fn s(v: &Value) -> Result<Star> {
    Star::from_json_value(v.clone())
}

fn stars(v: &Value) -> Result<Vec<Star>> {
    v.as_array().unwrap().iter().map(s).collect()
}

fn usizes(v: &Value) -> Vec<usize> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_u64().unwrap() as usize)
        .collect()
}

/// Run every case of a family; compare `expected` (after `normalise`) or the error kind.
fn check(family: &str, run: impl Fn(&Value) -> Result<Value>, normalise: impl Fn(Value) -> Value) {
    let all = cases(family);
    assert!(!all.is_empty(), "no cases in {family}");
    for (i, case) in all.iter().enumerate() {
        let got = run(case);
        match (case.get("expected"), case.get("error")) {
            (Some(expected), None) => {
                let got = got.unwrap_or_else(|e| panic!("{family}[{i}]: unexpected error {e}"));
                assert_eq!(normalise(got), normalise(expected.clone()), "{family}[{i}]");
            }
            (None, Some(kind)) => {
                let err: Error = got.expect_err(&format!("{family}[{i}]: expected {kind}"));
                assert_eq!(
                    err.kind().as_str(),
                    kind.as_str().unwrap(),
                    "{family}[{i}]: {err}"
                );
            }
            _ => panic!("{family}[{i}]: a case has exactly one of expected / error"),
        }
    }
}

fn same(v: Value) -> Value {
    v
}

#[test]
fn stars_are_sorted_by_code_point() {
    check(
        "stars",
        |c| {
            Ok(json!(
                s(&c["wires"])?
                    .names()
                    .iter()
                    .map(|n| &**n)
                    .collect::<Vec<_>>()
            ))
        },
        same,
    );
}

#[test]
fn canonical_form() {
    check("canonical", |c| Ok(d(&c["input"])?.to_json_value()), same);
}

#[test]
fn identity() {
    check(
        "identity",
        |c| Ok(WiringDiagram::identity(&s(&c["star"])?).to_json_value()),
        same,
    );
}

#[test]
fn compose() {
    check(
        "compose",
        |c| {
            let kids = c["children"]
                .as_array()
                .unwrap()
                .iter()
                .map(d)
                .collect::<Result<Vec<_>>>()?;
            Ok(d(&c["diagram"])?.compose(&kids)?.to_json_value())
        },
        same,
    );
}

#[test]
fn permute() {
    check(
        "permute",
        |c| {
            Ok(d(&c["diagram"])?
                .permute(&usizes(&c["sigma"]))?
                .to_json_value())
        },
        same,
    );
}

#[test]
fn map_types() {
    check(
        "map_types",
        |c| {
            let mapping: HashMap<String, String> =
                serde_json::from_value(c["mapping"].clone()).unwrap();
            Ok(d(&c["diagram"])?
                .map_types(|t| Label::from(mapping[t].as_str()))
                .to_json_value())
        },
        same,
    );
}

#[test]
fn closed_structure() {
    check(
        "closed",
        |c| match c["op"].as_str().unwrap() {
            "internal_hom" => Ok(json!(internal_hom(&stars(&c["ys"])?, &s(&c["z"])?))),
            "evaluation" => Ok(evaluation(&stars(&c["ys"])?, &s(&c["z"])?).to_json_value()),
            "internalize" => {
                let m = c["m"].as_u64().unwrap() as usize;
                Ok(internalize(&d(&c["diagram"])?, m)?.to_json_value())
            }
            "externalize" => Ok(
                externalize(&d(&c["diagram"])?, &stars(&c["ys"])?, &s(&c["z"])?)?.to_json_value(),
            ),
            op => panic!("unknown op {op}"),
        },
        same,
    );
}

/// Relations are sets: compare rows order-insensitively.
#[allow(clippy::needless_pass_by_value)] // shares a signature with `same`
fn rows_as_set(v: Value) -> Value {
    let rows: BTreeSet<String> = v["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(Value::to_string)
        .collect();
    json!({"wires": v["wires"], "rows": rows})
}

#[test]
fn rel_algebra() {
    check(
        "rel",
        |c| {
            let phi = d(&c["diagram"])?;
            let domains: rel::Domains<Scalar> =
                serde_json::from_value(c["domains"].clone()).unwrap();
            let given = c["relations"].as_array().unwrap();
            if given.len() != phi.arity() {
                // arity is checked before the stars of the arguments are known
                return rel::apply(&phi, &[], &domains).map(|r| json!(r));
            }
            let rs = phi
                .inner()
                .iter()
                .zip(given)
                .map(|(x, r)| Relation::<Scalar>::from_json_value(x.clone(), r.clone()))
                .collect::<Result<Vec<_>>>()?;
            Ok(json!(rel::apply(&phi, &rs, &domains)?))
        },
        rows_as_set,
    );
}

#[test]
fn eq_algebra() {
    check(
        "eq",
        |c| {
            let phi = d(&c["diagram"])?;
            let ps = phi
                .inner()
                .iter()
                .zip(c["partitions"].as_array().unwrap())
                .map(|(x, p)| Partition::from_json_value(x.clone(), p))
                .collect::<Result<Vec<_>>>()?;
            Ok(json!(eq::apply(&phi, &ps)?.blocks()))
        },
        same,
    );
}
