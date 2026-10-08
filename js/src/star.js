/** Objects of the operad: typed stars (Spivak, Example 4.1.1). */

import { WiringError } from "./errors.js";
import { compareCodePoints } from "./order.js";

/**
 * A typed star `(X, τ)`: a finite set of named wires, each with a value type.
 *
 * Wires are stored sorted by name in Unicode code point order, the same order
 * the Python and Rust implementations use. So index `k` names the same wire
 * in every language. Instances are immutable.
 */
export class Star {
  /**
   * @param {Record<string, string> | Iterable<[string, string]>} wires
   *   an object `{name: type}` or `[name, type]` pairs
   */
  constructor(wires) {
    const pairs = Symbol.iterator in Object(wires) ? [...wires] : Object.entries(wires);
    pairs.sort((a, b) => compareCodePoints(a[0], b[0]));
    for (let i = 1; i < pairs.length; i++) {
      if (pairs[i][0] === pairs[i - 1][0]) {
        throw new WiringError("duplicate_wire", `wire ${JSON.stringify(pairs[i][0])} appears twice`);
      }
    }
    /** @type {readonly string[]} wire names in canonical order */
    this.names = Object.freeze(pairs.map((p) => p[0]));
    /** @type {readonly string[]} wire types, aligned with `names` */
    this.types = Object.freeze(pairs.map((p) => p[1]));
    Object.freeze(this);
  }

  /**
   * @param {readonly string[]} names already sorted and distinct
   * @param {readonly string[]} types
   * @returns {Star}
   */
  static fromSorted(names, types) {
    const star = Object.create(Star.prototype);
    star.names = Object.freeze([...names]);
    star.types = Object.freeze([...types]);
    return Object.freeze(star);
  }

  /** A star of the singly-typed operad S: every wire has type `type`. */
  static untyped(/** @type {Iterable<string>} */ names, type = "*") {
    return new Star([...names].map((n) => [n, type]));
  }

  get size() {
    return this.names.length;
  }

  /** Position of wire `name` in canonical order, or -1 (binary search). */
  indexOf(/** @type {string} */ name) {
    let lo = 0;
    let hi = this.names.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const c = compareCodePoints(this.names[mid], name);
      if (c === 0) return mid;
      if (c < 0) lo = mid + 1;
      else hi = mid;
    }
    return -1;
  }

  /** @returns {string | undefined} */
  typeOf(/** @type {string} */ name) {
    const i = this.indexOf(name);
    return i < 0 ? undefined : this.types[i];
  }

  /** @returns {Generator<[string, string]>} */
  *[Symbol.iterator]() {
    for (let i = 0; i < this.names.length; i++) yield [this.names[i], this.types[i]];
  }

  equals(/** @type {Star} */ other) {
    if (this === other) return true;
    const n = this.names.length;
    if (other.names.length !== n) return false;
    for (let i = 0; i < n; i++) {
      if (this.names[i] !== other.names[i] || this.types[i] !== other.types[i]) return false;
    }
    return true;
  }

  toString() {
    return `{${[...this].map(([n, t]) => `${n}: ${t}`).join(", ")}}`;
  }

  /** @returns {Record<string, string>} */
  toJSON() {
    return Object.fromEntries(this);
  }

  /** Parse `{name: type}`. */
  static fromJSON(/** @type {unknown} */ data) {
    if (!isPlainObject(data) || !Object.values(data).every((t) => typeof t === "string")) {
      throw new WiringError("invalid_json", "a star is an object of name -> type");
    }
    return new Star(/** @type {Record<string, string>} */ (data));
  }
}

/** @returns {data is Record<string, unknown>} */
export function isPlainObject(/** @type {unknown} */ data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
