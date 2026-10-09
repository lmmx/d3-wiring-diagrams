"""Write spec/examples/*.json and spec/conformance/*.json from the Python reference.

    python scripts/generate.py           # rewrite the files
    python scripts/generate.py --check   # exit 1 if any file is out of date

The Rust and JS test suites read these files and must reproduce every
``expected`` value and every error ``kind``. Random cases use only
``random.Random.random()``, the one generator output CPython promises to keep
stable across versions, so the files are byte-for-byte reproducible.
"""

from __future__ import annotations

import argparse
import itertools
import json
import random
import sys
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

from wiring_diagrams import (
    Star,
    WiringDiagram,
    WiringError,
    eq,
    evaluation,
    examples,
    externalize,
    internal_hom,
    internalize,
    rel,
)

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "spec"

TYPES = ("A", "B")
NAMES = ("a", "b", "c", "d", "é", "😀")
DOMAINS: dict[str, list[Any]] = {"A": [0, 1], "B": ["x", "y", "z"]}


class Gen:
    """Random stars and diagrams, using only ``Random.random()``."""

    def __init__(self, seed: int) -> None:
        self.rng = random.Random(seed)

    def below(self, n: int) -> int:
        return int(self.rng.random() * n)

    def coin(self) -> bool:
        return self.rng.random() < 0.5

    def pick(self, xs: tuple[str, ...] | list[Any]) -> Any:
        return xs[self.below(len(xs))]

    def shuffle(self, n: int) -> list[int]:
        xs = list(range(n))
        for i in range(n - 1, 0, -1):
            j = self.below(i + 1)
            xs[i], xs[j] = xs[j], xs[i]
        return xs

    def star(self, max_wires: int = 3) -> Star:
        names = [n for n in NAMES if self.rng.random() < max_wires / len(NAMES)]
        return Star({n: self.pick(TYPES) for n in names})

    def diagram(
        self, inner: list[Star] | None = None, outer: Star | None = None, max_arity: int = 3
    ) -> WiringDiagram:
        if inner is None:
            inner = [self.star() for _ in range(self.below(max_arity + 1))]
        if outer is None:
            outer = self.star()
        cables: list[str] = []

        def solder(typ: str) -> int:
            same = [c for c, t in enumerate(cables) if t == typ]
            if same and self.coin():
                return int(self.pick(same))
            cables.append(typ)
            return len(cables) - 1

        inner_maps = [{n: solder(t) for n, t in x} for x in inner]
        outer_map = {n: solder(t) for n, t in outer}
        cables += [self.pick(TYPES) for _ in range(self.below(3))]
        return WiringDiagram(cables, inner_maps, outer_map)

    def scrambled(self, phi: WiringDiagram) -> dict[str, Any]:
        """The JSON of ``phi`` with its cables renumbered at random (not canonical)."""
        perm = self.shuffle(len(phi.cables))  # new index -> old index
        inv = {old: new for new, old in enumerate(perm)}
        data = phi.to_json()
        return {
            "cables": [phi.cables[p] for p in perm],
            "inner": [{n: inv[c] for n, c in m.items()} for m in data["inner"]],
            "outer": {n: inv[c] for n, c in data["outer"].items()},
        }

    def relation(self, star: Star) -> rel.Relation:
        universe = list(itertools.product(*(DOMAINS[t] for t in star.types)))
        return rel.Relation(star, [self.pick(universe) for _ in range(self.below(6))] if universe else [])

    def partition(self, star: Star) -> eq.Partition:
        return eq.Partition(star, [self.below(3) for _ in range(len(star))])


def outcome(f: Callable[[], Any]) -> dict[str, Any]:
    try:
        return {"expected": f()}
    except WiringError as e:
        return {"error": e.kind}


def rows_json(r: rel.Relation) -> dict[str, Any]:
    return r.to_json()


# -- case families --------------------------------------------------------------------


def stars() -> Iterator[dict[str, Any]]:
    for wires in [
        {"b": "A", "a": "B"},
        {"😀": "A", "b": "A", "￿": "B", "é": "A", "Z": "B", "": "A"},
        {"a.b": "A", "a": "A", "a-": "A", "A": "A"},
    ]:
        yield {"wires": wires, "expected": list(Star(wires).names)}


def canonical() -> Iterator[dict[str, Any]]:
    g = Gen(1)
    for _ in range(100):
        phi = g.diagram()
        yield {"input": g.scrambled(phi), "expected": phi.to_json()}
    for bad in [
        {"cables": ["A"], "inner": [{"x": 1}], "outer": {}},
        {"cables": ["A"], "inner": [], "outer": {"x": -1}},
        {"cables": [], "inner": [], "outer": {"x": 0}},
    ]:
        yield {"input": bad, "error": "cable_out_of_range"}
    for bad in [
        {"cables": ["A"], "inner": [], "outer": {"x": True}},
        {"cables": ["A"], "inner": [], "outer": {"x": 0.5}},
        {"cables": [0], "inner": [], "outer": {}},
        {"cables": ["A"], "inner": {}, "outer": {}},
        {"cables": ["A"], "inner": []},
        {"cables": ["A"], "inner": [], "outer": {}, "extra": 0},
        [],
    ]:
        yield {"input": bad, "error": "invalid_json"}


def identity() -> Iterator[dict[str, Any]]:
    g = Gen(2)
    for _ in range(20):
        x = g.star()
        yield {"star": x.to_json(), "expected": WiringDiagram.identity(x).to_json()}


def compose() -> Iterator[dict[str, Any]]:
    g = Gen(3)
    for _ in range(200):
        phi = g.diagram()
        kids = [g.diagram(outer=x) for x in phi.inner]
        yield {
            "diagram": phi.to_json(),
            "children": [k.to_json() for k in kids],
            "expected": phi.compose(kids).to_json(),
        }
    phi = g.diagram(inner=[Star({"a": "A"}), Star({"b": "B"})])
    good = [g.diagram(outer=x) for x in phi.inner]
    yield {
        "diagram": phi.to_json(),
        "children": [good[0].to_json()],
        "error": "arity_mismatch",
    }
    wrong_type = g.diagram(outer=Star({"a": "B"}))
    wrong_name = g.diagram(outer=Star({"z": "A"}))
    for bad in (wrong_type, wrong_name):
        yield {
            "diagram": phi.to_json(),
            "children": [bad.to_json(), good[1].to_json()],
            "error": "star_mismatch",
        }


def permute() -> Iterator[dict[str, Any]]:
    g = Gen(4)
    for _ in range(50):
        phi = g.diagram(max_arity=4)
        sigma = g.shuffle(phi.arity)
        yield {"diagram": phi.to_json(), "sigma": sigma, "expected": phi.permute(sigma).to_json()}
    phi = g.diagram(inner=[Star({"a": "A"}), Star({})])
    for sigma in ([0], [0, 0], [1, 2]):
        yield {"diagram": phi.to_json(), "sigma": sigma, "error": "not_a_permutation"}


def map_types() -> Iterator[dict[str, Any]]:
    g = Gen(5)
    for mapping in ({"A": "*", "B": "*"}, {"A": "B", "B": "A"}, {"A": "A", "B": "A"}):
        for _ in range(10):
            phi = g.diagram()
            yield {
                "diagram": phi.to_json(),
                "mapping": mapping,
                "expected": phi.map_types(mapping.__getitem__).to_json(),
            }


def closed() -> Iterator[dict[str, Any]]:
    g = Gen(6)
    for _ in range(30):
        ys = [g.star() for _ in range(g.below(3))]
        z = g.star()
        yield {
            "op": "internal_hom",
            "ys": [y.to_json() for y in ys],
            "z": z.to_json(),
            "expected": internal_hom(ys, z).to_json(),
        }
        yield {
            "op": "evaluation",
            "ys": [y.to_json() for y in ys],
            "z": z.to_json(),
            "expected": evaluation(ys, z).to_json(),
        }
    for _ in range(40):
        psi = g.diagram(max_arity=4)
        m = g.below(psi.arity + 1)
        curried = internalize(psi, m)
        yield {"op": "internalize", "diagram": psi.to_json(), "m": m, "expected": curried.to_json()}
        ys = [y.to_json() for y in psi.inner[m:]]
        yield {
            "op": "externalize",
            "diagram": curried.to_json(),
            "ys": ys,
            "z": psi.outer.to_json(),
            "expected": psi.to_json(),
        }
    psi = g.diagram(inner=[Star({"a": "A"})])
    yield {"op": "internalize", "diagram": psi.to_json(), "m": 2, "error": "split_out_of_range"}
    yield {
        "op": "externalize",
        "diagram": psi.to_json(),
        "ys": [{"q": "A"}],
        "z": psi.outer.to_json(),
        "error": "hom_mismatch",
    }


def rel_cases() -> Iterator[dict[str, Any]]:
    g = Gen(7)
    for _ in range(200):
        phi = g.diagram()
        rs = [g.relation(x) for x in phi.inner]
        yield {
            "diagram": phi.to_json(),
            "relations": [rows_json(r) for r in rs],
            "domains": DOMAINS,
            **outcome(lambda phi=phi, rs=rs: rows_json(rel.apply(phi, rs, DOMAINS))),  # type: ignore[misc]
        }
    phi = WiringDiagram(["A", "B"], [{"a": 0}], {"o": 1})
    r = rel.Relation(phi.inner[0], [(0,)])
    yield {
        "diagram": phi.to_json(),
        "relations": [rows_json(r)],
        "domains": {"A": [0, 1]},
        "error": "missing_domain",
    }
    yield {
        "diagram": phi.to_json(),
        "relations": [],
        "domains": DOMAINS,
        "error": "arity_mismatch",
    }
    yield {
        "diagram": phi.to_json(),
        "relations": [{"wires": ["b"], "rows": [[0]]}],
        "domains": DOMAINS,
        "error": "star_mismatch",
    }
    yield {
        "diagram": phi.to_json(),
        "relations": [{"wires": ["a"], "rows": [[0, 1]]}],
        "domains": DOMAINS,
        "error": "relation_arity",
    }


def eq_cases() -> Iterator[dict[str, Any]]:
    g = Gen(8)
    for _ in range(100):
        phi = g.diagram()
        ps = [g.partition(x) for x in phi.inner]
        yield {
            "diagram": phi.to_json(),
            "partitions": [list(p.blocks) for p in ps],
            "expected": list(eq.apply(phi, ps).blocks),
        }
    phi = WiringDiagram(["A"], [{"a": 0, "b": 0}], {"o": 0})
    for bad in ([0], [0, -1], [0, 0, 0]):
        yield {"diagram": phi.to_json(), "partitions": [bad], "error": "invalid_partition"}


FAMILIES: dict[str, Callable[[], Iterator[dict[str, Any]]]] = {
    "stars": stars,
    "canonical": canonical,
    "identity": identity,
    "compose": compose,
    "permute": permute,
    "map_types": map_types,
    "closed": closed,
    "rel": rel_cases,
    "eq": eq_cases,
}


def dump_cases(cases: list[dict[str, Any]]) -> str:
    """One case per line: small diffs, and still valid JSON."""
    lines = [json.dumps(c, ensure_ascii=False, separators=(",", ":")) for c in cases]
    return '{"cases": [\n' + ",\n".join(lines) + "\n]}\n"


def pretty(obj: Any, depth: int = 0) -> str:
    """Indented JSON, except that containers of scalars (rows, wirings) stay on one line."""
    pad, inner = " " * depth, " " * (depth + 1)
    if isinstance(obj, dict) and any(isinstance(v, (dict, list)) for v in obj.values()):
        items = [f"{inner}{json.dumps(k, ensure_ascii=False)}: {pretty(v, depth + 1)}" for k, v in obj.items()]
        return "{\n" + ",\n".join(items) + "\n" + pad + "}"
    if isinstance(obj, list) and any(isinstance(v, (dict, list)) for v in obj):
        return "[\n" + ",\n".join(inner + pretty(v, depth + 1) for v in obj) + "\n" + pad + "]"
    return json.dumps(obj, ensure_ascii=False)


def outputs() -> dict[Path, str]:
    out: dict[Path, str] = {}
    for name, family in FAMILIES.items():
        out[SPEC / "conformance" / f"{name}.json"] = dump_cases(list(family()))
    index = []
    for make in examples.ALL:
        ex = make()
        out[SPEC / "examples" / f"{ex.slug}.json"] = pretty(ex.to_json()) + "\n"
        index.append({"slug": ex.slug, "title": ex.title, "source": ex.source})
    out[SPEC / "examples" / "index.json"] = pretty(index) + "\n"
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="fail if any file is stale")
    args = parser.parse_args()
    stale = []
    for path, text in outputs().items():
        current = path.read_text(encoding="utf-8") if path.exists() else None
        if current == text:
            continue
        stale.append(path.relative_to(ROOT))
        if not args.check:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
    verb = "stale" if args.check else "written"
    for p in stale:
        print(f"{verb}: {p}")
    return 1 if args.check and stale else 0


if __name__ == "__main__":
    sys.exit(main())
