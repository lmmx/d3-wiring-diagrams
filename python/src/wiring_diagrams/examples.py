"""The worked examples of Spivak (arXiv:1305.0297), built with this package.

Each function returns an :class:`Example`: a term (a tree of diagrams with
labels) and, where the paper uses one, the data for the relational algebra.
The leaf relations line up with the inner stars of ``term.evaluate()``.
``scripts/generate.py`` writes these to ``spec/examples/*.json``, which the
Rust and JS test suites and the viewer read.
"""

from __future__ import annotations

from collections.abc import Callable, Hashable, Mapping
from dataclasses import dataclass, field
from typing import Any

from . import rel
from .closed import hom_wire, internal_hom
from .diagram import WiringDiagram
from .rel import Domains, Relation
from .star import Star
from .term import Term

__all__ = ["ALL", "Example"]


@dataclass(frozen=True)
class Example:
    slug: str
    title: str
    source: str
    description: str
    term: Term
    domains: Mapping[str, list[Hashable]] = field(default_factory=dict)
    relations: list[Relation] | None = None
    recursive: bool = False

    def expected(self) -> Relation | None:
        """The outer relation, computed with :mod:`.rel`."""
        if self.relations is None:
            return None
        phi = self.term.evaluate()
        if self.recursive:
            z = _recursive_star(phi)
            return rel.recursive(phi, self.relations, z, self.domains)
        return rel.apply(phi, self.relations, self.domains)

    def to_json(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "title": self.title,
            "source": self.source,
            "description": self.description,
            "term": self.term.to_json(),
        }
        if self.relations is not None:
            expected = self.expected()
            assert expected is not None
            data["algebra"] = {
                "kind": "rel_recursive" if self.recursive else "rel",
                "domains": {t: list(v) for t, v in sorted(self.domains.items())},
                "relations": [r.to_json() for r in self.relations],
                "expected": expected.to_json(),
            }
        return data


def _recursive_star(phi: WiringDiagram) -> Star:
    """Recover ``Z`` from an outer star ``[Z ⇒ Z]`` (wires named ``out.*``)."""
    return Star({n.removeprefix("out."): t for n, t in phi.outer if n.startswith("out.")})


def _wd(cables: list[str], inner: list[dict[str, int]], outer: dict[str, int]) -> WiringDiagram:
    return WiringDiagram(cables, inner, outer)


def _pred(star: Star, domains: Domains, p: Callable[[dict[str, Any]], bool]) -> Relation:
    return Relation.from_predicate(star, domains, p)


# -- Example 2.2.11: digital circuits from NAND -----------------------------------

BOOL: dict[str, list[Hashable]] = {"Bool": [False, True]}
GATE = Star({"A": "Bool", "B": "Bool", "out": "Bool"})
UNARY = Star({"in": "Bool", "out": "Bool"})


def _nand() -> Relation:
    return _pred(GATE, BOOL, lambda r: r["out"] == (not (r["A"] and r["B"])))


def _not_term() -> Term:
    # {A, B, out} --f--> {in, out} <--id-- {in, out}, with f(A) = f(B) = in
    phi = _wd(["Bool", "Bool"], [{"A": 0, "B": 0, "out": 1}], {"in": 0, "out": 1})
    return Term(phi, labels=["NAND"], label="NOT")


def not_from_nand() -> Example:
    return Example(
        "not-from-nand",
        "NOT from NAND",
        "Spivak, Example 2.2.11",
        "Soldering both inputs of a NAND gate onto one cable gives NOT. "
        "Rel(φ)(NAND) is the NOT relation.",
        _not_term(),
        BOOL,
        [_nand()],
    )


def _and_term() -> Term:
    # out = NOT(NAND(A, B))
    phi = _wd(
        ["Bool"] * 4,
        [{"A": 0, "B": 1, "out": 2}, {"in": 2, "out": 3}],
        {"A": 0, "B": 1, "out": 3},
    )
    return Term(phi, [None, _not_term()], ["NAND", "NOT"], label="AND")


def _xor_term() -> Term:
    # m = NAND(A,B); p = NAND(A,m); q = NAND(B,m); out = NAND(p,q)
    a, b, m, p, q, out = range(6)
    phi = _wd(
        ["Bool"] * 6,
        [
            {"A": a, "B": b, "out": m},
            {"A": a, "B": m, "out": p},
            {"A": b, "B": m, "out": q},
            {"A": p, "B": q, "out": out},
        ],
        {"A": a, "B": b, "out": out},
    )
    return Term(phi, labels=["NAND"] * 4, label="XOR")


def half_adder() -> Example:
    a, b, s, c = range(4)
    phi = _wd(
        ["Bool"] * 4,
        [{"A": a, "B": b, "out": s}, {"A": a, "B": b, "out": c}],
        {"a": a, "b": b, "carry": c, "sum": s},
    )
    term = Term(phi, [_xor_term(), _and_term()], ["XOR", "AND"], label="half adder")
    leaves = len(term.leaf_labels())
    return Example(
        "half-adder",
        "Half adder from NAND gates",
        'Spivak, Example 2.2.11 ("one can form relations AND, OR, etc. ... half adders")',
        "XOR and AND are each built from NAND gates and then wired into a half adder. "
        "The term is three levels deep. Its composite has only NAND stars and the "
        "same relation as the nested picture (associativity).",
        term,
        BOOL,
        [_nand()] * leaves,
    )


# -- Example 2.2.12: the three queries ---------------------------------------------

N9: dict[str, list[Hashable]] = {"N": list(range(10))}
XYZ = Star({"X": "N", "Y": "N", "Z": "N"})


def _product() -> Relation:
    return _pred(XYZ, N9, lambda r: r["X"] * r["Y"] == r["Z"])


def query_product_nine() -> Example:
    phi = _wd(["N"] * 3, [{"X": 0, "Y": 1, "Z": 2}, {"Z": 2}], {"X": 0, "Y": 1})
    return Example(
        "query-product-nine",
        "Which X, Y have X·Y = 9?",
        "Spivak, Example 2.2.12 (φ₁)",
        "R₁ = {X·Y = Z} and R₂ = {Z = 9} share the cable Z. The outer star "
        "keeps X and Y. Domain: 0..9.",
        Term(phi, labels=["X·Y=Z", "Z=9"], label="φ₁"),
        N9,
        [_product(), _pred(Star({"Z": "N"}), N9, lambda r: r["Z"] == 9)],
    )


def query_projection() -> Example:
    phi = _wd(["N"] * 3, [{"X": 0, "Y": 1, "Z": 2}], {"X": 0, "Z": 2})
    return Example(
        "query-projection",
        "Which X, Z have X·Y = Z for some Y?",
        "Spivak, Example 2.2.12 (φ₂)",
        "The cable Y touches no outer wire, so it is projected away "
        "(existentially quantified). Domain: 0..9.",
        Term(phi, labels=["X·Y=Z"], label="φ₂"),
        N9,
        [_product()],
    )


def query_squares() -> Example:
    phi = _wd(["N"] * 2, [{"X": 0, "Y": 0, "Z": 1}], {"Z": 1})
    return Example(
        "query-squares",
        "Which Z are squares?",
        "Spivak, Example 2.2.12 (φ₃)",
        "X and Y are soldered onto one cable XY, which forces X = Y. Only Z is kept. Domain: 0..9.",
        Term(phi, labels=["X·Y=Z"], label="φ₃"),
        N9,
        [_product()],
    )


# -- Example 4.2.1: an SQL query -------------------------------------------------

SCHOOL: dict[str, list[Hashable]] = {
    "Student": ["ada", "bob", "cy", "dee"],
    "Course": ["logic", "music"],
    "Gender": ["female", "male"],
    "Address": ["1 Elm St", "2 Oak Ave", "3 Pine Rd", "4 Ash Ct"],
}
ATTENDS = Star({"student": "Student", "course": "Course"})
GENDER = Star({"student": "Student", "gender": "Gender"})
LIVES = Star({"student": "Student", "address": "Address"})
CONST = Star({"gender": "Gender"})


def sql_query() -> Example:
    s1, s2, course, gm, gf, addr = range(6)
    phi = _wd(
        ["Student", "Student", "Course", "Gender", "Gender", "Address"],
        [
            {"student": s1, "course": course},  # a1
            {"student": s1, "gender": gm},  # g1
            {"student": s2, "course": course},  # a2
            {"student": s2, "gender": gf},  # g2
            {"student": s1, "address": addr},  # L
            {"gender": gm},  # 'male'
            {"gender": gf},  # 'female'
        ],
        {"student": s1, "address": addr},
    )
    attends = Relation.from_records(
        ATTENDS,
        [
            {"student": "ada", "course": "logic"},
            {"student": "bob", "course": "logic"},
            {"student": "cy", "course": "music"},
            {"student": "dee", "course": "music"},
            {"student": "dee", "course": "logic"},
        ],
    )
    gender = Relation.from_records(
        GENDER,
        [
            {"student": "ada", "gender": "female"},
            {"student": "bob", "gender": "male"},
            {"student": "cy", "gender": "male"},
            {"student": "dee", "gender": "female"},
        ],
    )
    lives = Relation.from_records(
        LIVES,
        [
            {"student": s, "address": a}
            for s, a in zip(SCHOOL["Student"], SCHOOL["Address"], strict=True)
        ],
    )
    male = Relation(CONST, [("male",)])
    female = Relation(CONST, [("female",)])
    return Example(
        "sql-query",
        "Male students sharing a course with a female student",
        "Spivak, Example 4.2.1",
        "SELECT L.student, L.address FROM attends a1, gender g1, attends a2, "
        "gender g2, lives L WHERE a1.student=g1.student AND a2.student=g2.student "
        "AND L.student=g1.student AND a1.course=a2.course AND g1.gender='male' "
        "AND g2.gender='female'. The five tables and two constants are inner "
        "stars, the WHERE clause is the cabling, and the SELECT list is the outer "
        "star.",
        Term(
            phi,
            labels=[
                "attends a1",
                "gender g1",
                "attends a2",
                "gender g2",
                "lives L",
                "'male'",
                "'female'",
            ],
            label="query",
        ),
        SCHOOL,
        [attends, gender, attends, gender, lives, male, female],
    )


# -- Example 4.2.2: a non-conjunctive query ----------------------------------------

S3: dict[str, list[Hashable]] = {"S": ["s₁", "s₂", "s₃"]}


def exists_query() -> Example:
    phi = _wd(["S", "S"], [{"x": 0}], {"y": 1})
    return Example(
        "exists",
        "y. ∃x. R(x)",
        "Spivak, Example 4.2.2",
        "The outer wire y is soldered onto a cable that no inner wire touches, so "
        "it ranges over its whole domain. The answer is all of S if R is non-empty "
        "and nothing otherwise. The output is not a projection of R, so this "
        "query is not conjunctive.",
        Term(phi, labels=["R"], label="∃"),
        S3,
        [Relation(Star({"x": "S"}), [("s₂",)])],
    )


# -- Example 5.2.1: recursion (factorial) -----------------------------------------

N24: dict[str, list[Hashable]] = {"N": list(range(25))}
F = Star({"A": "N", "B": "N"})


def factorial() -> Example:
    # cables A, A', B, B', C; [F ⇒ F] = {0.A: A', 0.B: B', out.A: A, out.B: B}
    a, a1, b, b1, c = range(5)
    phi = _wd(
        ["N"] * 5,
        [
            {"A": a, "A'": a1},  # decrement
            {"A": a, "B'": b1, "C": c},  # multiplication
            {"A": a, "C": c, "B": b},  # conditional
        ],
        {
            hom_wire(0, "A"): a1,
            hom_wire(0, "B"): b1,
            hom_wire(None, "A"): a,
            hom_wire(None, "B"): b,
        },
    )
    assert phi.outer == internal_hom([F], F)
    dom = N24
    dec = _pred(phi.inner[0], dom, lambda r: r["A'"] == max(r["A"] - 1, 0))
    mul = _pred(phi.inner[1], dom, lambda r: r["C"] == r["A"] * r["B'"])
    cond = _pred(phi.inner[2], dom, lambda r: r["B"] == (1 if r["A"] == 0 else r["C"]))
    return Example(
        "factorial",
        "Factorial as a recursive relation",
        "Spivak, Example 5.2.1",
        "φ: X₁, X₂, X₃ → [F ⇒ F] with F = {A, B}. The 0.* wires of the outer "
        "star are the slot that the relation is plugged back into. The greatest "
        "fixed point of q = Rel(ev)(Rel(φ)(dec, mul, cond), -) on N ≤ 24 is "
        "B = A! (for A ≤ 4, the factorials that fit in the domain).",
        Term(phi, labels=["decrement", "multiply", "conditional"], label="[F ⇒ F]"),
        dom,
        [dec, mul, cond],
        recursive=True,
    )


# -- The anatomy of a diagram (no algebra) ----------------------------------------


def anatomy() -> Example:
    """Every kind of cable: shared, through, dangling, self-loop, floating."""
    phi = _wd(
        ["Bool", "N", "N", "Bool", "N", "Bool", "N"],
        [
            {"p": 0, "q": 1, "r": 2},
            {"s": 1, "t": 3, "u": 3},  # t, u: a self-loop on one star
            {"v": 2, "w": 1, "x": 4},  # x: a dangling cable
        ],
        {"a": 0, "b": 2, "c": 5},  # c: an outer wire on its own cable
    )
    return Example(
        "anatomy",
        "Anatomy of a typed wiring diagram",
        "Spivak, Example 2.1.7 / Figure 6",
        "Three inner stars inside an outer star. One cable is soldered to three "
        "wires, one is a self-loop on a single star, one dangles from an inner "
        "wire, one runs straight to the outer star, and one is floating (soldered "
        "to nothing). Wire colours are types.",
        Term(phi, labels=["X₁", "X₂", "X₃"], label="Y"),
    )


ALL: list[Callable[[], Example]] = [
    anatomy,
    not_from_nand,
    half_adder,
    query_product_nine,
    query_projection,
    query_squares,
    sql_query,
    exists_query,
    factorial,
]
