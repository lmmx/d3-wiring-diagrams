# 2026-10-08: The operad of wiring diagrams, end to end

## Starting point (audit of the proof of concept)

The repository at `f082f7a` held a single-page d3 sketch:

| File | What it did |
| --- | --- |
| `wiring-diagram.js` | `d3.pack()` circle packing of a hard-coded tree (`module.py` → `Foo` → methods), zoom/pan, label sizing heuristics |
| `wd_sample_data.json` | the same tree as JSON (a fallback copy was also inlined as a string in the JS) |
| `d3-wiring-diagram.html` | page shell; the `<script>` tag contains an HTML comment *inside the tag*, so the markup is malformed |
| `d3.v7.min.js` | vendored d3 v7.6.1 |

Problems with it as a basis for "the operad of wiring diagrams":

- No wires and no cables: it drew a containment hierarchy, not a wiring diagram.
- There was no data model for morphisms, no composition, no algebra. The nesting was a `d3.hierarchy`, which is a tree and not an operad term.
- Implicit globals (`x`, `y`, `xAxis`, `text_bbox`, `factor`, `diameter`, ...) were assigned without declaration.
- Layout depended on `getBBox()` measurements fed back through `data-*` attributes, with hand-tuned "magic" offsets (`label_y_offset` is commented as "guessed based on performance").
- Invisible debug axes were rendered at opacity 0.
- There were no tests, no docs and no packaging.

The circle motif is right, though: Spivak draws stars as circles. The new renderer keeps it.

## What "the operad of wiring diagrams" means here

The reference is Spivak, *The operad of wiring diagrams: formalizing a graphical
language for databases, recursion, and plug-and-play circuits* (arXiv:1305.0297).
Everything in the paper that is constructive is in scope:

| Paper | Constituent | Implemented as |
| --- | --- | --- |
| Ex. 2.1.7 / 4.1.1 | objects: (typed) stars, i.e. a finite set of wires with `τ: X → Types` | `Star` |
| Ex. 2.1.7 / 4.1.1 | morphisms: cospans `⊔Xᵢ →f C ←g Y` over `Types`, **up to isomorphism of C** | `WiringDiagram`, kept in a canonical form so that `==` is equality of morphisms |
| Def. 2.1.2 C | identities | `WiringDiagram.identity(X)` |
| Def. 2.1.2 D | composition by pushout | `compose` (full) and `compose_at` (partial, `∘ᵢ`) |
| Rem. 2.1.3 | symmetric group action on inner stars | `permute` |
| Def. 2.1.2 laws | identity, associativity (+ equivariance) | property tests in every language |
| §4.1 | functors `U: T → S`, `F_A: S → T` | `map_types` (any function on type names induces an operad functor) |
| Ex. 2.2.10 / Lemma 4.1.2 | algebra **Rel** (φ-conjunction: pull back, join, take the image) | `rel.apply` |
| Prop. 4.3.1 | Rel as a JLat-algebra (disjunctive queries) | `Relation.union` + a test that `Rel(φ)` preserves unions in each argument |
| Ex. 3.1.3 | algebra **Eq** of equivalence relations | `eq.apply` |
| §5.1 | closed structure: `[Y ⇒ Z]`, `ev`, `extl`/`intl` | `internal_hom`, `evaluation`, `externalize`, `internalize` |
| Def. 5.1.6, §5.2 | closing transformation, recursion as a fixed point | `rel.close`, `rel.recursive` (greatest fixed point, Ex. 5.2.1 factorial) |
| Ex. 2.2.11, 2.2.12, 4.2.1, 4.2.2 | NOT from NAND, the three queries, the SQL query, `∃x.R(x)` | `spec/examples/*.json`, used as tests and in the viewer |

Out of scope, and recorded under _Missing_ below: the *directed* wiring diagram
operad (Rupel–Spivak, Vagner–Spivak–Lerman) and its dynamical-system algebras.
That is a different operad. The paper names it only as future work (§6.3).

## Decisions

1. **One representation, three native implementations (Python, Rust, JS).**
   The core is a few hundred lines per language, and each ecosystem gets a
   dependency-free package. The JS core has to be native anyway, because the
   renderer runs in the browser. A shared JSON format (`spec/`) and a shared
   conformance suite keep the three in lockstep. The Python implementation
   generates the conformance cases; Rust and JS must reproduce them exactly.
   Each language also checks the operad laws independently.
2. **Wire types are derived, never stored twice.** A diagram is
   `{cables: [type...], inner: [{wire: cable}...], outer: {wire: cable}}`.
   The type of a wire is the type of its cable, so a type-incorrect cospan
   cannot be written down. The only thing left to validate is the index range.
3. **Canonical form = equality up to isomorphism.** Wires within a star are
   ordered by name (Unicode code point order in all three languages). Cables are
   numbered by first appearance when scanning the inner stars and then the outer
   star. Cables soldered to nothing ("floating cables") come last, sorted by
   type. Two cospans are isomorphic exactly when their canonical forms are
   identical, so equality and hashing are structural and O(size).
4. **Floating cables are kept.** A pushout can close a cable off (it touches only
   intermediate stars). Dropping it would be wrong: in Rel, a floating cable
   contributes `∃c: σ(c)`, which is false for an empty type.
5. **Composition is a union–find over `C ⊔ ⊔Cᵢ`.** One union per intermediate
   wire, then a canonical relabel: O(N α(N)) plus a sort of the floating cables.
6. **Rel is a join engine.** Each argument relation is selected on repeated
   cables, projected to its cable set, then hash-joined in greedy order with
   early projection of cables that nothing downstream needs. Output-only
   cables range over a declared finite domain. A missing domain is an error,
   not a silent assumption.
7. **Presentation is separate from mathematics.** Labels for stars ("NAND")
   live in an operad *term* (a tree of diagrams), not in `WiringDiagram`. They
   never affect equality.
8. **Layout is deterministic.** No `Math.random` and no timers in layout. The
   same diagram always produces the same picture. Layout is pure JS with no
   DOM, so it is tested in Node. Rendering takes `d3` as an explicit argument
   instead of reading a global.

## Plan

- [x] Audit the PoC; read the paper; fix scope (this file)
- [x] Python reference implementation + tests (laws, paper examples)
- [x] JSON format spec + JSON Schema; examples; conformance generator
- [x] Rust crate + tests (laws, conformance) + benchmarks
- [x] JS core + tests (laws, conformance)
- [x] JS layout + d3 renderer + viewer (nested view, flatten animation, Rel tables)
- [x] Docs: README, theory ↔ code map, format, visualisation, performance
- [x] CI workflow, Justfile
- [x] Remove PoC files that the viewer supersedes

## Progress log

1. **Paper first.** The reference is the *undirected* (cospan) operad, not the
   directed one I had half-remembered from Vagner–Spivak–Lerman. Its objects
   are sets of wires, so wire order carries no information, and that is what
   lets the layout choose where each port goes. Morphisms are cospans *up to
   isomorphism*, which is what forces a canonical form.
2. **Python reference.** Canonical form, union–find composition, `permute`,
   `map_types`, closed structure, Rel (join engine), Eq, terms, and the
   paper's examples as code (`examples.py`). Hypothesis caught one wrong
   expectation in my own test: `Eq(ψ)(m, Δ)` is `Δ`, exactly as in the proof
   of Prop. 3.1.4. The test was fixed to assert what the paper says.
3. **Shared spec.** `scripts/generate.py` writes the examples and 868
   conformance cases. Random cases use only `Random.random()`, so they
   reproduce across CPython versions.
4. **Rust.** The conformance suite found a real bug on the first run. When a
   Rel join emptied early, the output columns were read from a table that never
   had them. Python survived it only because a comprehension over zero rows
   never evaluates its body. Both now return the empty relation explicitly.
5. **Benchmarks** exposed three costs, all fixed in all languages where they
   applied:
   - `compose_at` built `n − 1` identity diagrams;
   - Rust parsed JSON through a `Value` DOM and allocated per-star error
     strings;
   - the Rust hash join allocated per probe.
   See [performance.md](../performance.md).
6. **JS.** The core passed the conformance suite unchanged on the first run.
   `tsc --checkJs --strict` then forced the diagram fields to be declared and
   definitely assigned, which removed a private installer method.
7. **Visualisation.** Layout is pure and deterministic. In the nested view each
   child is laid out with its outer wires pinned to its parent's port angles,
   so wires pass straight through the intermediate circles. In the nested
   scene, union–find gives every cable its pushout class. The number of
   classes equals the composite's cable count: a test on all examples and on
   150 random terms. Screenshots with Playwright found:
   - intermediate stars too small (radii could shrink but not grow);
   - labels colliding;
   - junctions landing on star rims;
   - intermediate stars not clickable;
   - `Math.hypot` dominating layout time (5–7× slower).
8. **Predictability.** Python `Relation.records()` iterated a frozenset of
   strings, so its order depended on `PYTHONHASHSEED`. It now follows a total
   order over all values.

## Current State

- Python, Rust and JS each implement typed stars, canonical cospans, identity, full and partial composition, permutation and type relabelling (python/src/wiring_diagrams/diagram.py:146-264, rust/src/diagram.rs:167-312, js/src/diagram.js)
- Composition in all three implementations runs through one substitute routine in which an empty slot keeps its inner star (python/src/wiring_diagrams/diagram.py:182, rust/src/diagram.rs:206, js/src/diagram.js `#substitute`)
- Canonical relabelling numbers cables by first appearance and sorts floating cables by type (python/src/wiring_diagrams/diagram.py:358, rust/src/diagram.rs:418)
- Internal hom, evaluation, externalize and internalize name coproduct wires `"{i}.{name}"` and `"out.{name}"` (python/src/wiring_diagrams/closed.py, rust/src/closed.rs, js/src/closed.js)
- Rel evaluates φ-conjunctions by selection, greedy hash joins and early projection, and raises `missing_domain` for an unconstrained cable whose type has no domain (python/src/wiring_diagrams/rel.py:181-232, rust/src/rel.rs, js/src/rel.js)
- `rel.recursive` returns the greatest fixed point of the closing transformation, iterating down from the full relation (python/src/wiring_diagrams/rel.py:294, rust/src/rel.rs, js/src/rel.js)
- Eq computes the induced partition of the outer star with union–find (python/src/wiring_diagrams/eq.py, rust/src/eq.rs, js/src/eq.js)
- `scripts/generate.py` writes 9 example files and 868 conformance cases under spec/, and python/tests/test_conformance.py fails when those files differ from a fresh generation
- The Python, Rust and JS test suites each run all 868 conformance cases and all 9 examples (python/tests/test_conformance.py, rust/tests/conformance.rs, rust/tests/examples.rs, js/test/conformance.test.js, js/test/examples.test.js)
- Identity, associativity, equivariance, the permutation action, partial composition, `map_types` functoriality, the closed-structure bijection, and Rel and Eq functoriality are property tests in each language (python/tests/test_operad.py, python/tests/test_algebras.py, rust/tests/laws.rs, js/test/laws.test.js)
- Every file under spec/examples and every parseable conformance diagram validates against spec/schema/wiring-diagrams.schema.json (python/tests/test_schema.py)
- `layout` places inner stars by a 240-iteration spring embedding with pairwise overlap resolution and containment, and places ports by `assignSlots` (js/src/layout.js:54, js/src/layout.js:135, js/src/layout.js:251)
- `buildScene` emits keyed primitives for nested or composed views and assigns each nested cable its pushout class through the `Groups` union–find (js/src/scene.js:47, js/src/scene.js:119, js/src/scene.js:204)
- `createRenderer` takes `d3` as an argument and joins scene primitives by key, animating the nested ↔ composed switch (js/src/render.js:35)
- viewer/ loads spec/examples, shows the relation of a clicked star, shows the factorial fixed-point iteration, and opens JSON files; d3 7.6.1 is vendored at viewer/vendor/d3.v7.6.1.min.js
- `just` runs ruff, mypy --strict, pytest, rustfmt, clippy pedantic with -D warnings (with and without serde), cargo test (with and without serde), tsc --checkJs --strict, and node --test (Justfile); .github/workflows/ci.yml runs the same steps
- The PoC files wiring-diagram.js, d3-wiring-diagram.html, wd-style.css and wd_sample_data.json are deleted

## Missing

- The directed wiring diagram operad and its dynamical-system algebras have no code (docs/theory.md, "Not implemented")
- Morphisms between cospans (the 2-categorical structure of the paper's §6.1) have no code
- No browser test runs in CI — viewer/ was checked with Playwright screenshots during development only
- The repository has no LICENSE file, and python/pyproject.toml, rust/Cargo.toml and js/package.json declare no license
- None of the three packages is published to PyPI, crates.io or npm
- `WiringDiagram::from_json` in Rust allocates one `String` per wire name before interning (rust/src/json.rs:164)

## Divergence

- None found: the README's claims (implemented constituents, 868 conformance cases, code snippets, viewer features, `just` steps) were checked against the code on 2026-10-08
