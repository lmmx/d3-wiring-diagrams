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
- [ ] Python reference implementation + tests (laws, paper examples)
- [ ] JSON format spec + JSON Schema; examples; conformance generator
- [ ] Rust crate + tests (laws, conformance) + benchmarks
- [ ] JS core + tests (laws, conformance)
- [ ] JS layout + d3 renderer + viewer (nested view, flatten animation, Rel tables)
- [ ] Docs: README, theory ↔ code map, format, visualisation, performance
- [ ] CI workflow, Justfile
- [ ] Remove PoC files that the viewer supersedes

## Progress log

- Audit and scope written (above).
