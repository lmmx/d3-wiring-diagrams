# wiring-diagrams (JavaScript)

ES modules, no runtime dependencies:

- `src/index.js`: the operad (`Star`, `WiringDiagram`, `Term`, closed
  structure, `rel`, `eq`)
- `src/layout.js`, `src/scene.js`: deterministic layout and scenes (no DOM)
- `src/render.js`: SVG rendering; pass your `d3` (v7) in

`npm test` runs the shared conformance suite, the paper's examples and the
law tests. `npm run check` type-checks the JSDoc with `tsc --strict`. See the
[repository README](../README.md) and [`docs/`](../docs/).
