"""The single error type raised by this package.

Every failure carries a machine-readable ``kind``. The same kinds are used by the
Rust and JavaScript implementations (see ``docs/format.md``), and the
conformance suite checks them.
"""

from __future__ import annotations

from typing import Literal

__all__ = ["ErrorKind", "WiringError"]

ErrorKind = Literal[
    "duplicate_wire",
    "cable_out_of_range",
    "arity_mismatch",
    "star_mismatch",
    "not_a_permutation",
    "hom_mismatch",
    "split_out_of_range",
    "relation_arity",
    "missing_domain",
    "invalid_partition",
    "invalid_json",
]


class WiringError(ValueError):
    """Raised when an operation is given ill-formed or non-composable input."""

    kind: ErrorKind

    def __init__(self, kind: ErrorKind, message: str) -> None:
        super().__init__(f"{kind}: {message}")
        self.kind = kind
