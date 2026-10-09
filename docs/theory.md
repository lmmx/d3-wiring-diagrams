# The operad, as implemented

This page maps Spivak, *The operad of wiring diagrams: formalizing a graphical
language for databases, recursion, and plug-and-play circuits*
([arXiv:1305.0297](https://arxiv.org/abs/1305.0297)), onto the code. Names are
given as `python / rust / js` where they differ.

## Objects: typed stars (Ex. 2.1.7, 4.1.1)

A typed star `(X, τ)` is a finite set of *wires* `X` with a value type `τ(x)`
for each wire. The singly-typed operad **S** is the special case where every
wire has the same type.

- `Star` stores the wires sorted by name in **Unicode code point order**. That
  is Python's `sorted`, Rust's `str::cmp`, and `compareCodePoints` in JS.
  Plain JS `<` compares UTF-16 code units and would put `😀` before `￿`.
  Each language has a test on astral characters. Wire `k` is therefore the
  same wire in every implementation.
- Wire names are unique within a star (`duplicate_wire`). Types are opaque
  strings that name sets. Only the Rel algebra gives them values, through
  *domains* (below).

## Morphisms: cospans up to isomorphism (Ex. 2.1.7, 4.1.1)

A wiring diagram `φ: X₁, …, Xₙ → Y` is a cospan `X₁ ⊔ … ⊔ Xₙ →f C ←g Y`, where
`C` is a finite set of typed *cables* and `f`, `g` preserve types.

**Representation.** `{cables: [σ(c)], inner: [{wire: c}], outer: {wire: c}}`
holds the cable types and `f` and `g`. The type of a wire is *defined* to be
the type of its cable, so a type-incorrect cospan cannot be written down. The
only possible input error is a cable index out of range.

**Up to isomorphism.** The paper (footnote 3) identifies cospans that differ
only by renaming cables. Every constructor and operation returns the
*canonical representative*:

1. wires within each star are in code point order;
2. cables are numbered by first appearance, scanning the inner stars in order
   and then the outer star;
3. *floating* cables, soldered to no wire, come last, sorted by type.

Two cospans are isomorphic if and only if their canonical forms are
identical. An isomorphism `C ≅ C'` commuting with `f`, `g` is forced on every
cable some wire touches. The floating cables can only be matched type for
type, and sorting by type does exactly that. So `==` / `equals` and hashing
are equality of morphisms, in O(size).

**Floating cables are part of the morphism.** `C` is any finite set, so
`(∅ → {c} ← ∅)` and `(∅ → ∅ ← ∅)` are different morphisms. Composition can
create floating cables: a cable that touches only the stars being substituted
away becomes a closed loop. The implementation keeps them, and it has to, for
Rel to be functorial: a floating cable contributes `∃c ∈ σ(c)`, which is
false when `σ(c)` is empty (`test_floating_cable_of_empty_type_empties_the_result`).

## Identities and composition (Def. 2.1.2, (2.1.7))

| Constituent | Code |
| --- | --- |
| `id_X` | `WiringDiagram.identity(X)` / `WiringDiagram::identity(&x)` |
| `φ ∘ (ψ₁, …, ψₙ)` | `phi.compose([...])` |
| `φ ∘ᵢ ψ` (partial) | `phi.compose_at(i, psi)` / `composeAt` |

Composition is the pushout of `C ← ⊔Yᵢ → ⊔Cᵢ` (the paper's W-shaped diagram).
The code computes it with one **union–find** over `C ⊔ C₁ ⊔ … ⊔ Cₙ`. Each wire
`w` of each intermediate star `Yᵢ` joins the outer cable `f(i, w)` with the
inner cable `gᵢ(w)`. The equivalence classes are the cables of the composite,
and canonical relabelling finishes the job. The cost is O(N α(N)) in the
total number of wires and cables, plus sorting the floating cables.

A class only ever merges cables of one type, because both sides of every union
carry the type of the same wire. So the composite is well typed without a
check.

`compose` raises `arity_mismatch` and `star_mismatch`. A child's outer star
must equal the inner star it fills, names and types both.

`compose_at(i, ψ)` equals `compose` with identities in the other slots (a law
test), but it does not build those identities. Both go through one
`substitute` routine, in which an empty slot keeps its star. So partial
composition costs O(|φ| + |ψ|), not O(|φ|·…).

## The symmetric action (Rem. 2.1.3)

`phi.permute(σ)` returns the diagram whose inner star `k` is `phi`'s inner star
`σ[k]`. This is a **right action**: `φ.permute(s).permute(t) == φ.permute(s∘t)`
with `(s∘t)[k] = s[t[k]]`. Equivariance is tested in the form

```
φ.permute(σ) ∘ (ψ_σ(0), …, ψ_σ(n−1))  ==  (φ ∘ (ψ₀, …, ψₙ₋₁)).permute(σ̂)
```

where `σ̂` permutes the blocks of the composite's inner stars as `σ` permutes
the `ψᵢ`.

## Laws

Every implementation checks these on hundreds of random diagrams (Python:
`hypothesis`; Rust and JS: fixed seeds, so runs are reproducible):

- identity: `φ ∘ (id…) = φ = id ∘ φ`;
- associativity: `φ ∘ (ψᵢ ∘ (χᵢⱼ)) = (φ ∘ (ψᵢ)) ∘ (χᵢⱼ)`;
- equivariance, and that `permute` is an action;
- `compose_at` agrees with `compose`;
- `map_types` is an operad functor.

## Operad functors between S and T (§4.1)

Any function on type names induces an operad functor `T → T`, and
`phi.map_types(f)` / `mapTypes` applies it. Mapping every type to one name is
the forgetful `U: T → S`. On a diagram of S, mapping the single type to `A` is
`F_A: S → T`. Canonical form is recomputed, because floating cables are
ordered by type.

## Closed structure (Def. 5.1.1, Prop. 5.1.4)

| Constituent | Code |
| --- | --- |
| `[Y₁, …, Yₙ ⇒ Z] = Y₁ ⊔ … ⊔ Yₙ ⊔ Z` | `internal_hom(ys, z)` |
| `ev: [Y ⇒ Z], Y₁, …, Yₙ → Z` | `evaluation(ys, z)` |
| `extl: O(X; [Y ⇒ Z]) → O(X, Y; Z)` | `externalize(phi, ys, z)` |
| `intl`, its inverse | `internalize(psi, m)` (the first `m` inner stars stay) |

A coproduct of named sets needs fresh names. Wire `a` of `Yᵢ` becomes `"{i}.a"`
and wire `b` of `Z` becomes `"out.b"`. The text before the first `.` is a
decimal index or `out`, so the encoding is injective whatever the original
names contain. `externalize` moves the `Yᵢ` part of `g` into `f`, which is
O(size). The tests check that it equals the paper's definition
`ev ∘ (φ, id_Y₁, …)` and that `intl ∘ extl` and `extl ∘ intl` are identities.

## Algebras

An algebra is an operad functor `O → Sets`: a set for each star and a function
for each diagram. Two of the paper's algebras are implemented, and each one's
functoriality is a property test. Applying the algebra level by level equals
applying it once to the composite.

### Rel: relations (Ex. 2.2.10, Lemma 4.1.2)

`Rel(X)` is the set of finite relations on the wires of `X`. A row has one
value per wire, in canonical order. `rel.apply(φ, [R₁…Rₙ], domains)` is the
*φ-conjunction*: all `c ∘ g` over cable assignments `c` with `c ∘ f|Xᵢ ∈ Rᵢ`.

The evaluation plan, identical in the three languages:

1. *Selection.* `Rᵢ` becomes a table over the distinct cables that `Xᵢ`
   touches. Rows where two wires on one cable disagree are dropped. The
   projection is injective, so no duplicates arise.
2. *Domains.* A cable in the image of `g` that no inner wire touches is
   unconstrained. It ranges over `domains[σ(c)]` (as in Ex. 4.2.2,
   `y. ∃x. R(x)`). A floating cable empties the result if its domain is empty
   (Remark 2.2.13's "counter-intuitive" behaviour, reproduced). A type that
   needs a domain and has none is the error `missing_domain`; the code never
   assumes one silently.
3. *Joins.* Greedy hash joins. Start from the smallest table, and repeatedly
   join the table sharing the most cables with the running result (ties go to
   the smaller one). After each join, project away every cable that neither
   `g` nor a remaining table needs. A join of duplicate-free tables is
   duplicate-free, so only projection deduplicates.

The worst case is exponential in the number of stars, because conjunctive
query evaluation is NP-hard in the query. The plan is the standard practical
one: early projection keeps intermediate tables at the width of the "frontier"
cables.

**Disjunction (Prop. 4.3.1).** `Relation.union` is the join of `JRel(X)`. The
property test checks that `Rel(φ)` preserves unions in each argument.

**Recursion (§5.2, Def. 5.1.6).** `rel.close(q, ys, z)` is the closing
transformation `Rel([Y ⇒ Z]) → [Rel(Y) ⇒ Rel(Z)]`, namely `R ↦ Rel(ev)(q, R)`.
`rel.recursive(φ, Rs, z, domains)` takes a recursive setup `φ: X → [Z ⇒ Z]`
and iterates the monotone `q` downward from the full relation on `Z`. It stops
at the **greatest fixed point**, which contains every fixed point; the
iteration takes at most `|∏τ| + 1` steps. On `N ≤ 24`, the factorial setup of
Example 5.2.1 gives `{(0,1), (1,1), (2,2), (3,6), (4,24)}`. Every fixed point
lies inside this one, and it is non-empty, which matches the paper's "there is
only one". The empty relation is always a fixed point, because `q(∅) = ∅`.

**Values.** Python: any hashable, compared with `==`, so `True == 1` (stated in
the module docs). Rust: any `V: Clone + Ord + Hash`; `Scalar` is provided for
JSON. JS: JSON scalars, compared by JSON text, so `1 ≠ "1"`. The conformance
suite uses ints and strings and never mixes `bool` with `int`.

### Eq: equivalence relations (Ex. 3.1.3)

`Eq(X)` is the set of partitions of `X`'s wires. A partition is stored as a
block id per wire, numbered by first appearance, so equal partitions are equal
values. `eq.apply` merges cables whenever two wires of one inner star share a
block, then reads the partition of `Y` back through `g`. Types are ignored, so
this is an S-algebra pulled back along `U`. The test
`test_eq_connects_through_cables` reproduces the diagram `ψ` from the proof of
Proposition 3.1.4, including `Eq(ψ)(m, Δ) = Δ`.

## Terms (§2, "a wiring diagram of wiring diagrams is a wiring diagram")

`Term` is a diagram whose inner stars may be filled with sub-terms.
`evaluate()` composes the tree, and `leaf_labels()` lists the labels of the
composite's inner stars. Labels (`"NAND"`) are presentation only and live on
the term, never on `WiringDiagram`, so they cannot affect equality. The viewer
draws terms. The nested view is the paper's picture (13) before the
intermediate stars are removed; see [visualisation.md](visualisation.md).

## Not implemented

- The **directed** wiring diagram operad (Rupel–Spivak; Vagner–Spivak–Lerman)
  and its algebras of dynamical systems. It is a different operad: wires have
  a direction, and outer outputs are fed by inner outputs. 1305.0297 mentions
  it only as future work (§6.3).
- Morphisms *between* cospans, which would give the 2-categorical structure
  of §6.1, and topological wiring diagrams (§6.3). The paper only names these.
