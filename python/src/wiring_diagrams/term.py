"""Operad terms: trees of wiring diagrams ("a wiring diagram of wiring diagrams").

A :class:`Term` is a wiring diagram whose inner stars may each be filled with
another term. :meth:`Term.evaluate` composes the whole tree into one diagram.
The tree is kept because it is what the viewer draws in its nested view.

Labels (``"NAND"``, ``"attends"``) are presentation only. They live on the
term and never on :class:`~.diagram.WiringDiagram`, so they cannot affect
equality of morphisms.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from .diagram import WiringDiagram
from .errors import WiringError

__all__ = ["Term"]


class Term:
    __slots__ = ("children", "diagram", "label", "labels")

    diagram: WiringDiagram
    children: tuple[Term | None, ...]
    labels: tuple[str | None, ...]
    label: str | None

    def __init__(
        self,
        diagram: WiringDiagram,
        children: Sequence[Term | None] | None = None,
        labels: Sequence[str | None] | None = None,
        label: str | None = None,
    ) -> None:
        n = diagram.arity
        kids = tuple(children) if children is not None else (None,) * n
        names = tuple(labels) if labels is not None else (None,) * n
        if len(kids) != n or len(names) != n:
            raise WiringError(
                "arity_mismatch",
                f"term over a diagram of arity {n} has {len(kids)} children "
                f"and {len(names)} labels",
            )
        for i, kid in enumerate(kids):
            if kid is not None and kid.diagram.outer != diagram.inner[i]:
                raise WiringError(
                    "star_mismatch",
                    f"child {i} has outer star {kid.diagram.outer!r}, "
                    f"expected {diagram.inner[i]!r}",
                )
        self.diagram = diagram
        self.children = kids
        self.labels = names
        self.label = label

    def evaluate(self) -> WiringDiagram:
        """Compose the tree bottom-up. Empty slots are filled with identities."""
        if all(kid is None for kid in self.children):
            return self.diagram
        return self.diagram.compose(
            [
                kid.evaluate() if kid is not None else WiringDiagram.identity(x)
                for kid, x in zip(self.children, self.diagram.inner, strict=True)
            ]
        )

    def leaf_labels(self) -> list[str | None]:
        """Labels of the inner stars of :meth:`evaluate`, in order."""
        out: list[str | None] = []
        for kid, name in zip(self.children, self.labels, strict=True):
            out.extend(kid.leaf_labels() if kid is not None else [name])
        return out

    def to_json(self) -> dict[str, Any]:
        data: dict[str, Any] = {"diagram": self.diagram.to_json()}
        if any(kid is not None for kid in self.children):
            data["children"] = [None if k is None else k.to_json() for k in self.children]
        if any(name is not None for name in self.labels):
            data["labels"] = list(self.labels)
        if self.label is not None:
            data["label"] = self.label
        return data

    @classmethod
    def from_json(cls, data: Any) -> Term:
        if not isinstance(data, dict) or "diagram" not in data:
            raise WiringError("invalid_json", "a term is {diagram, children?, labels?, label?}")
        children = data.get("children")
        return cls(
            WiringDiagram.from_json(data["diagram"]),
            None
            if children is None
            else [None if k is None else cls.from_json(k) for k in children],
            data.get("labels"),
            data.get("label"),
        )
