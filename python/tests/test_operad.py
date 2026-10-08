"""Objects, morphisms, canonical form, and the operad laws."""

from __future__ import annotations

import itertools
import json

import pytest
from hypothesis import given
from hypothesis import strategies as st

from wiring_diagrams import Star, WiringDiagram, WiringError

from .strategies import diagrams, stars, three_level, two_level

Id = WiringDiagram.identity


# -- stars --------------------------------------------------------------------


def test_star_is_a_set_sorted_by_code_point() -> None:
    x = Star({"😀": "A", "b": "A", "￿": "B", "é": "A", "Z": "B"})
    assert x.names == ("Z", "b", "é", "￿", "😀")
    assert x == Star(dict(reversed(list(x))))


def test_star_rejects_duplicate_wires() -> None:
    with pytest.raises(WiringError) as e:
        Star.from_pairs([("a", "A"), ("a", "B")])
    assert e.value.kind == "duplicate_wire"


# -- canonical form -------------------------------------------------------------


def test_renaming_cables_gives_the_same_morphism() -> None:
    a = WiringDiagram(["A", "B", "A"], [{"x": 0, "y": 1}], {"z": 2})
    b = WiringDiagram(["B", "A", "A"], [{"x": 2, "y": 0}], {"z": 1})
    assert a == b and hash(a) == hash(b)
    assert a.to_json() == {
        "cables": ["A", "B", "A"],
        "inner": [{"x": 0, "y": 1}],
        "outer": {"z": 2},
    }


def test_floating_cables_are_counted_and_sorted_by_type() -> None:
    a = WiringDiagram(["B", "A", "A"], [], {"o": 1})
    assert a.cables == ("A", "A", "B")
    assert list(a.floating_cables()) == [1, 2]
    assert a != WiringDiagram(["A", "A"], [], {"o": 0})


def test_cable_out_of_range() -> None:
    with pytest.raises(WiringError) as e:
        WiringDiagram(["A"], [{"x": 1}], {})
    assert e.value.kind == "cable_out_of_range"


@pytest.mark.parametrize(
    "data",
    [
        {"cables": ["A"], "inner": [], "outer": {"x": True}},
        {"cables": ["A"], "inner": [], "outer": {"x": 0}, "extra": 1},
        {"cables": [1], "inner": [], "outer": {}},
        {"cables": ["A"], "inner": {}, "outer": {}},
    ],
)
def test_from_json_rejects_malformed_input(data: object) -> None:
    with pytest.raises(WiringError) as e:
        WiringDiagram.from_json(data)
    assert e.value.kind == "invalid_json"


@given(diagrams())
def test_json_round_trip(phi: WiringDiagram) -> None:
    assert WiringDiagram.from_json(json.loads(json.dumps(phi.to_json()))) == phi


@given(diagrams())
def test_canonical_form_is_a_fixed_point(phi: WiringDiagram) -> None:
    again = WiringDiagram(
        phi.cables, [phi.inner_wiring(i) for i in range(phi.arity)], phi.outer_wiring()
    )
    assert again.to_json() == phi.to_json()


# -- operad laws (Spivak, Definition 2.1.2) -------------------------------------


@given(diagrams())
def test_identity_laws(phi: WiringDiagram) -> None:
    assert phi.compose([Id(x) for x in phi.inner]) == phi
    assert Id(phi.outer).compose([phi]) == phi


@given(three_level())
def test_associativity(
    family: tuple[WiringDiagram, list[WiringDiagram], list[list[WiringDiagram]]],
) -> None:
    phi, psis, chis = family
    inner_first = phi.compose([psi.compose(chi) for psi, chi in zip(psis, chis, strict=True)])
    outer_first = phi.compose(psis).compose(list(itertools.chain.from_iterable(chis)))
    assert inner_first == outer_first


@given(two_level(), st.data())
def test_equivariance(
    family: tuple[WiringDiagram, list[WiringDiagram]], data: st.DataObject
) -> None:
    phi, psis = family
    sigma = data.draw(st.permutations(range(phi.arity)))
    lhs = phi.permute(sigma).compose([psis[s] for s in sigma])
    # the induced block permutation of the composite's inner stars
    starts = list(itertools.accumulate((psi.arity for psi in psis), initial=0))
    block = [j for s in sigma for j in range(starts[s], starts[s] + psis[s].arity)]
    assert lhs == phi.compose(psis).permute(block)


@given(diagrams(), st.data())
def test_permutation_is_a_group_action(phi: WiringDiagram, data: st.DataObject) -> None:
    n = phi.arity
    s = data.draw(st.permutations(range(n)))
    t = data.draw(st.permutations(range(n)))
    assert phi.permute(range(n)) == phi  # type: ignore[arg-type]
    assert phi.permute(s).permute(t) == phi.permute([s[k] for k in t])


@given(two_level(), st.data())
def test_partial_composition_agrees_with_full(
    family: tuple[WiringDiagram, list[WiringDiagram]], data: st.DataObject
) -> None:
    phi, psis = family
    if phi.arity == 0:
        return
    i = data.draw(st.integers(0, phi.arity - 1))
    children = [Id(x) for x in phi.inner]
    children[i] = psis[i]
    assert phi.compose_at(i, psis[i]) == phi.compose(children)


@given(two_level())
def test_map_types_is_an_operad_functor(
    family: tuple[WiringDiagram, list[WiringDiagram]],
) -> None:
    phi, psis = family

    def forget(_: str) -> str:
        return "*"

    assert phi.compose(psis).map_types(forget) == phi.map_types(forget).compose(
        [psi.map_types(forget) for psi in psis]
    )
    swap = {"A": "B", "B": "A"}.__getitem__
    assert phi.map_types(swap).map_types(swap) == phi


# -- composition failures ---------------------------------------------------------


@given(stars())
def test_composition_checks_arity_and_stars(x: Star) -> None:
    phi = Id(x)
    with pytest.raises(WiringError) as e:
        phi.compose([])
    assert e.value.kind == "arity_mismatch"
    other = Star({**dict(x), "zz": "A"})
    with pytest.raises(WiringError) as e:
        phi.compose([Id(other)])
    assert e.value.kind == "star_mismatch"
    with pytest.raises(WiringError) as e:
        phi.permute([1, 0])
    assert e.value.kind == "not_a_permutation"


def test_closed_loops_become_floating_cables() -> None:
    """A cable that only touches the substituted star closes off but is kept."""
    outer = WiringDiagram(["A"], [{"p": 0}], {})  # p dangles inside the outer star
    inner = WiringDiagram(["A"], [], {"p": 0})  # and p dangles inside x too
    composite = outer.compose([inner])
    assert composite.to_json() == {"cables": ["A"], "inner": [], "outer": {}}
    assert list(composite.floating_cables()) == [0]


def test_spivak_figure_6_style_composition() -> None:
    """Composite of a 2-star diagram with a diagram filling the first star."""
    phi = WiringDiagram(
        ["A", "A", "A"],
        [{"r": 0, "s": 1}, {"u": 1, "v": 2}],
        {"a": 0, "b": 2},
    )
    psi = WiringDiagram(["A", "A"], [{"x": 0}, {"y": 0, "z": 1}], {"r": 0, "s": 1})
    got = phi.compose_at(0, psi)
    assert got.to_json() == {
        "cables": ["A", "A", "A"],
        "inner": [{"x": 0}, {"y": 0, "z": 1}, {"u": 1, "v": 2}],
        "outer": {"a": 0, "b": 2},
    }
