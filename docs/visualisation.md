# Visualisation

Three layers, each usable on its own:

| Module | Input → output | DOM? | Tested in Node |
| --- | --- | --- | --- |
| `js/src/layout.js` | one `WiringDiagram` → geometry in the unit disk | no | yes |
| `js/src/scene.js` | a `Term` (nested or composed) → keyed primitives | no | yes |
| `js/src/render.js` | primitives → SVG, with `d3` passed in | yes | no (driven by the viewer) |

The viewer (`viewer/`) puts them together. Serve the repository root and open
`/viewer/` (`just serve`, or `python3 -m http.server`).

## Drawing conventions

These follow Spivak's figures:

- The outer star is the unit circle, and inner stars are disks inside it.
- A wire is a short stub at a *port* on its star's circle. Inner wires point
  outwards and outer wires point inwards.
- A cable is drawn from the stub tips. With two ends it is one cubic curve that
  leaves each port along its normal. With three or more, the branches meet at a
  junction dot. With one end it is a stub ending in a hollow dot. With none
  (floating) it is a small closed loop along the bottom of the outer circle.
- Colour is type. Types are assigned Okabe–Ito colours in code point order, so
  colours are the same in every view. A singly-typed diagram is drawn in one
  neutral colour. Wire names are italic and star labels are bold.

## Layout (`layout(phi, {outerAngles?, weights?})`)

Pure and deterministic: no `Math.random`, no clock, fixed iteration counts, and
index-ordered tie-breaks. The same diagram always produces the same picture,
and the tests check it.

1. **Radii.** `0.1 + 0.035·√(wires)`, times `√weight` (the number of leaves a
   sub-term will draw inside the star). The radii are scaled so the disks cover
   42% of the outer disk (55% when some star holds a sub-diagram), and capped
   so that any two disks still fit.
2. **Positions.** 240 iterations of a spring embedding with linear cooling.
   Stars that share cables attract each other, with rest length equal to the
   sum of their radii plus a gap. A star is pulled towards the outer wires it
   shares a cable with. All stars repel weakly, and a weak pull holds the
   picture at the centre. After every step, overlaps are resolved pairwise
   and every disk is projected back inside the outer circle. 60 final passes
   enforce both; the test asserts *no overlap and containment* on 100 random
   diagrams.
3. **Outer ports**, unless pinned. Each outer wire wants to face the centroid of
   the stars on its cable. Steps 2–3 alternate twice.
4. **Inner ports.** Each wire wants to face the centroid of everything else on
   its cable.
   - A star's wires form a *set*, so the order around the circle is free.
     `assignSlots` keeps the circular order of the desired angles, spaces the
     ports evenly, and rotates them to the circular-mean offset, which
     minimises `Σ(1 − cos error)`.
   - Dangling wires and self-loops face away from the centre.
5. **Cables.** Curve geometry as above. A junction that lands on or inside a
   star is pushed out past its rim.

Complexity is O(n² · 240) in the number of inner stars `n`. Measured in Node
22: 7 ms at 30 stars, 44 ms at 100, 0.35 s at 300. Composite diagrams with
thousands of stars are a job for the library, not for a picture.

## Scenes (`buildScene(term, {nested})`)

- **Nested** draws each sub-term inside the star it fills. The child is laid
  out with its outer wires pinned to the angles the parent gave that star
  (`outerAngles`), so every wire passes straight through the dashed
  intermediate circle. This is Spivak's picture (13) of the composition
  formula *before* the intermediate stars are removed.
- **Composed** draws `term.evaluate()` with its own layout.

All coordinates are in the root's unit disk. A nested child is scaled into its
star, so text and strokes shrink with depth. The renderer hides any label
smaller than 6 px on screen and brings it back as you zoom in.

Leaf stars, their wires and the outer star have the **same keys** in both
scenes (`leaf:k`, `leaf:k/wire`, `outer/wire`), so the renderer animates one
into the other. Intermediate circles exist only in the nested scene and fade
out, and cables are redrawn.

Each cable in the nested scene carries a `group`: its **pushout class**,
computed by a union–find that glues, for every wire of every intermediate
star, the parent's cable to the child's. The groups are exactly the cables of
the composite. The test checks this on all examples and on 150 random
two-level terms. Hovering a cable highlights its whole group, which shows what
the composition formula glues together.

## Rendering (`createRenderer(d3, svg, {onHover, onSelect})`)

- `d3` is a parameter: the vendored UMD build in the viewer, or
  `import * as d3 from "d3"` in an application. Only selections, transitions
  and zoom are used.
- `draw(term, {nested, labels, animate})` builds a scene and joins it by key.
  `show(scene)` takes a prebuilt one. `select(key)` outlines a star, and
  `resetZoom()` resets the view.
- All styling is CSS: classes `wd-star`, `wd-cable`, `wd-wire`, `wd-dot`,
  `wd-label`, `data-role`, and the variables `--wd-type-0…5`, `--wd-wire`,
  `--wd-line`, `--wd-fill`, `--wd-hot`. `viewer/viewer.css` has light and dark
  themes.

## Viewer

- An example picker; the URL hash names the example (`#half-adder`).
- A **Nested / Composed** toggle. The `c` key also switches views, and the
  switch animates unless the reader prefers reduced motion.
- Scroll to zoom and drag to pan.
- Click a star to see its relation:
  - for a leaf, the relation it was given;
  - for an intermediate star, Rel of the sub-term computed level by level;
  - for the outer star, Rel of the composite, compared with the `expected`
    relation in the spec file.
  This makes functoriality visible.
- For the recursive example, the panel shows the sizes of the fixed-point
  iteration (625 → 109 → … → 5 rows) and the resulting factorial table.
- **Open JSON…** (or drag and drop) accepts an example file, a term, or a bare
  diagram. That is how to view diagrams built in Python or Rust:
  `json.dump(term.to_json(), f)` / `serde_json::to_writer(f, &term)`.

## Playground

**Playground** in the viewer (or `?edit` in the URL) opens an editor beside
the diagram, with a **Python** tab and a **JSON** tab. The editing operations
live in `viewer/edit.js`. They are pure functions on documents in the
[interchange format](format.md), tested in Node
(`js/test/playground.test.js`).

- **Write Python.** The Python tab is a code editor (below) holding the
  source of a scanned example, or your own. **Program** picks one of the
  programs in `examples/python/`; **Draw** lists the functions the code
  defines, read from the editor's own syntax tree, or the whole module;
  **Inline calls** sets `expand`. The code is scanned by
  `wiring_diagrams.code` ([code.md](code.md)), the library's own scanner,
  run in the browser by [Pyodide](https://pyodide.org) (`viewer/python.js`).
  Pyodide is about 10 MB, fetched from jsDelivr the first time the code is
  edited or scanned; the examples come pre-scanned, so viewing them needs
  none of it. Once it has loaded, the diagram follows the code 350 ms after
  typing stops (<kbd>Ctrl</kbd>+<kbd>Enter</kbd> scans at once), and a scan
  that a newer one overtakes is dropped. A syntax error is marked where it
  is, in the editor, and the last good diagram stays on screen. The
  package's modules are served with the site, so the scan and
  `python -m wiring_diagrams.code` agree; a test keeps the list of modules in
  step with the package.

- **Edit the JSON.** The diagram redraws 250 ms after typing stops. A document
  that does not parse leaves the last good diagram on screen and shows the
  error, with its kind.
- **Plug in** (Spivak §5.1, plug-and-play). Select a leaf star and choose any
  labelled sub-term of the examples whose outer star matches it: OR, AND or
  XOR into a NAND, for instance. The slot is filled with that term, and the
  leaf's relation is replaced by the term's leaf relations, so the algebra
  stays consistent. `expected` is recomputed.
- **Collapse.** Select an intermediate star and turn its sub-term back into a
  single leaf. The leaf's relation is the one the sub-term computes, so the
  outer relation does not change; a test checks this, since it is
  functoriality.
- **Compose term** replaces the tree by its composite, keeping the leaf labels.
- **Share.** The document travels in the URL fragment (`#doc=`,
  deflate-raw then base64url), so a link reproduces it exactly. **Download**
  saves it as JSON.

## Code and source links

Code is shown in [CodeMirror 6](https://codemirror.net): the playground's
Python and JSON editors, and the source panel of a scanned example
(read-only). `viewer/editor.js` configures it once: line numbers, bracket
matching and closing, indentation, search, undo, and diagnostics. Tab
indents; <kbd>Esc</kbd> then <kbd>Tab</kbd> moves focus out of the editor.
CodeMirror is a set of ES modules that must share one copy of
`@codemirror/state`, so the viewer imports a bundle,
`viewer/vendor/codemirror.js` (145 KB gzipped), built by `site/vendor.mjs`
with esbuild from the exact versions in `site/package-lock.json`. The bundle
is committed, like d3, so a plain checkout runs with no build step, and CI
rebuilds it and fails if it differs. `viewer/vendor/codemirror.d.ts`
re-exports the packages' own types for `tsc`. Monaco, which pydantic.run
uses, was the other candidate: it is the VS Code editor, several megabytes
with web workers, for features (IntelliSense, a minimap) that a playground of
short programs does not need.

Highlighting has one source. The editor and the docs pages both use Lezer
grammars and `@lezer/highlight`'s `classHighlighter`, whose `tok-*` classes are
coloured once, for light and dark, in `viewer/code.css`. The docs are
highlighted when the site is built (Python, JS, JSON, Rust, shell), so the pages
ship no highlighting script, and a code block in a language the build cannot
highlight fails the build.

A scanned document's `code.spans` give each star's source
([format.md](format.md)). `starSpans` in `viewer/edit.js` maps them to the
renderer's star keys: `leaf:k` for the k-th leaf (the same in both views)
and `r.<path>` for an intermediate star. Then:

- hovering or selecting a star marks its code in the visible editor, and
  scrolls it into view;
- moving the cursor (or the selection) in the code marks the stars on those
  lines (`renderer.link`). A leaf is marked if its code touches the lines,
  and an intermediate star (a compound statement, an inlined call) only if
  its code lies within them, so the cursor inside a loop marks the
  operations on its line, not the whole loop. In an inlined call the cursor
  in the callee's body marks every inlined copy.

## Site

`site/build.mjs` renders the README and `docs/*.md` with `marked` and copies
in the viewer, `js/src`, `spec/` and the Python package (for Pyodide). The
viewer's page carries a marker (`<!-- site-nav: … -->`) where the build puts the
same navigation bar as the docs pages, so the playground links back to the
site. The build fails if the marker is missing. It writes the result to `dist/`, which
`vercel.json` deploys. The build fails on a relative link or `#anchor` that
does not resolve. Links to repository files outside the site go to GitHub.
`site/smoke.mjs` loads the built site in Chromium. It checks:

- every navigation link;
- the viewer's half-adder relation, and a playground plug-in;
- a scanned example's highlighted source, and a hovered star marking its code;
- the playground's Python tab: the scan options preselected, the cursor in
  `square` marking both inlined copies, an edit rescanned in Pyodide and
  redrawn, the function list following the code, and a syntax error marked
  in the editor;
- highlighted code blocks in the docs.

It fails on any console error or failed request. CI runs both.
