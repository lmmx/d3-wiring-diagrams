"""The closed structure and the algebras Rel and Eq: paper examples and laws."""

from __future__ import annotations

import itertools

import pytest
from hypothesis import given
from hypothesis import strategies as st

from wiring_diagrams import (
    Star,
    WiringDiagram,
    WiringError,
    eq,
    evaluation,
    examples,
    externalize,
    internal_hom,
    internalize,
    rel,
)
from wiring_diagrams.rel import Relation

from .strategies import DOMAINS, diagrams, stars, two_level

Id = WiringDiagram.identity


# -- closed structure (Spivak, §5.1) -----------------------------------------------


@given(diagrams(max_arity=4), st.data())
def test_internalize_and_externalize_are_inverse(phi: WiringDiagram, data: st.DataObject) -> None:
    m = data.draw(st.integers(0, phi.arity))
    ys, z = list(phi.inner[m:]), phi.outer
    curried = internalize(phi, m)
    assert curried.outer == internal_hom(ys, z)
    assert externalize(curried, ys, z) == phi
    assert internalize(externalize(curried, ys, z), m) == curried


@given(diagrams(max_arity=4), st.data())
def test_externalization_is_composition_with_evaluation(
    phi: WiringDiagram, data: st.DataObject
) -> None:
    m = data.draw(st.integers(0, phi.arity))
    ys, z = list(phi.inner[m:]), phi.outer
    curried = internalize(phi, m)
    via_ev = evaluation(ys, z).compose([curried, *(Id(y) for y in ys)])
    assert via_ev == externalize(curried, ys, z)


def test_externalize_checks_the_outer_star() -> None:
    with pytest.raises(WiringError) as e:
        externalize(Id(Star({"a": "A"})), [], Star({"b": "A"}))
    assert e.value.kind == "hom_mismatch"
    with pytest.raises(WiringError) as e:
        internalize(Id(Star({"a": "A"})), 2)
    assert e.value.kind == "split_out_of_range"


# -- Rel on the paper's examples ---------------------------------------------------


def rows(r: Relation) -> set[tuple[object, ...]]:
    return set(r.rows)


def test_not_from_nand() -> None:
    ex = examples.not_from_nand()
    out = ex.expected()
    assert out is not None
    assert out.records() and {(r["in"], r["out"]) for r in out.records()} == {
        (False, True),
        (True, False),
    }


def test_half_adder_nested_equals_flat() -> None:
    ex = examples.half_adder()
    out = ex.expected()
    assert out is not None
    table = {(r["a"], r["b"]): (r["sum"], r["carry"]) for r in out.records()}
    assert table == {(a, b): (a != b, a and b) for a in (False, True) for b in (False, True)}
    assert len(out) == 4
    # evaluate level by level instead: Rel(φ)(Rel(ψ₁)(…), Rel(ψ₂)(…))
    term = ex.term
    xor, and_ = (kid.evaluate() for kid in term.children if kid is not None)
    nand = ex.relations[0] if ex.relations else None
    assert nand is not None
    stepwise = rel.apply(
        term.diagram,
        [
            rel.apply(xor, [nand] * xor.arity, ex.domains),
            rel.apply(and_, [nand] * and_.arity, ex.domains),
        ],
        ex.domains,
    )
    assert stepwise == out


def test_three_queries() -> None:
    nine = examples.query_product_nine().expected()
    assert nine is not None and rows(nine) == {(1, 9), (3, 3), (9, 1)}
    proj = examples.query_projection().expected()
    assert proj is not None
    assert rows(proj) == {
        (x, z) for x in range(10) for z in range(10) if any(x * y == z for y in range(10))
    }
    sq = examples.query_squares().expected()
    assert sq is not None and rows(sq) == {(0,), (1,), (4,), (9,)}


def test_sql_query() -> None:
    out = examples.sql_query().expected()
    assert out is not None
    # bob (male) shares logic with ada and dee (female); cy (male) shares music with dee
    assert sorted((r["student"], r["address"]) for r in out.records()) == [
        ("bob", "2 Oak Ave"),
        ("cy", "3 Pine Rd"),
    ]


def test_exists_is_not_conjunctive() -> None:
    ex = examples.exists_query()
    phi, domains = ex.term.evaluate(), ex.domains
    assert rows(rel.apply(phi, ex.relations or [], domains)) == {
        ("s₁",),
        ("s₂",),
        ("s₃",),
    }
    empty = Relation(phi.inner[0], [])
    assert rows(rel.apply(phi, [empty], domains)) == set()
    with pytest.raises(WiringError) as e:
        rel.apply(phi, ex.relations or [])
    assert e.value.kind == "missing_domain"


def test_empty_relations_annihilate() -> None:
    """Remark 2.2.13: one empty argument empties the result, even when unconnected."""
    x, y = Star({"a": "A"}), Star({"b": "A"})
    phi = WiringDiagram(["A", "A"], [{"a": 0}, {"b": 1}], {"o": 0})
    full = Relation(x, [(0,), (1,)])
    assert rows(rel.apply(phi, [full, Relation(y, [(0,)])])) == {(0,), (1,)}
    assert rows(rel.apply(phi, [full, Relation(y, [])])) == set()


def test_floating_cable_of_empty_type_empties_the_result() -> None:
    phi = WiringDiagram(["A", "E"], [], {"o": 0})
    assert len(rel.apply(phi, [], {"A": [0, 1], "E": [0]})) == 2
    assert len(rel.apply(phi, [], {"A": [0, 1], "E": []})) == 0


def test_factorial_is_the_greatest_recursive_relation() -> None:
    out = examples.factorial().expected()
    assert out is not None
    assert sorted(rows(out)) == [(0, 1), (1, 1), (2, 2), (3, 6), (4, 24)]


def test_relation_arity_is_checked() -> None:
    with pytest.raises(WiringError) as e:
        Relation(Star({"a": "A"}), [(1, 2)])
    assert e.value.kind == "relation_arity"


# -- Rel laws ----------------------------------------------------------------------


@st.composite
def relations(draw: st.DrawFn, star: Star) -> Relation:
    universe = list(itertools.product(*(DOMAINS[t] for t in star.types)))
    return Relation(star, draw(st.lists(st.sampled_from(universe), max_size=5)) if universe else [])


@given(two_level(), st.data())
def test_rel_respects_composition(
    family: tuple[WiringDiagram, list[WiringDiagram]], data: st.DataObject
) -> None:
    phi, psis = family
    leaves = [[data.draw(relations(x)) for x in psi.inner] for psi in psis]
    stepwise = rel.apply(
        phi,
        [rel.apply(psi, rs, DOMAINS) for psi, rs in zip(psis, leaves, strict=True)],
        DOMAINS,
    )
    flat = rel.apply(phi.compose(psis), list(itertools.chain.from_iterable(leaves)), DOMAINS)
    assert stepwise == flat


@given(stars(), st.data())
def test_rel_respects_identities(x: Star, data: st.DataObject) -> None:
    r = data.draw(relations(x))
    assert rel.apply(Id(x), [r], DOMAINS) == r


@given(diagrams(), st.data())
def test_rel_is_equivariant(phi: WiringDiagram, data: st.DataObject) -> None:
    rs = [data.draw(relations(x)) for x in phi.inner]
    sigma = data.draw(st.permutations(range(phi.arity)))
    assert rel.apply(phi.permute(sigma), [rs[s] for s in sigma], DOMAINS) == rel.apply(
        phi, rs, DOMAINS
    )


@given(diagrams(), st.data())
def test_rel_preserves_unions(phi: WiringDiagram, data: st.DataObject) -> None:
    """Proposition 4.3.1: Rel(φ) is a map of join-semilattices in each argument."""
    if phi.arity == 0:
        return
    rs = [data.draw(relations(x)) for x in phi.inner]
    i = data.draw(st.integers(0, phi.arity - 1))
    extra = data.draw(relations(phi.inner[i]))
    joined = list(rs)
    joined[i] = rs[i] | extra
    alt = list(rs)
    alt[i] = extra
    assert rel.apply(phi, joined, DOMAINS) == rel.apply(phi, rs, DOMAINS) | rel.apply(
        phi, alt, DOMAINS
    )


# -- Eq ------------------------------------------------------------------------------


@st.composite
def partitions(draw: st.DrawFn, star: Star) -> eq.Partition:
    return eq.Partition(star, [draw(st.integers(0, 2)) for _ in range(len(star))])


@given(two_level(), st.data())
def test_eq_respects_composition(
    family: tuple[WiringDiagram, list[WiringDiagram]], data: st.DataObject
) -> None:
    phi, psis = family
    leaves = [[data.draw(partitions(x)) for x in psi.inner] for psi in psis]
    stepwise = eq.apply(phi, [eq.apply(psi, ps) for psi, ps in zip(psis, leaves, strict=True)])
    flat = eq.apply(phi.compose(psis), list(itertools.chain.from_iterable(leaves)))
    assert stepwise == flat


@given(stars(), st.data())
def test_eq_respects_identities(x: Star, data: st.DataObject) -> None:
    p = data.draw(partitions(x))
    assert eq.apply(Id(x), [p]) == p


def test_eq_connects_through_cables() -> None:
    """The ψ: (2, 2) → 2 of Proposition 3.1.4's proof, and Eq(ψ)(m, Δ) = Δ."""
    two = Star({"1": "*", "2": "*"})
    # {1a, 2a} ⊔ {1b, 2b} → {1a, 1b, 2ab} ← {1a, 1b}
    psi = WiringDiagram(["*"] * 3, [{"1": 0, "2": 2}, {"1": 1, "2": 2}], {"1": 0, "2": 1})
    m = eq.Partition.from_groups(two, [["1", "2"]])
    delta = eq.Partition.discrete(two)
    assert eq.apply(psi, [m, delta]) == delta
    assert eq.apply(psi, [m, m]) == m
