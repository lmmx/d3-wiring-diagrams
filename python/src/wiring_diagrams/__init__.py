"""The operad of wiring diagrams (Spivak, arXiv:1305.0297).

* :class:`Star`: objects (typed stars)
* :class:`WiringDiagram`: morphisms (typed cospans up to isomorphism), with
  ``identity``, ``compose``, ``compose_at``, ``permute`` and ``map_types``
* :mod:`.closed`: internal hom, evaluation, (ex/in)ternalization
* :mod:`.rel`: the relational algebra, including recursion
* :mod:`.eq`: the algebra of equivalence relations
* :class:`Term`: trees of diagrams, with presentation labels
"""

from . import closed, eq, rel
from .closed import evaluation, externalize, internal_hom, internalize
from .diagram import WiringDiagram
from .errors import ErrorKind, WiringError
from .star import Star
from .term import Term

__all__ = [
    "ErrorKind",
    "Star",
    "Term",
    "WiringDiagram",
    "WiringError",
    "closed",
    "eq",
    "evaluation",
    "externalize",
    "internal_hom",
    "internalize",
    "rel",
]
