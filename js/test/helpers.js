// Shared test helpers: spec file access and a seeded generator of diagrams.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Star, WiringDiagram, rel } from "../src/index.js";

export const SPEC = fileURLToPath(new URL("../../spec/", import.meta.url));

/** @param {string} path relative to spec/ */
export function readSpec(path) {
  return JSON.parse(readFileSync(SPEC + path, "utf8"));
}

export const TYPES = ["A", "B"];
export const NAMES = ["a", "b", "c", "d", "é", "😀"];
export const DOMAINS = { A: [0, 1], B: ["x", "y", "z"] };

/** The seeds every law is checked on. */
export const SEEDS = Array.from({ length: 400 }, (_, k) => k);

/** mulberry32: a small, fast, seeded 32-bit generator. */
export class Gen {
  constructor(/** @type {number} */ seed) {
    this.state = seed >>> 0;
  }

  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  below(/** @type {number} */ n) {
    return Math.floor(this.next() * n);
  }

  shuffle(/** @type {number} */ n) {
    const xs = Array.from({ length: n }, (_, k) => k);
    for (let i = n - 1; i > 0; i--) {
      const j = this.below(i + 1);
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    return xs;
  }

  star() {
    return new Star(NAMES.filter(() => this.below(2) === 0).map((n) => [n, TYPES[this.below(2)]]));
  }

  /** @param {{inner?: Star[], outer?: Star, maxArity?: number}} [opts] */
  diagram({ inner, outer, maxArity = 3 } = {}) {
    const stars = inner ?? Array.from({ length: this.below(maxArity + 1) }, () => this.star());
    const out = outer ?? this.star();
    /** @type {string[]} */
    const cables = [];
    const solder = (/** @type {string} */ type) => {
      const same = cables.flatMap((t, c) => (t === type ? [c] : []));
      if (same.length > 0 && this.below(2) === 0) return same[this.below(same.length)];
      cables.push(type);
      return cables.length - 1;
    };
    const innerMaps = stars.map((x) => [...x].map(([n, t]) => [n, solder(t)]));
    const outerMap = [...out].map(([n, t]) => [n, solder(t)]);
    for (let k = this.below(3); k > 0; k--) cables.push(TYPES[this.below(2)]);
    return new WiringDiagram(cables, /** @type {any} */ (innerMaps), /** @type {any} */ (outerMap));
  }

  /** @returns {[WiringDiagram, WiringDiagram[]]} */
  twoLevel() {
    const phi = this.diagram();
    return [phi, phi.inner.map((x) => this.diagram({ outer: x }))];
  }

  relation(/** @type {Star} */ star) {
    const all = rel.Relation.full(star, DOMAINS).rows;
    const rows = all.length === 0 ? [] : Array.from({ length: this.below(6) }, () => all[this.below(all.length)]);
    return new rel.Relation(star, rows);
  }
}
