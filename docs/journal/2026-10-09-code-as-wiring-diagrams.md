# 2026-10-09: Code as wiring diagrams

## Request

After PR #3 was merged, two requests came in:

1. The playground lost the site's banner, so there was no way back to the
   docs.
2. The project was meant for viewing *programs* ("a function and its
   parameters seem to map nicely to this idea"). Add the ability to scan code
   into diagrams, in the libraries and in the playground.

## Decisions

1. **The scanner is in Python, for Python, using only the stdlib `ast`.**
   Python is the language whose programs were meant to be viewed, and the
   proof of concept's sample was a Python module. The Rust and JS libraries
   read the scanner's output through the existing JSON format
   (`Term::from_json_value`, `Term.fromJSON`) rather than shipping second and
   third Python parsers.
2. **The playground runs the same scanner, in Pyodide.** The alternative was
   a Python parser written in JS. That would be a second scanner that could
   disagree with the first. Pyodide is fetched only on the first scan, and
   the package's modules are served with the site.
3. **The mapping is dataflow, and stays inside the operad** ([code.md](../code.md)):
   - a function is a star (parameters + `return`);
   - values are cables;
   - operations and calls are inner stars;
   - compound statements are stars filled with their branches' diagrams.

   Every scan is an ordinary `Term`, so composition, the viewer and the
   playground's operations all apply to code unchanged.
4. **Calls into the module get the callee's own star.** Arguments are bound
   positionally and by keyword, and defaulted parameters become undriven
   cables, so a call star *is* the callee's outer star. Expanding a call is
   then operadic composition. The [`code-inlining`](../../viewer/#code-inlining)
   example shows it, and a test checks `term.evaluate()` against composing by
   hand.
5. **Structural wire names cannot collide with variables.** They are keywords
   (`return`, `if`, `in`), or contain characters no identifier can (`0`, `x'`,
   `*args`).
6. **One cable type, `py`.** Two calls to one function must share its star
   exactly, and Python checks types at run time.
7. **The banner is the docs' nav, injected by the site build** at a marker in
   `viewer/index.html`. Local `just serve` still works without it. The nav
   styles moved to `site/nav.css`, shared by both kinds of page.

## Progress log

1. Branch restarted from the merged `master` (same branch name, fresh history).
2. Scanner, tests, and three examples:
   - `code-module`: the proof of concept's own `module.py`, now scanned;
   - `code-inlining`;
   - `code-loop`.
3. Writing the tests found three scanner bugs:
   - `total += x` was not counted as a read of `total`;
   - a loop's `x'` output was added when `x` was only read by the next
     iteration;
   - a loop target shadowing a parameter was wired as a read of the
     parameter.

   All three are fixed, and the tests cover them.
4. Robustness: a scan of all 537 non-test standard-library modules with one
   level of inlining raised no errors. Every scan builds valid terms, since
   each composition checks that star shapes match. `test_code.py` scans
   `json`, `email`, `asyncio` and this package.
5. The playground's Python tab was driven in Playwright. The first scan,
   including loading Pyodide, took about 4 s. The smoke test now covers a scan
   and a syntax error's line number.
6. Screenshots of the code examples showed two label problems, both fixed:
   - operation labels overlapped wire names in small stars;
   - wire names spilled outside the circle on the left and right.

## Current State

- `scan_source` maps Python source to a `Term`: modules and classes become containers, functions dataflow diagrams, compound statements nested stars, and calls into the module stars with the callee's interface, filled to depth `expand` (python/src/wiring_diagrams/code.py:708-731, python/src/wiring_diagrams/code.py:259-631)
- `scan_path` scans a file, or a directory as a package with one star per module and subpackage (python/src/wiring_diagrams/code.py:733-746)
- `python -m wiring_diagrams.code PATH [-f FUNCTION] [-e EXPAND]` prints an example document with `code` set (python/src/wiring_diagrams/code.py:749-800)
- python/tests/test_code.py tests the mapping, argument binding, inlining as composition, recursion cut-off, loop reads and writes, structural wire names, every compound statement kind, determinism, scanning stdlib packages and this package, and the CLI
- spec/examples/code-module.json, code-inlining.json and code-loop.json are generated from python/src/wiring_diagrams/examples.py and carry their source in `code`; spec/schema/wiring-diagrams.schema.json accepts `code`
- viewer/python.js loads Pyodide 0.27.7 from jsDelivr on the first scan, writes the package's modules into its file system, and runs `wiring_diagrams.code.document`
- The viewer shows a scanned document's source (`#code`), and the playground's Python tab scans source with an optional function and expansion depth (viewer/index.html, viewer/viewer.js)
- `site/build.mjs` replaces the `<!-- site-nav: -->` marker in viewer/index.html with the docs' navigation bar and fails when the marker is missing; viewer.js marks Viewer or Playground as the current page
- `site/build.mjs` checks a viewer link's `#fragment` against spec/examples instead of page headings
- `site/smoke.mjs` scans Python in Pyodide and checks the source panel, both expanded calls, and a syntax error's line

## Missing

- No scanner for JavaScript or Rust source: the JS and Rust libraries read scans as JSON only
- Scanned diagrams carry no algebra: the relational algebra does not apply to Python functions
- Calls are resolved within one module: calls into other modules of a scanned package remain unexpanded stars
- Module and class levels do not connect definitions: functions' wires are unconnected there
- The playground needs network access on its first Python scan to fetch Pyodide

## Divergence

- None found: README.md, docs/code.md, docs/format.md and docs/visualisation.md were checked against the code on 2026-10-09
