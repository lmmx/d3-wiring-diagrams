"""The closed structure of the operad (Spivak, Definition 5.1.1, Proposition 5.1.4).

The internal hom ``[Y₁, …, Yₙ ⇒ Z]`` is the coproduct ``Y₁ ⊔ … ⊔ Yₙ ⊔ Z``. A
coproduct of named sets needs fresh names, so a wire ``a`` of ``Yᵢ`` is called
``"{i}.{a}"`` and a wire ``b`` of ``Z`` is called ``"out.{b}"``. The text before
the first ``.`` is either a decimal index or ``out``. That makes the encoding
injective whatever the original names contain.
"""

from __future__ import annotations

from collections.abc import Sequence

from .diagram import WiringDiagram
from .errors import WiringError
from .star import Star

__all__ = ["evaluation", "externalize", "hom_wire", "internal_hom", "internalize"]


def hom_wire(i: int | None, name: str) -> str:
    """Name in ``[Y ⇒ Z]`` of wire ``name`` of ``Yᵢ`` (or of ``Z`` when ``i is None``)."""
    return f"out.{name}" if i is None else f"{i}.{name}"


def internal_hom(ys: Sequence[Star], z: Star) -> Star:
    """The internal hom object ``[Y₁, …, Yₙ ⇒ Z] = Y₁ ⊔ … ⊔ Yₙ ⊔ Z``."""
    pairs = [(hom_wire(i, a), t) for i, y in enumerate(ys) for a, t in y]
    pairs += [(hom_wire(None, b), t) for b, t in z]
    return Star.from_pairs(pairs)


def evaluation(ys: Sequence[Star], z: Star) -> WiringDiagram:
    """``ev: [Y ⇒ Z], Y₁, …, Yₙ → Z``.

    There is one cable per wire of ``[Y ⇒ Z]``. Each ``Yᵢ`` is folded onto its
    copy inside ``[Y ⇒ Z]``, and ``Z`` is soldered onto its copy.
    """
    hom = internal_hom(ys, z)
    cable = {name: c for c, name in enumerate(hom.names)}
    inner = [dict(cable)]
    inner += [{a: cable[hom_wire(i, a)] for a in y.names} for i, y in enumerate(ys)]
    outer = {b: cable[hom_wire(None, b)] for b in z.names}
    return WiringDiagram(hom.types, inner, outer)


def externalize(phi: WiringDiagram, ys: Sequence[Star], z: Star) -> WiringDiagram:
    """``extl: O(X; [Y ⇒ Z]) → O(X, Y; Z)``.

    This equals ``evaluation(ys, z).compose([phi, id_Y₁, …, id_Yₙ])``, which is
    the definition in the paper. It is computed directly in O(size), by moving
    the ``Yᵢ`` part of ``g`` into ``f``.
    """
    hom = internal_hom(ys, z)
    if phi.outer != hom:
        raise WiringError("hom_mismatch", f"outer star {phi.outer!r} is not [Y ⇒ Z] = {hom!r}")
    g = phi.outer_wiring()
    inner = [phi.inner_wiring(i) for i in range(phi.arity)]
    inner += [{a: g[hom_wire(i, a)] for a in y.names} for i, y in enumerate(ys)]
    outer = {b: g[hom_wire(None, b)] for b in z.names}
    return WiringDiagram(phi.cables, inner, outer)


def internalize(psi: WiringDiagram, m: int) -> WiringDiagram:
    """``intl: O(X₁..Xₘ, Y₁..Yₙ; Z) → O(X₁..Xₘ; [Y ⇒ Z])``, the inverse of :func:`externalize`.

    The first ``m`` inner stars of ``psi`` stay inner. The remaining ones become
    the ``Y`` part of the outer star.
    """
    if not 0 <= m <= psi.arity:
        raise WiringError("split_out_of_range", f"cannot split {psi.arity} inner stars at {m}")
    inner = [psi.inner_wiring(i) for i in range(m)]
    outer = {
        hom_wire(i, a): c for i in range(psi.arity - m) for a, c in psi.inner_wiring(m + i).items()
    }
    outer.update({hom_wire(None, b): c for b, c in psi.outer_wiring().items()})
    return WiringDiagram(psi.cables, inner, outer)
