// The paper's worked examples (spec/examples): terms evaluate, and Rel
// reproduces the expected outer relation, both flat and level by level.

import assert from "node:assert/strict";
import { it } from "node:test";

import { Star, Term, rel } from "../src/index.js";
import { readdirSync } from "node:fs";

import { SPEC, readSpec } from "./helpers.js";

/** Rel of a term evaluated level by level (no flattening). */
function nested(/** @type {Term} */ term, /** @type {Iterator<rel.Relation>} */ leaves, /** @type {any} */ doms) {
  const args = term.children.map((kid) => (kid === null ? leaves.next().value : nested(kid, leaves, doms)));
  return rel.apply(term.diagram, /** @type {rel.Relation[]} */ (args), doms);
}

const index = readSpec("examples/index.json");

it("index.json lists every example file", () => {
  const files = readdirSync(SPEC + "examples").filter((f) => f.endsWith(".json") && f !== "index.json");
  assert.deepStrictEqual(index.map((/** @type {{slug: string}} */ e) => `${e.slug}.json`).sort(), files.sort());
});

for (const { slug } of index) {
  it(slug, () => {
    const ex = readSpec(`examples/${slug}.json`);
    const term = Term.fromJSON(ex.term);
    const phi = term.evaluate();
    assert.equal(term.leafLabels().length, phi.arity);
    assert.deepStrictEqual(Term.fromJSON(JSON.parse(JSON.stringify(term))).evaluate().toJSON(), phi.toJSON());
    const alg = ex.algebra;
    if (!alg) return;
    const rels = phi.inner.map((x, i) => rel.Relation.fromJSON(x, alg.relations[i]));
    if (alg.kind === "rel_recursive") {
      const z = new Star([...phi.outer].filter(([n]) => n.startsWith("out.")).map(([n, t]) => [n.slice(4), t]));
      const got = rel.recursive(phi, rels, z, alg.domains);
      assert.ok(got.equals(rel.Relation.fromJSON(z, alg.expected)), JSON.stringify(got));
      return;
    }
    const got = rel.apply(phi, rels, alg.domains);
    assert.ok(got.equals(rel.Relation.fromJSON(phi.outer, alg.expected)), JSON.stringify(got));
    assert.ok(nested(term, rels.values(), alg.domains).equals(got), "nested evaluation");
  });
}
