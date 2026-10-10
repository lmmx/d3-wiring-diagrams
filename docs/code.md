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
(`Term::from_json_value`, `Term.fromJSON`).

```python
from wiring_diagrams.code import scan_source, scan_spans, scan_path

term = scan_source(source, function="hypot", expand=1)   # a Term
term.evaluate()                                          # its composite WiringDiagram
scan_spans(source, function="hypot", expand=1)           # {"0": (9, 21, 9, 30), …}: each star's code
```

## In the browser

The [playground](../viewer/?edit#code-hypot) opens with a Python editor
beside the diagram:

1. Pick a program, or write your own. The code is a module: define one or
   more functions.
2. **Draw** picks the function to draw, or the whole module.
3. **Inline calls** fills calls to the module's own functions with their
   bodies, up to that many levels.
4. Edit. The diagram follows: the playground runs this scanner in
   [Pyodide](https://pyodide.org), loaded the first time you edit, so the
   browser and `python -m wiring_diagrams.code` cannot disagree.

Hover a star to see the code it came from, and put the cursor on a line to
see the stars it made. A scan records each star's span, which is how.

## Example programs

The programs in [`examples/python/`](../examples/python/) are ordinary,
runnable modules: each has doctests, which the test suite runs.
`scripts/generate.py` scans them into `spec/examples/code-*.json`, titled
and described by their docstrings, so the description of each diagram sits
in the code it describes.

| Program | Drawn | What it shows |
| --- | --- | --- |
| [hypot.py](../viewer/#code-hypot) | `hypot`, inlined | calls into the module have the callee's star; inlining is composition |
| [pipeline.py](../viewer/#code-pipeline) | `report`, inlined | a CSV pipeline whose three stages inline into one dataflow |
| [newton.py](../viewer/#code-newton) | `sqrt`, inlined | a `while` loop over inlined helpers; a default argument as an undriven cable |
| [mean.py](../viewer/#code-mean) | `mean_positive` | a `for` loop holding an `if`; loop-carried totals |
| [fibonacci.py](../viewer/#code-fibonacci) | `fib` | tuple packing and unpacking; a value only the next iteration reads |
| [search.py](../viewer/#code-search) | `index` | `if`/`elif`/`else` inside a loop, and a `return` from inside it |
| [evaluate.py](../viewer/#code-evaluate) | `evaluate`, inlined | `match` with captures; recursion is not inlined |
| [config.py](../viewer/#code-config) | `load` | `try`, `with` and `except`, and a global |
| [account.py](../viewer/#code-account) | the module, inlined | a class of methods; `self.withdraw(…)` inlines, `target.deposit(…)` cannot |
| [wordcount.py](../viewer/#code-wordcount) | `top_words`, inlined | comprehensions and lambdas as single stars; method calls |
| [module.py](../viewer/#code-module) | the module | the proof of concept's original sample |

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
dataflow, which is inlining. The [`code-hypot`](../viewer/#code-hypot)
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
the loop outputs. In [fibonacci.py](../viewer/#code-fibonacci), the body
outputs `a'` and `b'`, and the loop outputs only `a'`: `b'` ends at a dangling
cable inside the loop's star, the value the next iteration takes. A loop
variable `x` is the loop's own value (an `item` of the iterated value). It
shadows any outer `x`, so it is not a read from outside.

"Read afterwards" is liveness. A plain assignment `x = …` ends the life of
the old `x`, so a variable that is always reassigned before it is read is not
output: in [search.py](../viewer/#code-search), `mid` is recomputed at the
top of every iteration, so the loop body has no `mid'`. Assignments inside a
compound statement do not count, because the statement might not run them.

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
- **Rebinding, not mutation.** A cable carries the value a name is bound to.
  `kept.append(r)` is a star that reads `kept`; it does not produce a new
  `kept'`, so code after it reads the same cable. The diagram shows that the
  list was passed to `append`, not that it changed
  ([pipeline.py](../viewer/#code-pipeline)).
- **Methods on `self` only.** A method call is resolved to the class's own
  method when the receiver is the method's first parameter (`self`). Calls on
  other objects stay method-call stars, since their class is not known
  statically ([account.py](../viewer/#code-account)).

The scanner handles every construct in the Python 3.10–3.13 grammar.
Statements it does not know (from a newer Python) become an opaque star over
the variables they read. `test_code.py` scans the standard library's `json`,
`email` and `asyncio` packages and this package itself. A full scan of the
standard library (537 modules, with one level of inlining) completes without
error.
