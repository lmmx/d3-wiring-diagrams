"""The workloads of rust/benches/operad.rs, timed in Python.

    python benchmarks/bench.py

Reports the median of several runs (time.perf_counter). The numbers are in
docs/performance.md.
"""

from __future__ import annotations

import json
import statistics
import time
from collections.abc import Callable

from wiring_diagrams import Star, WiringDiagram, rel


def ring(n: int) -> WiringDiagram:
    inner = [{"l": i, "r": (i + 1) % n, "o": n + i} for i in range(n)]
    outer = {f"o{i:06}": n + i for i in range(n)}
    return WiringDiagram(["A"] * (2 * n), inner, outer)


def chain(m: int) -> WiringDiagram:
    inner = [{"l": i, "r": i + 1, "o": m + 1 + i} for i in range(m)]
    return WiringDiagram(["A"] * (2 * m + 1), inner, {"l": 0, "r": m, "o": m + 1})


def timed(f: Callable[..., object], *args: object, repeat: int = 7) -> float:
    """Median wall time of ``f(*args)``."""
    runs = []
    for _ in range(repeat):
        t = time.perf_counter()
        f(*args)
        runs.append(time.perf_counter() - t)
    return statistics.median(runs)


def main() -> None:
    rows: list[tuple[str, float]] = []
    for n in (100, 1_000, 10_000):
        outer, kids = ring(n), [chain(8)] * n
        rows.append((f"compose/ring_of_chains/{n}", timed(outer.compose, kids)))
    outer, kid = ring(10_000), chain(8)
    rows.append(("compose/compose_at/10000", timed(outer.compose_at, 5_000, kid)))
    for n in (1_000, 10_000):
        phi = ring(n)
        text = json.dumps(phi.to_json())
        rows.append(
            (
                f"canonical/from_json/{n}",
                timed(lambda s: WiringDiagram.from_json(json.loads(s)), text),
            )
        )
        sigma = list(range(n))[::-1]
        rows.append((f"canonical/permute/{n}", timed(phi.permute, sigma)))
    for m, d in ((8, 64), (32, 64), (8, 512)):
        star = Star({"l": "N", "r": "N"})
        succ = rel.Relation(star, [(x, (x + 1) % d) for x in range(d)])
        phi = WiringDiagram(
            ["N"] * (m + 1), [{"l": i, "r": i + 1} for i in range(m)], {"a": 0, "b": m}
        )
        doms = {"N": list(range(d))}
        rows.append((f"rel/path/m={m}/d={d}", timed(rel.apply, phi, [succ] * m, doms)))
    for name, secs in rows:
        print(f"{name:32} {secs * 1e3:10.3f} ms")


if __name__ == "__main__":
    main()
