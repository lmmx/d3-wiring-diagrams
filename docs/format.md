# Interchange format

Python, Rust and JS read and write the same JSON. The machine-readable
version is [`spec/schema/wiring-diagrams.schema.json`](../spec/schema/wiring-diagrams.schema.json)
(JSON Schema 2020-12). The Python tests validate every file under `spec/`
against it.

## Star

```json
{"A": "Bool", "B": "Bool", "out": "Bool"}
```

Wire name → type name. Key order has no meaning. Implementations sort wires
by Unicode code point.

## Wiring diagram

```json
{
  "cables": ["Bool", "Bool"],
  "inner": [{"A": 0, "B": 0, "out": 1}],
  "outer": {"in": 0, "out": 1}
}
```

`cables[c]` is the type of cable `c`. `inner[i]` maps each wire of the `i`-th
inner star to its cable (`f`), and `outer` does the same for the outer star
(`g`). The stars' types are derived from the cables. This example is NOT
built from NAND (Spivak, Ex. 2.2.11): both NAND inputs are soldered onto
cable 0.

All three implementations write the **canonical form** (see
[theory.md](theory.md#morphisms-cospans-up-to-isomorphism-ex-217-411)), so
equal morphisms serialise identically up to object key order. Input need not
be canonical.

## Term

```json
{
  "diagram": { ... },
  "children": [null, { "diagram": { ... }, "labels": ["NAND"] }],
  "labels": ["NAND", "NOT"],
  "label": "AND"
}
```

`children[i]` fills inner star `i` (`null` leaves it open). Its diagram's
outer star must equal that inner star. `labels` and `label` are optional and
presentation only.

## Relation, domains, partition

```json
{"wires": ["A", "B", "out"], "rows": [[false, false, true], [false, true, true]]}
```

`wires` must be the star's wire names in canonical order. Rows are sets, so
order and duplicates do not matter. Values are JSON scalars: strings, integers,
booleans, `null`. Domains map a type to its finite list of values,
`{"Bool": [false, true]}`. A partition is a list of non-negative block ids,
one per wire in canonical order, `[0, 0, 1]`.

## Example file (`spec/examples/*.json`)

`{title, source, description, term, algebra?}`. Here `algebra` is
`{kind: "rel" | "rel_recursive", domains, relations, expected}`, with one
relation per leaf of `term`, in order. For `rel_recursive`, `term` evaluates to
`φ: X → [Z ⇒ Z]` and `expected` is the greatest recursive relation on `Z`.

## Errors

Every failure has a `kind` shared by the three implementations:

| kind | when |
| --- | --- |
| `invalid_json` | input does not have the shape above (wrong types, unknown or missing keys, non-integer or boolean cable index) |
| `cable_out_of_range` | a cable index is negative or `>= len(cables)` |
| `duplicate_wire` | a wire name repeats within one star (programmatic input; JSON objects cannot express it) |
| `arity_mismatch` | wrong number of children / relations / partitions, or `compose_at` index out of range |
| `star_mismatch` | a child's outer star (or an argument's star) differs from the star it fills |
| `not_a_permutation` | `permute` given anything but a permutation of `0..n-1` |
| `hom_mismatch` | `externalize` / `rel.close` / `rel.recursive` given a star that is not the expected `[Y ⇒ Z]` |
| `split_out_of_range` | `internalize(psi, m)` with `m > arity` |
| `relation_arity` | a relation row of the wrong length |
| `missing_domain` | Rel must enumerate a type (output-only or floating cable) with no declared domain |
| `invalid_partition` | a partition with the wrong length or a negative block id |

Python raises `WiringError` (a `ValueError`) with `.kind`. Rust returns
`Error` with `.kind()` (an `ErrorKind`; `.as_str()` gives the name above). JS
throws `WiringError` with `.kind`.

## Conformance suite (`spec/conformance/*.json`)

`scripts/generate.py` writes 868 cases from the Python implementation,
one per line: `{..., "expected": ...}` or `{..., "error": kind}`. They come in
nine families: `stars`, `canonical`, `identity`, `compose`, `permute`,
`map_types`, `closed`, `rel` and `eq`. The random cases use only
`random.Random.random()`, whose output CPython keeps stable across versions,
so the files are byte-for-byte reproducible. `pytest` fails if they are stale.
The error cases are written by hand, so the Python suite also runs every case
through the public API, as the Rust (`rust/tests/conformance.rs`) and JS
(`js/test/conformance.test.js`) suites do.
