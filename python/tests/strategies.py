"""Hypothesis strategies for stars, diagrams and composable families of diagrams."""

from __future__ import annotations

from collections.abc import Sequence

from hypothesis import strategies as st

from wiring_diagrams import Star, WiringDiagram

TYPES = ("A", "B")
NAMES = ("a", "b", "c", "d", "é", "😀")
DOMAINS: dict[str, list[object]] = {"A": [0, 1], "B": ["x", "y", "z"]}


@st.composite
def stars(draw: st.DrawFn, max_wires: int = 3) -> Star:
    names = draw(st.lists(st.sampled_from(NAMES), max_size=max_wires, unique=True))
    return Star({n: draw(st.sampled_from(TYPES)) for n in names})


@st.composite
def diagrams(
    draw: st.DrawFn,
    inner: Sequence[Star] | None = None,
    outer: Star | None = None,
    max_arity: int = 3,
) -> WiringDiagram:
    """A random diagram with the given boundary (random where not given).

    Each wire is soldered onto an existing cable of its type, or onto a new one.
    Both choices are drawn, so shared cables, dangling cables, self-loops and
    floating cables all occur.
    """
    if inner is None:
        inner = draw(st.lists(stars(), max_size=max_arity))
    if outer is None:
        outer = draw(stars())
    cables: list[str] = []

    def solder(typ: str) -> int:
        same = [c for c, t in enumerate(cables) if t == typ]
        if same and draw(st.booleans()):
            return draw(st.sampled_from(same))
        cables.append(typ)
        return len(cables) - 1

    inner_maps = [{n: solder(t) for n, t in x} for x in inner]
    outer_map = {n: solder(t) for n, t in outer}
    cables += draw(st.lists(st.sampled_from(TYPES), max_size=2))
    # present the cables in a random order to exercise canonicalisation
    perm = draw(st.permutations(range(len(cables))))
    inv = {old: new for new, old in enumerate(perm)}
    return WiringDiagram(
        [cables[p] for p in perm],
        [{n: inv[c] for n, c in m.items()} for m in inner_maps],
        {n: inv[c] for n, c in outer_map.items()},
    )


@st.composite
def two_level(draw: st.DrawFn) -> tuple[WiringDiagram, list[WiringDiagram]]:
    phi = draw(diagrams())
    return phi, [draw(diagrams(outer=x)) for x in phi.inner]


@st.composite
def three_level(
    draw: st.DrawFn,
) -> tuple[WiringDiagram, list[WiringDiagram], list[list[WiringDiagram]]]:
    phi, psis = draw(two_level())
    chis = [[draw(diagrams(outer=x, max_arity=2)) for x in psi.inner] for psi in psis]
    return phi, psis, chis
