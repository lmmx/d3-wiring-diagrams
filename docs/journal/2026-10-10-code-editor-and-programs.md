# 2026-10-10: Code editor, example programs, and source links

## Request

Review of the code-scanning work in the playground:

1. It should be clearer in the playground how to make diagrams of code.
2. Code entry should use a real code editor, as sites such as pydantic.run do
   ("do this properly", not a copy). The plain textarea was not good enough.
3. Nothing on the site had syntax highlighting.
4. Mainly: more Python examples, and better code entry and display.

## Decisions

1. **CodeMirror 6, not Monaco.** pydantic.run uses Monaco, the VS Code
   editor. It is several megabytes, needs web workers, and is built around
   features (IntelliSense, minimap) that short example programs do not need.
   CodeMirror 6 gives what code entry needs here, at 145 KB gzipped:
   - Python and JSON grammars, bracket matching and closing, indentation,
     search and undo;
   - diagnostics, which mark a syntax error where it is;
   - decorations, which mark the code of a star;
   - a syntax tree, which lists the functions a scan can draw without
     loading Python.
2. **The editor is vendored as one bundle.** CodeMirror's packages must
   share one `@codemirror/state`, so loading them from a CDN module by module
   is fragile. `site/vendor.mjs` bundles `site/codemirror.entry.js` with
   esbuild into `viewer/vendor/codemirror.js`:
   - the bundle is committed, like d3, so a plain checkout runs with no build
     step;
   - the versions are exact, each at least two weeks old, and listed in the
     bundle's header;
   - CI rebuilds the bundle and fails on any difference;
   - the entry file doubles as `codemirror.d.ts`, so `tsc --strict` checks
     the viewer against CodeMirror's own types (through `paths` into
     `site/node_modules`).
3. **One highlighter for docs and editor.** The docs are highlighted when the
   site is built, with the same Lezer grammars and `tok-*` classes as the
   editor, coloured once in `viewer/code.css` for light and dark. So the
   pages ship no highlighting script. A code block in a language the build
   cannot highlight fails the build, as a broken link does.
4. **Example programs are real files.** `examples/python/*.py` are runnable
   modules with doctests, which the tests run. `scripts/generate.py` scans
   them (`PROGRAMS`: file, function, expand). Each program's docstring gives
   its title and description, so the explanation of a diagram sits in the
   code it explains. The three earlier code examples moved there:
   `code-inlining` became `code-hypot`, and `code-loop` became `code-mean`.
   The eleven programs each show something different, listed in
   [code.md](../code.md#example-programs).
5. **Scans record where each star came from.** A *span* is `[line, column,
   end line, end column]`, with columns in code points, keyed by the star's
   path in the term. Document `code` also records `name`, `function` and
   `expand`, so a document says how to repeat its scan, and a test repeats
   every one. The viewer uses the spans to link stars and code both ways.
6. **The playground leads with Python.**
   - The Python tab comes first, and the nav's Playground link opens
     `hypot.py`.
   - A short lede says what maps to what.
   - **Program**, **Draw** and **Inline calls** replace a free-text function
     name and a number field.
   - The diagram follows the code as you type. Pyodide loads on the first
     edit, not on opening an example, since the examples come pre-scanned.

## Progress log

1. Spans in `wiring_diagrams.code`:
   - each new star takes the span of the statement or expression being
     translated;
   - `scan_spans` exposes them, and `document` writes them.

   Two places lost locations, and both are fixed:
   - `_load` rebuilt targets by unparsing and reparsing, so every `x += 1`
     read pointed at line 1. It now copies the node.
   - `except E as e` made an unplaced assignment. It now takes the handler's
     place.
2. Reviewing the scans of the new programs found two scanner faults, both
   fixed and tested:
   - **A loop body did not output what only the next iteration reads.** In
     `fib`, the body had no `b'`, and in binary search no `lo'`/`hi'`. This
     contradicted code.md. The body now outputs them, and they end on a
     dangling cable inside the loop's star.
   - **Liveness ignored rebinding.** Any later mention of a name kept it live,
     so the search loop's body output `mid'`, though every iteration
     recomputes `mid` first. `_live_before` now lets a plain assignment end a
     name's life. Assignments inside compound statements do not count, since
     those might not run.
3. Two program descriptions were wrong against their own scans:
   - `wordcount` claimed `words` was inlined, but the call sat inside a
     generator expression, which is one opaque star;
   - `search` claimed two returns inside its loop.

   The code and the text were corrected.
4. `viewer/editor.js`, `viewer/code.css`, the vendored bundle, and the
   rewritten playground pane. In `viewer/python.js`, scan errors are now data
   from Python (message, line, column) rather than a traceback picked apart
   with a regex.
5. `starSpans` / `starsOnLines` in `viewer/edit.js` map spans to the
   renderer's star keys. A Node test checks that every star of every scanned
   example, in both views, has exactly one span. It also checks that the
   cursor in `square` marks both inlined copies. `renderer.link` marks stars.
6. The layout gives a lone star that holds a sub-diagram more room (radius cap
   0.5 → 0.68). This affects a function whose body is one `match`, for
   instance.
7. The site build passes `?edit` links through, and links to a directory as
   written (`viewer/`, not `viewer/index.html`).
8. In Chromium, light and dark, desktop and 390 px wide:
   - hovering `math.sqrt` marks `math.sqrt(square(a) + square(b))`;
   - the cursor on `return x * x` marks the four stars of both inlined copies;
   - an edit is rescanned and redrawn;
   - a syntax error is underlined at its place, with a gutter marker;
   - there is no horizontal scroll on a phone.

   The smoke test now checks all of these (29 checks).
9. `just`:
   - Python: 962 tests;
   - Rust: all suites;
   - JS: 926 tests, and `tsc --strict` over the viewer with CodeMirror's types;
   - the site build, checking 39 links.

## Current State

- `examples/python/` holds 11 runnable programs with doctests (python/tests/test_code.py `test_programs_run_their_doctests`)
- scripts/generate.py scans them into `spec/examples/code-*.json`, with titles and descriptions from their docstrings (scripts/generate.py:44-59, scripts/generate.py:393-406); `index.json` entries carry `kind` (`paper` or `program`)
- Scans record each star's span by term path, and documents record `name`, `function`, `expand` and `spans` (python/src/wiring_diagrams/code.py:83-131, python/src/wiring_diagrams/code.py:858-917); the schema validates them, and a test repeats every example's scan
- Loop bodies output values only the next iteration reads, and a plain assignment ends a name's liveness (python/src/wiring_diagrams/code.py:219-240, python/src/wiring_diagrams/code.py:494-499)
- `viewer/editor.js` wraps CodeMirror 6: Python and JSON editors, a read-only source view, span marks, diagnostics, and the list of functions from the syntax tree
- `viewer/vendor/codemirror.js` is built by site/vendor.mjs from site/codemirror.entry.js; `just site` and CI fail when it is stale
- Docs code blocks are highlighted at build time with Lezer (site/build.mjs:118-144), with the token colours in viewer/code.css
- The playground's Python tab has program, function and inline-calls pickers; it rescans as you type and marks syntax errors in the editor (viewer/viewer.js:474-522)
- Stars and source are linked both ways in the viewer and the playground (viewer/edit.js:213-258, viewer/viewer.js:94-147, js/src/render.js `link`)
- site/smoke.mjs runs 29 checks, including source links, a live rescan in Pyodide, and highlighted docs

## Stubbed

- None

## Missing

- No scanner for JavaScript or Rust source: the JS and Rust libraries read scans as JSON only
- Calls are resolved within one module: calls into other modules of a scanned package remain unexpanded stars
- Mutation through methods (`xs.append(x)`) is not a write: the diagram shows the call, not the changed value
- The playground needs network access on its first Python edit, to fetch Pyodide

## Divergence

- None found: README.md, docs/code.md, docs/format.md and docs/visualisation.md were checked against the code on 2026-10-10
