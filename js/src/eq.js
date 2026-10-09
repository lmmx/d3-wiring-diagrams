/**
 * The algebra Eq of equivalence relations (Spivak, Example 3.1.3).
 * `Eq(φ)` connects wires globally whenever they are connected through the diagram.
 */

import { WiringDiagram } from "./diagram.js";
import { WiringError } from "./errors.js";
import { Star } from "./star.js";
import { UnionFind } from "./union-find.js";

/** Block ids renumbered by first appearance. @param {ArrayLike<number>} labels */
function restrictedGrowth(labels) {
  const seen = new Map();
  return Array.from(labels, (b) => {
    if (!seen.has(b)) seen.set(b, seen.size);
    return seen.get(b);
  });
}

/** A partition of a star's wires: a block id per wire, numbered by first appearance. */
export class Partition {
  constructor(/** @type {Star} */ star, /** @type {readonly number[]} */ blocks) {
    if (blocks.length !== star.size || !blocks.every((b) => Number.isInteger(b) && b >= 0)) {
      throw new WiringError(
        "invalid_partition",
        `${JSON.stringify(blocks)} is not a block id (int >= 0) for each of ${star.size} wires`,
      );
    }
    this.star = star;
    /** @type {readonly number[]} */
    this.blocks = Object.freeze(restrictedGrowth(blocks));
    Object.freeze(this);
  }

  static discrete(/** @type {Star} */ star) {
    return new Partition(star, star.names.map((_, k) => k));
  }

  /** Groups of wire names. @returns {string[][]} */
  groups() {
    /** @type {string[][]} */
    const out = [];
    this.blocks.forEach((b, k) => (out[b] ??= []).push(this.star.names[k]));
    return out;
  }

  equals(/** @type {Partition} */ other) {
    return this.star.equals(other.star) && this.blocks.every((b, k) => b === other.blocks[k]);
  }
}

/** `Eq(φ)(E₁, …, Eₙ)`. */
export function apply(/** @type {WiringDiagram} */ phi, /** @type {readonly Partition[]} */ partitions) {
  if (partitions.length !== phi.arity) {
    throw new WiringError("arity_mismatch", `diagram has ${phi.arity} inner stars, got ${partitions.length}`);
  }
  const uf = new UnionFind(phi.cables.length);
  partitions.forEach((p, i) => {
    if (!p.star.equals(phi.inner[i])) {
      throw new WiringError("star_mismatch", `partition ${i} is on ${p.star}, expected ${phi.inner[i]}`);
    }
    const wiring = phi.innerCables(i);
    const first = new Map();
    p.blocks.forEach((b, w) => {
      if (first.has(b)) uf.union(first.get(b), wiring[w]);
      else first.set(b, wiring[w]);
    });
  });
  return new Partition(phi.outer, Array.from(phi.outerCables, (c) => uf.find(c)));
}
