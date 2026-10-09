// Run the shared conformance suite (spec/conformance) through the JS API.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  Star,
  WiringDiagram,
  WiringError,
  eq,
  evaluation,
  externalize,
  internalHom,
  internalize,
  rel,
} from "../src/index.js";
import { readSpec } from "./helpers.js";

const D = (/** @type {unknown} */ v) => WiringDiagram.fromJSON(v);
const S = (/** @type {unknown} */ v) => Star.fromJSON(v);

/** @type {Record<string, (c: any) => unknown>} */
const RUNNERS = {
  stars: (c) => [...S(c.wires).names],
  canonical: (c) => D(c.input).toJSON(),
  identity: (c) => WiringDiagram.identity(S(c.star)).toJSON(),
  compose: (c) => D(c.diagram).compose(c.children.map(D)).toJSON(),
  permute: (c) => D(c.diagram).permute(c.sigma).toJSON(),
  map_types: (c) => D(c.diagram).mapTypes((t) => c.mapping[t]).toJSON(),
  closed: (c) => {
    switch (c.op) {
      case "internal_hom":
        return internalHom(c.ys.map(S), S(c.z)).toJSON();
      case "evaluation":
        return evaluation(c.ys.map(S), S(c.z)).toJSON();
      case "internalize":
        return internalize(D(c.diagram), c.m).toJSON();
      case "externalize":
        return externalize(D(c.diagram), c.ys.map(S), S(c.z)).toJSON();
      default:
        throw new Error(`unknown op ${c.op}`);
    }
  },
  rel: (c) => {
    const phi = D(c.diagram);
    // arity is checked before the stars of the arguments are known
    if (c.relations.length !== phi.arity) return rel.apply(phi, [], c.domains);
    const rs = phi.inner.map((x, i) => rel.Relation.fromJSON(x, c.relations[i]));
    return rel.apply(phi, rs, c.domains).toJSON();
  },
  eq: (c) => {
    const phi = D(c.diagram);
    return [...eq.apply(phi, phi.inner.map((x, i) => new eq.Partition(x, c.partitions[i]))).blocks];
  },
};

/** Relations are sets: compare rows order-insensitively. */
function normalise(/** @type {string} */ family, /** @type {any} */ value) {
  if (family !== "rel") return value;
  return { wires: value.wires, rows: value.rows.map((r) => JSON.stringify(r)).sort() };
}

for (const [family, run] of Object.entries(RUNNERS)) {
  describe(family, () => {
    const { cases } = readSpec(`conformance/${family}.json`);
    it(`has cases`, () => assert.ok(cases.length > 0));
    cases.forEach((/** @type {any} */ c, /** @type {number} */ i) => {
      it(`case ${i}`, () => {
        if ("error" in c) {
          assert.throws(
            () => run(c),
            (/** @type {unknown} */ e) => e instanceof WiringError && e.kind === c.error,
          );
        } else {
          // JSON round trip: compare plain data, as the other languages do
          const got = JSON.parse(JSON.stringify(run(c)));
          assert.deepStrictEqual(normalise(family, got), normalise(family, c.expected));
        }
      });
    });
  });
}
