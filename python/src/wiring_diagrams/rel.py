"""The relational algebra Rel (Spivak, Example 2.2.10, Lemma 4.1.2, §4.3, §5.2).

``Rel(X)`` is the set of relations ``R ⊆ ∏_{x ∈ X} τ(x)``. Given
``φ = (⊔Xᵢ →f C ←g Y)``, ``Rel(φ)(R₁, …, Rₙ)`` is the *φ-conjunction*: the set of
``c ∘ g`` over all cable assignments ``c ∈ ∏_C σ`` with ``c ∘ f|Xᵢ ∈ Rᵢ`` for every
``i``. In database terms it is a conjunctive query. The ``Rᵢ`` are tables, the
cables are join variables, and ``g`` is the SELECT list.

Evaluation plan:

1. Each ``Rᵢ`` becomes a table over the cables it touches. When two wires of
   ``Xᵢ`` share a cable, only the rows where they agree are kept.
2. A cable in the image of ``g`` that no inner wire touches ranges over its
   declared domain. A floating cable is a pure existential: the result is empty
   if its domain is empty.
3. Tables are hash-joined greedily. The next table is the one sharing the most
   cables with the running result (ties go to the smaller table). After each
   join, cables that neither ``g`` nor any remaining table needs are projected
   away.

Values only need to be hashable and are compared with ``==``. So ``True == 1``
in Python: values of different Python types that compare equal are merged.
"""

from __future__ import annotations

import itertools
from collections.abc import (
    Callable,
    Collection,
    Hashable,
    Iterable,
    Iterator,
    Mapping,
    Sequence,
)
from typing import Any

from .closed import evaluation, internal_hom
from .diagram import WiringDiagram
from .errors import WiringError
from .star import Star

__all__ = ["Domains", "Relation", "apply", "close", "recursive"]

Row = tuple[Hashable, ...]
Domains = Mapping[str, Collection[Hashable]]


class Relation:
    """A finite relation on a star: a set of rows, one value per wire in canonical order."""

    __slots__ = ("rows", "star")

    star: Star
    rows: frozenset[Row]

    def __init__(self, star: Star, rows: Iterable[Sequence[Hashable]]) -> None:
        frozen = frozenset(tuple(r) for r in rows)
        for r in frozen:
            if len(r) != len(star):
                raise WiringError(
                    "relation_arity",
                    f"row {r!r} has {len(r)} values, star has {len(star)} wires",
                )
        self.star = star
        self.rows = frozen

    @classmethod
    def from_records(cls, star: Star, records: Iterable[Mapping[str, Hashable]]) -> Relation:
        """Build from ``{wire: value}`` records. Every record must name every wire."""
        rows = []
        for rec in records:
            if set(rec) != set(star.names):
                raise WiringError(
                    "relation_arity",
                    f"record {dict(rec)!r} does not match wires {star.names}",
                )
            rows.append(tuple(rec[n] for n in star.names))
        return cls(star, rows)

    @classmethod
    def from_predicate(
        cls, star: Star, domains: Domains, predicate: Callable[[dict[str, Any]], bool]
    ) -> Relation:
        """All rows of ``∏ τ(x)`` (over the declared domains) satisfying ``predicate``."""
        doms = [_domain(domains, t) for t in star.types]
        rows = []
        for values in itertools.product(*doms):
            if predicate(dict(zip(star.names, values, strict=True))):
                rows.append(values)
        return cls(star, rows)

    @classmethod
    def full(cls, star: Star, domains: Domains) -> Relation:
        return cls(star, itertools.product(*(_domain(domains, t) for t in star.types)))

    def records(self) -> list[dict[str, Hashable]]:
        return [dict(zip(self.star.names, r, strict=True)) for r in self.rows]

    def to_json(self) -> dict[str, Any]:
        """``{"wires": [...], "rows": [[...], ...]}`` with rows in a fixed order.

        JSON scalars are ordered booleans < numbers < strings < null, then by value.
        Any other Python value has no JSON form.
        """
        return {"wires": list(self.star.names), "rows": sorted(map(list, self.rows), key=_row_key)}

    @classmethod
    def from_json(cls, star: Star, data: Any) -> Relation:
        if not isinstance(data, dict) or set(data) != {"wires", "rows"}:
            raise WiringError("invalid_json", "a relation is {wires: [name], rows: [[value]]}")
        if data["wires"] != list(star.names):
            raise WiringError(
                "star_mismatch", f"relation on wires {data['wires']!r}, expected {star.names!r}"
            )
        if not isinstance(data["rows"], list) or not all(isinstance(r, list) for r in data["rows"]):
            raise WiringError("invalid_json", "rows must be a list of lists")
        return cls(star, data["rows"])

    def union(self, other: Relation) -> Relation:
        """Join in the semilattice ``JRel(X)`` (Spivak, Proposition 4.3.1)."""
        if other.star != self.star:
            raise WiringError("star_mismatch", f"{self.star!r} vs {other.star!r}")
        return Relation(self.star, self.rows | other.rows)

    __or__ = union

    def __len__(self) -> int:
        return len(self.rows)

    def __iter__(self) -> Iterator[Row]:
        return iter(self.rows)

    def __contains__(self, row: object) -> bool:
        return row in self.rows

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Relation):
            return NotImplemented
        return self.star == other.star and self.rows == other.rows

    def __hash__(self) -> int:
        return hash((self.star, self.rows))

    def __repr__(self) -> str:
        return f"Relation({self.star!r}, {len(self.rows)} rows)"


def _row_key(row: list[Any]) -> list[tuple[int, Any]]:
    rank = {bool: 0, int: 1, float: 1, str: 2, type(None): 3}
    return [(rank[type(v)], 0 if v is None else v) for v in row]


def _domain(domains: Domains | None, typ: str) -> Collection[Hashable]:
    if domains is None or typ not in domains:
        raise WiringError("missing_domain", f"no finite domain declared for type {typ!r}")
    return domains[typ]


Table = tuple[tuple[int, ...], set[Row]]


def apply(
    phi: WiringDiagram, relations: Sequence[Relation], domains: Domains | None = None
) -> Relation:
    """``Rel(φ)(R₁, …, Rₙ)``, the φ-conjunction of the relations."""
    if len(relations) != phi.arity:
        raise WiringError(
            "arity_mismatch",
            f"diagram has {phi.arity} inner stars, got {len(relations)} relations",
        )
    tables: list[Table] = []
    constrained: set[int] = set()
    for i, rel in enumerate(relations):
        if rel.star != phi.inner[i]:
            raise WiringError(
                "star_mismatch",
                f"relation {i} is on {rel.star!r}, expected {phi.inner[i]!r}",
            )
        tables.append(_select(phi.inner_cables[i], rel.rows))
        constrained.update(phi.inner_cables[i])

    outer = phi.outer_cables
    for c in dict.fromkeys(outer):
        if c not in constrained:
            tables.append(((c,), {(v,) for v in _domain(domains, phi.cables[c])}))
            constrained.add(c)
    for c in range(len(phi.cables)):
        if c not in constrained and not _domain(domains, phi.cables[c]):
            return Relation(phi.outer, ())

    cols, rows = _join_all(tables, set(outer))
    pos = {c: j for j, c in enumerate(cols)}
    return Relation(phi.outer, {tuple(r[pos[c]] for c in outer) for r in rows})


def _select(wiring: Sequence[int], rows: Iterable[Row]) -> Table:
    """Turn a relation on ``Xᵢ`` into a table over its distinct cables."""
    first: dict[int, int] = {}
    checks: list[tuple[int, int]] = []
    for w, c in enumerate(wiring):
        if c in first:
            checks.append((w, first[c]))
        else:
            first[c] = w
    reps = tuple(first.values())
    out = {tuple(r[w] for w in reps) for r in rows if all(r[a] == r[b] for a, b in checks)}
    return tuple(first), out


def _join_all(tables: list[Table], keep: set[int]) -> Table:
    remaining = sorted(tables, key=lambda t: len(t[1]))
    cur: Table = ((), {()})
    while remaining:
        if not cur[1]:
            return cur
        have = set(cur[0])
        best = max(
            range(len(remaining)),
            key=lambda j: (
                len(have.intersection(remaining[j][0])),
                -len(remaining[j][1]),
                -j,
            ),
        )
        cur = _hash_join(cur, remaining.pop(best))
        needed = keep.union(*(t[0] for t in remaining))
        cur = _project(cur, needed)
    return cur


def _hash_join(a: Table, b: Table) -> Table:
    a_cols, a_rows = a
    b_cols, b_rows = b
    b_pos = {c: j for j, c in enumerate(b_cols)}
    shared = [c for c in a_cols if c in b_pos]
    a_key = [a_cols.index(c) for c in shared]
    b_key = [b_pos[c] for c in shared]
    shared_set = set(shared)
    b_rest = [j for j, c in enumerate(b_cols) if c not in shared_set]
    index: dict[Row, list[Row]] = {}
    for r in b_rows:
        index.setdefault(tuple(r[j] for j in b_key), []).append(tuple(r[j] for j in b_rest))
    rows = set()
    for r in a_rows:
        for tail in index.get(tuple(r[j] for j in a_key), ()):
            rows.add(r + tail)
    return a_cols + tuple(b_cols[j] for j in b_rest), rows


def _project(t: Table, needed: set[int]) -> Table:
    cols, rows = t
    keep = [j for j, c in enumerate(cols) if c in needed]
    if len(keep) == len(cols):
        return t
    return tuple(cols[j] for j in keep), {tuple(r[j] for j in keep) for r in rows}


def close(
    q: Relation, ys: Sequence[Star], z: Star, domains: Domains | None = None
) -> Callable[[Sequence[Relation]], Relation]:
    """The closing transformation ``Rel([Y ⇒ Z]) → [Rel(Y) ⇒ Rel(Z)]`` (Definition 5.1.6).

    It turns a relation on the internal hom into a function on relations:
    ``close(q, ys, z)(R₁, …, Rₙ) = Rel(ev)(q, R₁, …, Rₙ)``.
    """
    ev = evaluation(ys, z)
    if q.star != ev.inner[0]:
        raise WiringError("hom_mismatch", f"{q.star!r} is not [Y ⇒ Z]")
    return lambda rs: apply(ev, [q, *rs], domains)


def recursive(
    phi: WiringDiagram, relations: Sequence[Relation], z: Star, domains: Domains
) -> Relation:
    """The greatest recursive relation of a recursive setup (Spivak, §5.2).

    ``phi: X₁, …, Xₙ → [Z ⇒ Z]`` together with ``relations`` fills the slot to
    give a function ``q: Rel(Z) → Rel(Z)``. ``q`` is monotone and ``Rel(Z)`` is
    finite over the declared domains. Iterating ``q`` down from the full relation
    therefore reaches the greatest fixed point in at most ``|∏ τ| + 1`` steps.
    Every fixed point is contained in it. If it is empty, no non-empty recursive
    relation exists.
    """
    hom = internal_hom([z], z)
    if phi.outer != hom:
        raise WiringError("hom_mismatch", f"outer star {phi.outer!r} is not [Z ⇒ Z] = {hom!r}")
    q = close(apply(phi, relations, domains), [z], z, domains)
    current = Relation.full(z, domains)
    while True:
        nxt = q([current])
        if nxt == current:
            return current
        current = nxt
