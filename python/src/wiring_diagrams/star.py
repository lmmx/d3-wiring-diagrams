"""Objects of the operad: typed stars (Spivak, Example 4.1.1)."""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Mapping
from typing import Any

from .errors import WiringError

__all__ = ["Star"]


class Star:
    """A typed star ``(X, τ)``: a finite set of wire names, each with a value type.

    The wires form a set, so the order they are given in has no meaning. They are
    stored sorted by name in Unicode code point order. That order is what Python's
    ``sorted`` uses, and the Rust and JS implementations use it too, so position
    ``k`` names the same wire in every language. Types are opaque strings that
    name sets of values.
    """

    __slots__ = ("_hash", "_names", "_types")

    _names: tuple[str, ...]
    _types: tuple[str, ...]
    _hash: int

    def __init__(self, wires: Mapping[str, str]) -> None:
        names = tuple(sorted(wires))
        self._names = names
        self._types = tuple(wires[n] for n in names)
        self._hash = hash((self._names, self._types))

    @classmethod
    def _from_sorted(cls, names: tuple[str, ...], types: tuple[str, ...]) -> Star:
        star = cls.__new__(cls)
        star._names = names
        star._types = types
        star._hash = hash((names, types))
        return star

    @classmethod
    def from_pairs(cls, pairs: Iterable[tuple[str, str]]) -> Star:
        """Build a star from ``(name, type)`` pairs, rejecting repeated names."""
        wires: dict[str, str] = {}
        for name, typ in pairs:
            if name in wires:
                raise WiringError("duplicate_wire", f"wire {name!r} appears twice")
            wires[name] = typ
        return cls(wires)

    @classmethod
    def untyped(cls, names: Iterable[str], type: str = "*") -> Star:
        """A star of the singly-typed operad S: every wire has the same type."""
        return cls.from_pairs([(n, type) for n in names])

    @property
    def names(self) -> tuple[str, ...]:
        """Wire names in canonical (code point) order."""
        return self._names

    @property
    def types(self) -> tuple[str, ...]:
        """Wire types, aligned with :attr:`names`."""
        return self._types

    def index(self, name: str) -> int:
        """Position of wire ``name`` in canonical order."""
        try:
            return self._names.index(name)
        except ValueError:
            raise KeyError(name) from None

    def type_of(self, name: str) -> str:
        return self._types[self.index(name)]

    def __len__(self) -> int:
        return len(self._names)

    def __iter__(self) -> Iterator[tuple[str, str]]:
        return zip(self._names, self._types, strict=True)

    def __contains__(self, name: object) -> bool:
        return name in self._names

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Star):
            return NotImplemented
        return self is other or (
            self._hash == other._hash
            and self._names == other._names
            and self._types == other._types
        )

    def __hash__(self) -> int:
        return self._hash

    def __repr__(self) -> str:
        inner = ", ".join(f"{n}: {t}" for n, t in self)
        return f"Star({{{inner}}})"

    def to_json(self) -> dict[str, str]:
        return dict(self)

    @classmethod
    def from_json(cls, data: Any) -> Star:
        if not isinstance(data, dict) or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in data.items()
        ):
            raise WiringError("invalid_json", "a star is an object of name -> type")
        return cls(data)
