# Wiring diagrams of code

`wiring_diagrams.code` scans Python source into an operad [term](theory.md#terms-2-a-wiring-diagram-of-wiring-diagrams-is-a-wiring-diagram).
A function's parameters and result are its interface, and its body wires
operations together, which is what a wiring diagram is.

```sh
python -m wiring_diagrams.code path/to/module.py                 # the module
python -m wiring_diagrams.code module.py -f hypot --expand 1     # one function, calls inlined
python -m wiring_diagrams.code path/to/package/                  # a package, one star per module
```

The output is an example document in the [interchange format](format.md). The
viewer opens it (**Open JSON…**), and so do the Rust and JS libraries
(`Term::from_json_value`, `Term.fromJSON`). The playground's **Python code**
tab runs the same scanner in the browser, in Pyodide, so the two cannot
disagree.

```python
from wiring_diagrams.code import scan_source, scan_path

term = scan_source(source, function="hypot", expand=1)   # a Term
term.evaluate()                                          # its composite WiringDiagram
```

## The mapping

| Python | Wiring diagram |
| --- | --- |
| function `def f(a, b)` | a star with wires `a`, `b`, `return`, filled with the body's diagram |
| parameter, assigned variable, sub-expression result | a cable |
| reading a variable | soldering onto the cable it names at that point |
| `a + b`, `not a`, `a < b`, `x.y`, `x[i]`, `(a, b)`, literals | an inner star with wires `0`, `1`, … and `return` |
| a name the function does not bind (`print`, `math.pi`) | a star with one wire, `return`; one per name per diagram |
| call to an unknown function `g(a, k=b)` | a star `g` with wires `0`, `k`, `return` |
| method call `x.m(a)` | a star `.m()` with wires `.` (the receiver), `0`, `return` |
| call to a function of the same module | a star `g` with **`g`'s own wires**, bound as Python binds arguments |
| `return e` | a star `return` joining `e` to the function's `return` wire |
| `x = …`, `a, b = …`, `self.x = …`, `d[k] = …` | rebinding the name; an `unpack` star; a `.x =` star; a `[] =` star |
| `if`, `for`, `while`, `with`, `try`, `match` | a star filled with its own diagram, which holds one star per branch (`then`/`else`, `body`, each `except`, each `case`) |
| class, module, package | a star with no wires holding its definitions |

## Inlining is composition

A call to a function defined in the same module gets that function's own
star: every parameter, with arguments bound positionally and by keyword as
Python would bind them. Parameters left to their defaults are cables that
nothing drives. The star therefore *is* the callee's outer star, and the
callee's body diagram can fill it. With `expand=n`, calls are filled to depth
`n`, never re-entering a function already being expanded, so recursion
terminates.

The viewer's **Composed** view of such a term is the operad composite. The
call stars disappear and the callee's operations sit directly in the caller's
dataflow, which is inlining. The [`code-inlining`](../viewer/#code-inlining)
example shows `hypot` with two `square` calls filled in. `test_code.py`
checks that `term.evaluate()` equals composing the unexpanded diagram with
`square`'s body.

A call that cannot be bound statically falls back to positional wires and is
never expanded. That covers `*args`, `**kwargs` and too many arguments.

## Compound statements

A compound statement is a star whose wires are:

- what it consumes from outside: the tested or iterated value (`if`, `in`,
  `match`, `with`), and each variable its body reads (`x`);
- each variable it assigns that is read afterwards (`x'`);
- `return`, if it contains a `return`.

Inside, each branch is again a star with the same kind of interface, filled
with that branch's statements. A loop's body can read what it wrote on the
previous iteration. So "read afterwards" counts the loop's own reads when
deciding what the body must output, but only later reads when deciding what
the loop outputs. A loop variable `x` is the loop's own value (an `item` of
the iterated value). It shadows any outer `x`, so it is not a read from
outside.

All structural wire names are keywords (`return`, `if`, `in`, `else`) or contain
characters no identifier can (`0`, `x'`, `*args`, `.`, `()`). They therefore
never collide with a variable or parameter. `test_code.py` checks this with
parameters named `test`, `iter` and `item`.

## What the scan is and is not

- **Dataflow.** Edges are values, so the diagram shows what depends on what.
  Execution order and which branch runs are not part of it. A branch's star
  says "this sub-diagram may run", not "this runs".
- **Single-typed.** Every cable has type `py`. Python checks types at run
  time, and two calls to one function must share its star exactly.
- **No algebra.** The relational algebra is not attached to scanned code. The
  diagram describes structure, and Python functions are not finite relations.
- **Definitions are not connected.** At module, class and package level the
  stars are containers, and a function's wires are unconnected there. The
  connection between functions shows up as call stars inside their bodies,
  and expanding them composes the bodies.

The scanner handles every construct in the Python 3.10–3.13 grammar.
Statements it does not know (from a newer Python) become an opaque star over
the variables they read. `test_code.py` scans the standard library's `json`,
`email` and `asyncio` packages and this package itself. A full scan of the
standard library (537 modules, with one level of inlining) completes without
error.
