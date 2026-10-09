// Layout and scene: determinism, geometric invariants, and the nested view's
// pushout classes agreeing with the composite.

import assert from "node:assert/strict";
import { it } from "node:test";

import { Term, WiringDiagram } from "../src/index.js";
import { assignSlots, layout } from "../src/layout.js";
import { buildScene } from "../src/scene.js";
import { Gen, SEEDS, readSpec } from "./helpers.js";

const examples = readSpec("examples/index.json").map((/** @type {{slug: string}} */ e) => ({
  slug: e.slug,
  term: Term.fromJSON(readSpec(`examples/${e.slug}.json`).term),
}));

it("layout is deterministic", () => {
  for (const { term } of examples) {
    const phi = term.evaluate();
    assert.deepStrictEqual(layout(phi), layout(phi));
    assert.deepStrictEqual(buildScene(term), buildScene(term));
  }
});

it("inner stars stay inside the outer star and do not overlap", () => {
  const diagrams = [...examples.map((e) => e.term.evaluate()), ...SEEDS.slice(0, 100).map((s) => new Gen(s).diagram({ maxArity: 8 }))];
  for (const phi of diagrams) {
    const { stars } = layout(phi);
    for (const s of stars) assert.ok(Math.hypot(s.x, s.y) + s.r <= 1 + 1e-9, `star outside: ${phi}`);
    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) {
        const d = Math.hypot(stars[i].x - stars[j].x, stars[i].y - stars[j].y);
        assert.ok(d >= stars[i].r + stars[j].r - 1e-6, `overlap ${i},${j}: ${phi}`);
      }
    }
  }
});

it("every wire gets one port on its star's circle, and every cable lists its wires", () => {
  for (const seed of SEEDS.slice(0, 100)) {
    const phi = new Gen(seed).diagram({ maxArity: 5 });
    const L = layout(phi);
    L.stars.forEach((s, i) => {
      assert.deepStrictEqual(s.ports.map((p) => p.name), [...phi.inner[i].names]);
      for (const p of s.ports) assert.ok(Math.abs(Math.hypot(p.x - s.x, p.y - s.y) - s.r) < 1e-9);
    });
    const ends = L.cables.reduce((n, c) => n + c.ends.length, 0);
    assert.equal(ends, phi.inner.reduce((n, x) => n + x.size, 0) + phi.outer.size);
    const [floating] = phi.floatingCables();
    L.cables.forEach((c, k) => assert.equal(c.kind === "floating", k >= floating));
  }
});

it("outer angles can be pinned (nested drawing)", () => {
  const phi = new WiringDiagram(["A", "A"], [{ x: 0 }, { y: 1 }], { a: 0, b: 1 });
  const L = layout(phi, { outerAngles: [0.5, 2] });
  assert.deepStrictEqual(L.outer.ports.map((p) => p.angle), [0.5, 2]);
  assert.throws(() => layout(phi, { outerAngles: [1] }), RangeError);
});

it("slots keep the circular order of the desired angles, evenly spaced", () => {
  const a = assignSlots([0.1, 3.0, 1.5]);
  const order = [0, 2, 1];
  for (let j = 0; j < 3; j++) {
    const gap = (((a[order[(j + 1) % 3]] - a[order[j]]) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    assert.ok(Math.abs(gap - (2 * Math.PI) / 3) < 1e-9);
  }
  assert.deepStrictEqual(assignSlots([]), []);
});

it("nested and flat scenes share leaf keys; nested cable groups are the composite's cables", () => {
  for (const { slug, term } of examples) {
    const nested = buildScene(term);
    const flat = buildScene(term, { nested: false });
    const phi = term.evaluate();
    const leafKeys = (/** @type {any} */ s) => s.stars.filter((x) => x.role === "leaf").map((x) => x.key);
    assert.deepStrictEqual(leafKeys(nested), leafKeys(flat), slug);
    assert.equal(leafKeys(flat).length, phi.arity, slug);
    // one group per cable of the composite (a floating cable may arise from a closed loop)
    assert.equal(new Set(nested.cables.map((c) => c.group)).size, phi.cables.length, slug);
    assert.equal(flat.cables.length, phi.cables.length, slug);
  }
});

it("nested cable groups are the pushout classes, on random two-level terms", () => {
  for (const seed of SEEDS.slice(0, 150)) {
    const [phi, psis] = new Gen(seed).twoLevel();
    const term = new Term(phi, psis.map((p) => new Term(p)));
    const composite = phi.compose(psis);
    assert.equal(new Set(buildScene(term).cables.map((c) => c.group)).size, composite.cables.length, `seed ${seed}`);
  }
});
