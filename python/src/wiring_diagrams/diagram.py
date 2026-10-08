"""Morphisms of the operad: typed wiring diagrams (Spivak, Examples 2.1.7, 4.1.1).

A wiring diagram ``φ: X₁, …, Xₙ → Y`` is a cospan of typed finite sets

    X₁ ⊔ … ⊔ Xₙ  --f-->  C  <--g--  Y

where ``C`` is the set of *cables*, each with a type ``σ(c)``, and ``f`` and ``g``
preserve types. Diagrams that differ only by renaming cables are the same
morphism. :class:`WiringDiagram` stores the canonical representative of that
isomorphism class, so ``==`` and ``hash`` are equality of morphisms.

Canonical form:

* wires within each star are ordered by name (see :class:`~.star.Star`);
* cables are numbered by first appearance, scanning the inner stars in order and
  then the outer star;
* cables soldered to no wire at all ("floating" cables) come last, ordered by
  type.

Two cospans are isomorphic exactly when these forms are identical. An
isomorphism of cables is determined on every cable that some wire touches, and
floating cables can only be matched by type.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from typing import Any

from .errors import WiringError
from .star import Star

__all__ = ["WiringDiagram"]


class WiringDiagram:
    """A typed wiring diagram ``φ: X₁, …, Xₙ → Y`` in canonical form.

    Args:
        cables: the type of each cable, indexed ``0..k-1``.
        inner: for each inner star ``Xᵢ``, a mapping from wire name to the cable
            it is soldered onto (this is ``f`` restricted to ``Xᵢ``).
        outer: a mapping from each outer wire name to its cable (this is ``g``).

    The type of every wire is the type of its cable, so a type-incorrect cospan
    cannot be expressed. The only thing that can be wrong with the input is a
    cable index out of range.
    """

    __slots__ = (
        "_cables",
        "_hash",
        "_inner",
        "_inner_cables",
        "_outer",
        "_outer_cables",
    )

    _cables: tuple[str, ...]
    _inner: tuple[Star, ...]
    _inner_cables: tuple[tuple[int, ...], ...]
    _outer: Star
    _outer_cables: tuple[int, ...]
    _hash: int | None

    def __init__(
        self,
        cables: Sequence[str],
        inner: Sequence[Mapping[str, int]],
        outer: Mapping[str, int],
    ) -> None:
        types = tuple(cables)
        k = len(types)

        def wiring(where: str, m: Mapping[str, int]) -> tuple[Star, list[int]]:
            names = tuple(sorted(m))
            idx = [m[name] for name in names]
            for name, c in zip(names, idx, strict=True):
                if not 0 <= c < k:
                    raise WiringError(
                        "cable_out_of_range",
                        f"{where} wire {name!r} -> cable {c}, but there are {k} cables",
                    )
            return Star._from_sorted(names, tuple(types[c] for c in idx)), idx

        inner_stars, inner_raw = [], []
        for i, m in enumerate(inner):
            star, idx = wiring(f"inner star {i}", m)
            inner_stars.append(star)
            inner_raw.append(idx)
        outer_star, outer_raw = wiring("outer", outer)
        _install(
            self,
            *_canonical(types, inner_stars, inner_raw, outer_star, outer_raw, range(k)),
        )

    # -- constituents ------------------------------------------------------

    @property
    def cables(self) -> tuple[str, ...]:
        """``σ: C → Types``, the type of each cable."""
        return self._cables

    @property
    def inner(self) -> tuple[Star, ...]:
        """The domain objects ``X₁, …, Xₙ`` (inner stars)."""
        return self._inner

    @property
    def outer(self) -> Star:
        """The codomain object ``Y`` (outer star)."""
        return self._outer

    @property
    def arity(self) -> int:
        return len(self._inner)

    @property
    def inner_cables(self) -> tuple[tuple[int, ...], ...]:
        """``f``: for each inner star, the cable of each wire (canonical wire order)."""
        return self._inner_cables

    @property
    def outer_cables(self) -> tuple[int, ...]:
        """``g``: the cable of each outer wire (canonical wire order)."""
        return self._outer_cables

    def inner_wiring(self, i: int) -> dict[str, int]:
        return dict(zip(self._inner[i].names, self._inner_cables[i], strict=True))

    def outer_wiring(self) -> dict[str, int]:
        return dict(zip(self._outer.names, self._outer_cables, strict=True))

    def floating_cables(self) -> range:
        """Cables soldered to no wire. Canonical form puts them last."""
        used = len(self._cables)
        seen = {c for cs in self._inner_cables for c in cs}
        seen.update(self._outer_cables)
        while used > 0 and (used - 1) not in seen:
            used -= 1
        return range(used, len(self._cables))

    # -- operad structure --------------------------------------------------

    @classmethod
    def identity(cls, star: Star) -> WiringDiagram:
        """``id_X: X → X``, the cospan ``X → X ← X`` of identity maps."""
        cables = tuple(range(len(star)))
        return _make(star.types, (star,), (cables,), star, cables)

    def compose(self, children: Sequence[WiringDiagram]) -> WiringDiagram:
        """Operadic composition ``self ∘ (ψ₁, …, ψₙ)``: substitute ``ψᵢ`` into ``Xᵢ``.

        This computes the pushout of ``C ← ⊔Xᵢ → ⊔Cᵢ`` (Spivak, (2.1.7)) with a
        union–find over ``C ⊔ C₁ ⊔ … ⊔ Cₙ``: each wire of each intermediate star
        ``Xᵢ`` identifies the outer cable it is soldered to with the inner cable
        it is soldered to. The cost is O(N α(N)) in the total number of wires and
        cables, plus sorting the floating cables of the result.
        """
        if len(children) != self.arity:
            raise WiringError(
                "arity_mismatch",
                f"diagram has {self.arity} inner stars but {len(children)} were given",
            )
        types = list(self._cables)
        offsets: list[int] = []
        for i, child in enumerate(children):
            if child._outer != self._inner[i]:
                raise WiringError(
                    "star_mismatch",
                    f"inner star {i} is {self._inner[i]!r} "
                    f"but child {i} has outer star {child._outer!r}",
                )
            offsets.append(len(types))
            types.extend(child._cables)

        total = len(types)
        parent = list(range(total))
        size = [1] * total

        def find(x: int) -> int:
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        for i, child in enumerate(children):
            off = offsets[i]
            for a, b in zip(self._inner_cables[i], child._outer_cables, strict=True):
                ra, rb = find(a), find(off + b)
                if ra != rb:
                    if size[ra] < size[rb]:
                        ra, rb = rb, ra
                    parent[rb] = ra
                    size[ra] += size[rb]

        root = [find(x) for x in range(total)]
        inner_stars: list[Star] = []
        inner_raw: list[list[int]] = []
        for i, child in enumerate(children):
            off = offsets[i]
            for star, cs in zip(child._inner, child._inner_cables, strict=True):
                inner_stars.append(star)
                inner_raw.append([root[off + c] for c in cs])
        outer_raw = [root[c] for c in self._outer_cables]
        classes = (x for x in range(total) if root[x] == x)
        return _make(*_canonical(types, inner_stars, inner_raw, self._outer, outer_raw, classes))

    def compose_at(self, i: int, child: WiringDiagram) -> WiringDiagram:
        """Partial composition ``self ∘ᵢ child``: substitute into inner star ``i`` only."""
        if not 0 <= i < self.arity:
            raise WiringError(
                "arity_mismatch",
                f"no inner star {i} in a diagram of arity {self.arity}",
            )
        children = [WiringDiagram.identity(x) for x in self._inner]
        children[i] = child
        return self.compose(children)

    def permute(self, sigma: Sequence[int]) -> WiringDiagram:
        """The symmetric group action: the result's inner star ``k`` is ``self``'s ``sigma[k]``.

        Equivariance (tested): ``φ.permute(σ).compose([ψ[σ[k]] for k])`` equals
        ``φ.compose(ψ)`` with its inner stars permuted blockwise by ``σ``.
        """
        n = self.arity
        if sorted(sigma) != list(range(n)):
            raise WiringError(
                "not_a_permutation",
                f"{list(sigma)!r} is not a permutation of 0..{n - 1}",
            )
        return _make(
            *_canonical(
                self._cables,
                [self._inner[s] for s in sigma],
                [self._inner_cables[s] for s in sigma],
                self._outer,
                self._outer_cables,
                range(len(self._cables)),
            )
        )

    def map_types(self, fn: Callable[[str], str]) -> WiringDiagram:
        """Apply the operad functor induced by a function on type names.

        ``map_types(lambda _: "*")`` is the forgetful functor ``U: T → S``.
        Applied to a diagram of S, ``map_types(lambda _: A)`` is ``F_A: S → T``
        (Spivak, §4.1).
        """
        types = [fn(t) for t in self._cables]
        inner = [
            Star._from_sorted(x.names, tuple(types[c] for c in cs))
            for x, cs in zip(self._inner, self._inner_cables, strict=True)
        ]
        outer = Star._from_sorted(self._outer.names, tuple(types[c] for c in self._outer_cables))
        return _make(
            *_canonical(
                types,
                inner,
                self._inner_cables,
                outer,
                self._outer_cables,
                range(len(types)),
            )
        )

    # -- equality, display, serialisation ---------------------------------

    def _key(self) -> tuple[Any, ...]:
        return (
            self._cables,
            self._inner_cables,
            self._outer_cables,
            self._inner,
            self._outer,
        )

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, WiringDiagram):
            return NotImplemented
        return self is other or self._key() == other._key()

    def __hash__(self) -> int:
        if self._hash is None:
            self._hash = hash(self._key())
        return self._hash

    def __repr__(self) -> str:
        inner = ", ".join(repr(self.inner_wiring(i)) for i in range(self.arity))
        return (
            f"WiringDiagram(cables={list(self._cables)!r}, inner=[{inner}], "
            f"outer={self.outer_wiring()!r})"
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "cables": list(self._cables),
            "inner": [self.inner_wiring(i) for i in range(self.arity)],
            "outer": self.outer_wiring(),
        }

    @classmethod
    def from_json(cls, data: Any) -> WiringDiagram:
        def is_wiring(m: Any) -> bool:
            return isinstance(m, dict) and all(
                isinstance(k, str) and type(v) is int for k, v in m.items()
            )

        if (
            not isinstance(data, dict)
            or set(data) != {"cables", "inner", "outer"}
            or not isinstance(data["cables"], list)
            or not all(isinstance(t, str) for t in data["cables"])
            or not isinstance(data["inner"], list)
            or not all(is_wiring(m) for m in data["inner"])
            or not is_wiring(data["outer"])
        ):
            raise WiringError(
                "invalid_json",
                "a wiring diagram is {cables: [type], inner: [{wire: cable}], "
                "outer: {wire: cable}}",
            )
        return cls(data["cables"], data["inner"], data["outer"])


# -- construction helpers ---------------------------------------------------

_Canonical = tuple[
    tuple[str, ...],
    tuple[Star, ...],
    tuple[tuple[int, ...], ...],
    Star,
    tuple[int, ...],
]


def _canonical(
    types: Sequence[str],
    inner_stars: Sequence[Star],
    inner_raw: Sequence[Sequence[int]],
    outer: Star,
    outer_raw: Sequence[int],
    cables: Iterable[int],
) -> _Canonical:
    """Relabel raw cable ids by first appearance and sort the floating cables.

    ``types[c]`` is the type of raw cable ``c``, and ``cables`` enumerates every
    raw cable of the cospan, including those no wire touches.
    """
    relabel: dict[int, int] = {}
    new_types: list[str] = []

    def label(c: int) -> int:
        j = relabel.get(c)
        if j is None:
            j = relabel[c] = len(new_types)
            new_types.append(types[c])
        return j

    inner_cables = tuple(tuple(label(c) for c in cs) for cs in inner_raw)
    outer_cables = tuple(label(c) for c in outer_raw)
    new_types.extend(sorted(types[c] for c in cables if c not in relabel))
    return tuple(new_types), tuple(inner_stars), inner_cables, outer, outer_cables


def _make(
    cables: Sequence[str],
    inner: Sequence[Star],
    inner_cables: Sequence[Sequence[int]],
    outer: Star,
    outer_cables: Sequence[int],
) -> WiringDiagram:
    """Build a diagram from parts that are already canonical."""
    wd = WiringDiagram.__new__(WiringDiagram)
    _install(
        wd,
        tuple(cables),
        tuple(inner),
        tuple(map(tuple, inner_cables)),
        outer,
        tuple(outer_cables),
    )
    return wd


def _install(
    wd: WiringDiagram,
    cables: tuple[str, ...],
    inner: tuple[Star, ...],
    inner_cables: tuple[tuple[int, ...], ...],
    outer: Star,
    outer_cables: tuple[int, ...],
) -> None:
    wd._cables = cables
    wd._inner = inner
    wd._inner_cables = inner_cables
    wd._outer = outer
    wd._outer_cables = outer_cables
    wd._hash = None
