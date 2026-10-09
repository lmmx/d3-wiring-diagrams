"""The algebra Eq of equivalence relations (Spivak, Example 3.1.3).

``Eq(X)`` is the set of partitions of the wires of ``X``. ``Eq(φ)`` connects
wires globally whenever they are connected through the diagram. Cables are
merged when two wires of one inner star are equivalent, and the outer
partition is read off through ``g``. Types are ignored, so this is an algebra
on ``S`` pulled back along ``U: T → S``.

A partition is stored as a block id for each wire in canonical order. Ids are
numbered by first appearance (a restricted growth string), so equal partitions
have equal representations.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence

from .diagram import WiringDiagram
from .errors import WiringError
from .star import Star

__all__ = ["Partition", "apply"]


def _restricted_growth(labels: Iterable[int]) -> tuple[int, ...]:
    seen: dict[int, int] = {}
    return tuple(seen.setdefault(b, len(seen)) for b in labels)


class Partition:
    __slots__ = ("blocks", "star")

    star: Star
    blocks: tuple[int, ...]

    def __init__(self, star: Star, blocks: Sequence[int]) -> None:
        if len(blocks) != len(star) or not all(type(b) is int and b >= 0 for b in blocks):
            raise WiringError(
                "invalid_partition",
                f"{list(blocks)!r} is not a block id (int >= 0) for each of {len(star)} wires",
            )
        self.star = star
        self.blocks = _restricted_growth(blocks)

    @classmethod
    def from_groups(cls, star: Star, groups: Iterable[Iterable[str]]) -> Partition:
        """Build from groups of wire names. Wires in no group are singletons."""
        block = list(range(len(star)))
        for g in groups:
            members = [star.index(n) for n in g]
            for m in members:
                block[m] = members[0]
        return cls(star, block)

    @classmethod
    def discrete(cls, star: Star) -> Partition:
        return cls(star, range(len(star)))

    def groups(self) -> list[list[str]]:
        out: list[list[str]] = [[] for _ in range(max(self.blocks, default=-1) + 1)]
        for name, b in zip(self.star.names, self.blocks, strict=True):
            out[b].append(name)
        return out

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Partition):
            return NotImplemented
        return self.star == other.star and self.blocks == other.blocks

    def __hash__(self) -> int:
        return hash((self.star, self.blocks))

    def __repr__(self) -> str:
        return f"Partition({self.groups()!r})"


def apply(phi: WiringDiagram, partitions: Sequence[Partition]) -> Partition:
    """``Eq(φ)(E₁, …, Eₙ)``: the partition of ``Y`` induced through the cables."""
    if len(partitions) != phi.arity:
        raise WiringError(
            "arity_mismatch",
            f"diagram has {phi.arity} inner stars, got {len(partitions)}",
        )
    parent = list(range(len(phi.cables)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, p in enumerate(partitions):
        if p.star != phi.inner[i]:
            raise WiringError(
                "star_mismatch",
                f"partition {i} is on {p.star!r}, expected {phi.inner[i]!r}",
            )
        wiring = phi.inner_cables[i]
        first: dict[int, int] = {}
        for w, b in enumerate(p.blocks):
            if b in first:
                parent[find(wiring[w])] = find(first[b])
            else:
                first[b] = wiring[w]
    return Partition(phi.outer, [find(c) for c in phi.outer_cables])
