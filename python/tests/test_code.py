"""Wiring diagrams of Python code (wiring_diagrams.code)."""

from __future__ import annotations

import doctest
import importlib.util
import io
import json
import sysconfig
from contextlib import redirect_stdout
from pathlib import Path

import pytest

from wiring_diagrams import Term
from wiring_diagrams.code import document, main, scan_path, scan_source, scan_spans

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = ROOT / "python" / "src" / "wiring_diagrams"
PROGRAMS = ROOT / "examples" / "python"
SCANNED = sorted((ROOT / "spec" / "examples").glob("code-*.json"))


def program(name: str) -> str:
    return (PROGRAMS / name).read_text(encoding="utf-8")


POC_MODULE = program("module.py")
HYPOT = program("hypot.py")
MEAN = program("mean.py")


def wiring(t: Term, i: int) -> dict[str, int]:
    return t.diagram.inner_wiring(i)


def test_module_is_a_star_of_definitions() -> None:
    t = scan_source(POC_MODULE, name="module.py")
    assert t.label == "module.py"
    assert t.labels == ("bar", "class Foo")
    assert t.diagram.outer.names == ()
    foo = t.children[1]
    assert foo is not None
    assert foo.labels == ("Foo.sum", "Foo.__init__", "Foo.from_xy", "Foo.xsq")
    # a method star's wires are its parameters and return
    assert foo.diagram.inner[0].names == ("return", "self", "x", "y")


def test_function_body_is_dataflow() -> None:
    t = scan_source("def f(a, b):\n    c = a + b\n    return c * a\n", function="f")
    phi = t.diagram
    assert phi.outer.names == ("a", "b", "return")
    assert t.labels == ("+", "*", "return")
    plus, times, ret = (wiring(t, i) for i in range(3))
    out = phi.outer_wiring()
    assert plus["0"] == out["a"] and plus["1"] == out["b"]
    assert times["0"] == plus["return"] and times["1"] == out["a"]  # c, then a again
    assert ret["0"] == times["return"] and ret["return"] == out["return"]


def test_calls_into_the_module_have_the_callee_star_and_expand_by_composition() -> None:
    flat = scan_source(HYPOT, function="hypot")
    expanded = scan_source(HYPOT, function="hypot", expand=1)
    square = scan_source(HYPOT, function="square")
    assert flat.labels.count("square") == 2
    assert all(k is None for k in flat.children)
    for i, label in enumerate(expanded.labels):
        kid = expanded.children[i]
        if label == "square":
            assert kid is not None and kid.diagram == square.diagram
    # inlining = composing the call stars with the callee's body
    inlined = expanded.evaluate()
    assert "square" not in Term(inlined).leaf_labels()
    assert inlined == flat.diagram.compose(
        [
            square.diagram if label == "square" else _id(flat, i)
            for i, label in enumerate(flat.labels)
        ]
    )


def _id(t: Term, i: int):  # type: ignore[no-untyped-def]
    from wiring_diagrams import WiringDiagram

    return WiringDiagram.identity(t.diagram.inner[i])


def test_arguments_bind_like_python() -> None:
    src = "def g(x, y=2, *, z=3):\n    return x\n\ndef f(a):\n    return g(a, z=a)\n"
    t = scan_source(src, function="f")
    call = wiring(t, 0)
    assert t.labels[0] == "g"
    assert set(call) == {"x", "y", "z", "return"}
    out = t.diagram.outer_wiring()
    assert call["x"] == call["z"] == out["a"]
    # y is left to its default: a cable nothing else touches
    assert sum(call["y"] in t.diagram.inner_cables[i] for i in range(t.diagram.arity)) == 1


def test_unbindable_and_unknown_calls_use_positions() -> None:
    src = "def g(x):\n    return x\n\ndef f(a, b):\n    print(a, sep=b)\n    return g(a, b, b)\n"
    t = scan_source(src, function="f")
    assert set(wiring(t, 0)) == {"0", "sep", "return"}  # print
    assert t.labels[1] == "g" and set(wiring(t, 1)) == {"0", "1", "2", "return"}  # too many args


def test_recursion_is_not_expanded_forever() -> None:
    src = "def f(n):\n    return f(n - 1) if n else 0\n"
    t = scan_source(src, function="f", expand=5)
    assert "f" in t.labels
    assert all(k is None for k in t.children)


def test_loops_carry_reads_and_writes() -> None:
    t = scan_source(MEAN, function="mean_positive")
    i = t.labels.index("for x in xs")
    assert set(wiring(t, i)) == {"in", "total", "count", "total'", "count'"}
    loop = t.children[i]
    assert loop is not None
    body = loop.children[loop.labels.index("body")]
    assert body is not None
    assert "if x > 0" in body.labels


def test_structural_wire_names_never_collide_with_variables() -> None:
    src = (
        "def f(test, iter, item, x):\n"
        "    for x in iter:\n"
        "        if test:\n"
        "            item = x\n"
        "    return item\n"
    )
    t = scan_source(src, function="f")  # Star raises duplicate_wire on a collision
    # the iterable is evaluated outside (wire `in`); `x` inside is the loop's, not the parameter
    assert set(wiring(t, t.labels.index("for x in iter"))) == {"in", "test", "item'"}


def test_compound_statements_scan() -> None:
    src = (
        "def f(xs, path):\n"
        "    with open(path) as fh:\n"
        "        data = fh.read()\n"
        "    try:\n"
        "        n = int(data)\n"
        "    except ValueError as e:\n"
        "        n = 0\n"
        "    while n > 0:\n"
        "        n -= 1\n"
        "    match xs:\n"
        "        case [a, *rest]:\n"
        "            return a, rest, n\n"
        "        case _:\n"
        "            return [y async for y in xs] if n else {k: v for k, v in xs}\n"
    )
    t = scan_source(src, function="f")
    kinds = [label.split()[0] for label in t.labels]
    assert [k for k in kinds if k in {"with", "try", "while", "match"}] == [
        "with",
        "try",
        "while",
        "match",
    ]


def test_unknown_function_and_bad_syntax() -> None:
    with pytest.raises(KeyError):
        scan_source("def f(): pass\n", function="g")
    with pytest.raises(SyntaxError):
        scan_source("def f(:\n")


def test_scans_are_deterministic() -> None:
    a = scan_source(POC_MODULE, expand=2).to_json()
    assert a == scan_source(POC_MODULE, expand=2).to_json()


def test_scans_this_package_and_part_of_the_standard_library() -> None:
    assert scan_path(PACKAGE, expand=1).label == "wiring_diagrams/"
    stdlib = Path(sysconfig.get_paths()["stdlib"])
    for package in ("json", "email", "asyncio"):
        assert scan_path(stdlib / package, expand=1).diagram.arity > 0


def test_loop_bodies_output_what_the_next_iteration_reads() -> None:
    t = scan_source(program("fibonacci.py"), function="fib")
    loop = t.children[t.labels.index("for _ in range(n)")]
    assert loop is not None
    # b is only read by the next iteration: the body outputs b', the loop does not
    assert set(wiring(t, t.labels.index("for _ in range(n)"))) == {"in", "a", "b", "a'"}
    assert set(loop.diagram.inner[loop.labels.index("body")].names) == {"a", "b", "a'", "b'"}
    # mid is assigned before it is read in every iteration, so nothing carries it
    s = scan_source(program("search.py"), function="index")
    body = s.children[s.labels.index("while lo <= hi")]
    assert body is not None
    names = set(body.diagram.inner[body.labels.index("body")].names)
    assert "mid'" not in names and {"lo'", "hi'"} <= names


def test_rebinding_ends_liveness() -> None:
    # x is assigned again before it is read, so the if need not output x'
    src = "def f(c):\n    x = 0\n    if c:\n        x = 1\n    x = 2\n    return x\n"
    t = scan_source(src, function="f")
    assert set(wiring(t, t.labels.index("if c"))) == {"if"}


def test_every_star_has_the_span_of_its_code() -> None:
    spans = scan_spans(HYPOT, function="hypot", expand=1)
    t = scan_source(HYPOT, function="hypot", expand=1)
    lines = HYPOT.splitlines()

    def text(path: str) -> str:
        line, col, end_line, end_col = spans[path]
        assert line == end_line
        return lines[line - 1][col:end_col]

    assert text("0") == "square(a)" and text("1") == "square(b)"
    assert text("0.0") == "x * x" and text("0.1") == "return x * x"  # inside the inlined body
    assert text(str(t.labels.index("math.sqrt"))) == "math.sqrt(square(a) + square(b))"

    def paths(u: Term, prefix: str = "") -> list[str]:
        out = []
        for i, kid in enumerate(u.children):
            out.append(f"{prefix}{i}")
            if kid is not None:
                out += paths(kid, f"{prefix}{i}.")
        return out

    for src, function in [(POC_MODULE, None), (program("evaluate.py"), "evaluate")]:
        term = scan_source(src, function=function, expand=1)
        assert set(scan_spans(src, function=function, expand=1)) == set(paths(term))


def test_span_columns_count_characters() -> None:
    src = "def f(x):\n    return 'é' + x\n"
    plus = scan_source(src, function="f").labels.index("+")
    line, col, _, end = scan_spans(src, function="f")[str(plus)]
    assert src.splitlines()[line - 1][col:end] == "'é' + x"


def test_programs_run_their_doctests() -> None:
    for path in sorted(PROGRAMS.glob("*.py")):
        spec = importlib.util.spec_from_file_location(f"program_{path.stem}", path)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        assert doctest.testmod(module).failed == 0, path.name


@pytest.mark.parametrize("path", SCANNED, ids=lambda p: p.stem)
def test_scanned_examples_record_how_to_repeat_the_scan(path: Path) -> None:
    doc = json.loads(path.read_text(encoding="utf-8"))
    c = doc["code"]
    again = document(c["source"], name=c["name"], function=c["function"], expand=c["expand"])
    assert again["term"] == doc["term"] and again["code"] == c
    assert c["source"] == program(c["name"])


def test_document_and_cli() -> None:
    doc = document(HYPOT, name="hypot.py", function="hypot", expand=1)
    assert doc["code"]["source"] == HYPOT
    assert (doc["code"]["name"], doc["code"]["function"], doc["code"]["expand"]) == (
        "hypot.py",
        "hypot",
        1,
    )
    assert (
        Term.from_json(doc["term"]).evaluate()
        == scan_source(HYPOT, function="hypot", expand=1).evaluate()
    )
    out = io.StringIO()
    with redirect_stdout(out):
        assert main([str(PACKAGE / "star.py"), "--function", "Star.index"]) == 0
    printed = json.loads(out.getvalue())
    assert Term.from_json(printed["term"]).label == "def Star.index"
