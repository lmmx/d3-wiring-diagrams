/**
 * Morphisms of the operad: typed wiring diagrams (Spivak, Examples 2.1.7, 4.1.1).
 *
 * A wiring diagram `φ: X₁, …, Xₙ → Y` is a cospan `X₁ ⊔ … ⊔ Xₙ →f C ←g Y` of
 * typed finite sets. Diagrams that differ only by renaming cables are the
 * same morphism, so `WiringDiagram` stores the canonical representative:
 *
 * - wires within a star are ordered by name (code point order);
 * - cables are numbered by first appearance, scanning the inner stars in
 *   order and then the outer star;
 * - cables soldered to no wire ("floating") come last, sorted by type.
 *
 * `a.equals(b)` is therefore equality of morphisms. `a.key()` is a string
 * with the same property, for use as a `Map` key.
 */

import { WiringError } from "./errors.js";
import { compareCodePoints } from "./order.js";
import { Star, isIterable, isPlainObject } from "./star.js";
import { UnionFind } from "./union-find.js";

const UNSEEN = 0xffffffff;
/** Marks internal construction from parts that are already canonical. */
const PARTS = Symbol("parts");

export class WiringDiagram {
  /** @type {readonly string[]} `σ`, the type of each cable */
  cables;
  /** @type {readonly Star[]} the inner stars `X₁, …, Xₙ` */
  inner;
  /** @type {Star} the outer star `Y` */
  outer;
  /** @type {Uint32Array} */
  #offsets;
  /** @type {Uint32Array} */
  #innerCables;
  /** @type {Uint32Array} */
  #outerCables;

  /**
   * @param {readonly string[]} cables the type of each cable
   * @param {readonly (Record<string, number> | Iterable<[string, number]>)[]} inner
   *   for each inner star, `{wire: cable}` (`f` restricted to that star)
   * @param {Record<string, number> | Iterable<[string, number]>} outer `{wire: cable}` (`g`)
   */
  constructor(cables, inner, outer) {
    /** @type {Parts} */
    let p;
    if (/** @type {unknown} */ (cables) === PARTS) {
      p = /** @type {Parts} */ (/** @type {unknown} */ (inner));
    } else {
      const types = [...cables];
      /** @type {Star[]} */
      const stars = [];
      /** @type {number[]} */
      const raw = [];
      inner.forEach((w, i) => {
        const [star, cs] = wiring(types, `inner star ${i}`, w);
        stars.push(star);
        for (const c of cs) raw.push(c);
      });
      const [outerStar, outerRaw] = wiring(types, "outer", outer);
      p = canonical(types, stars, raw, outerStar, outerRaw, Array.from(types, (_, c) => c));
    }
    this.cables = Object.freeze([...p.cables]);
    this.inner = Object.freeze([...p.inner]);
    this.outer = p.outer;
    this.#offsets = p.offsets;
    this.#innerCables = p.innerCables;
    this.#outerCables = p.outerCables;
    Object.freeze(this);
  }

  /** Construct from parts that are already canonical. @param {Parts} parts */
  static #make(parts) {
    return new WiringDiagram(/** @type {any} */ (PARTS), /** @type {any} */ (parts), {});
  }

  // -- constituents ------------------------------------------------------------------

  /** Number of inner stars. */
  get arity() {
    return this.inner.length;
  }

  /** `f` restricted to `Xᵢ`: the cable of each wire, in canonical order. */
  innerCables(/** @type {number} */ i) {
    return this.#innerCables.subarray(this.#offsets[i], this.#offsets[i + 1]);
  }

  /** `g`: the cable of each outer wire, in canonical order. */
  get outerCables() {
    return this.#outerCables;
  }

  /** @returns {Record<string, number>} */
  innerWiring(/** @type {number} */ i) {
    const cs = this.innerCables(i);
    return Object.fromEntries(this.inner[i].names.map((n, k) => [n, cs[k]]));
  }

  /** @returns {Record<string, number>} */
  outerWiring() {
    return Object.fromEntries(this.outer.names.map((n, k) => [n, this.#outerCables[k]]));
  }

  /** `[start, end)` of the cables soldered to no wire (canonical form puts them last). */
  floatingCables() {
    let used = 0;
    for (const c of this.#innerCables) used = Math.max(used, c + 1);
    for (const c of this.#outerCables) used = Math.max(used, c + 1);
    return [used, this.cables.length];
  }

  // -- operad structure ------------------------------------------------------------

  /** `id_X: X → X`, the cospan `X → X ← X` of identity maps. */
  static identity(/** @type {Star} */ star) {
    const n = star.size;
    const iota = Uint32Array.from({ length: n }, (_, k) => k);
    return WiringDiagram.#make({
      cables: star.types,
      inner: [star],
      offsets: Uint32Array.of(0, n),
      innerCables: iota,
      outer: star,
      outerCables: iota.slice(),
    });
  }

  /**
   * Operadic composition `this ∘ (ψ₁, …, ψₙ)`: substitute `ψᵢ` into `Xᵢ`.
   *
   * The pushout of `C ← ⊔Xᵢ → ⊔Cᵢ` (Spivak, (2.1.7)), computed by a union–find
   * over `C ⊔ C₁ ⊔ … ⊔ Cₙ`: O(N α(N)) plus sorting the floating cables.
   *
   * @param {readonly WiringDiagram[]} children
   */
  compose(children) {
    if (children.length !== this.arity) {
      throw new WiringError(
        "arity_mismatch",
        `diagram has ${this.arity} inner stars but ${children.length} were given`,
      );
    }
    return this.#substitute(children);
  }

  /**
   * Partial composition `this ∘ᵢ child`. Equal to `compose` with identities
   * elsewhere, but O(size of `this` + size of `child`).
   */
  composeAt(/** @type {number} */ i, /** @type {WiringDiagram} */ child) {
    if (!(Number.isInteger(i) && i >= 0 && i < this.arity)) {
      throw new WiringError("arity_mismatch", `no inner star ${i} in a diagram of arity ${this.arity}`);
    }
    const slots = Array(this.arity).fill(null);
    slots[i] = child;
    return this.#substitute(slots);
  }

  /**
   * The pushout behind both kinds of composition. Slot `i` is a diagram to
   * substitute into `Xᵢ`, or `null` to keep `Xᵢ` (composition with `id_Xᵢ`).
   *
   * @param {readonly (WiringDiagram | null)[]} slots
   */
  #substitute(slots) {
    const types = [...this.cables];
    /** @type {number[]} */
    const base = [];
    slots.forEach((child, i) => {
      if (child === null) {
        base.push(0);
        return;
      }
      if (!child.outer.equals(this.inner[i])) {
        throw new WiringError(
          "star_mismatch",
          `inner star ${i} is ${this.inner[i]} but child ${i} has outer star ${child.outer}`,
        );
      }
      base.push(types.length);
      for (const t of child.cables) types.push(t);
    });

    const uf = new UnionFind(types.length);
    slots.forEach((child, i) => {
      if (child === null) return;
      const mine = this.innerCables(i);
      const theirs = child.#outerCables;
      for (let w = 0; w < mine.length; w++) uf.union(mine[w], base[i] + theirs[w]);
    });
    const root = uf.roots();

    /** @type {Star[]} */
    const stars = [];
    /** @type {number[]} */
    const raw = [];
    slots.forEach((child, i) => {
      if (child === null) {
        stars.push(this.inner[i]);
        for (const c of this.innerCables(i)) raw.push(root[c]);
        return;
      }
      for (const x of child.inner) stars.push(x);
      for (const c of child.#innerCables) raw.push(root[base[i] + c]);
    });
    const outerRaw = Array.from(this.#outerCables, (c) => root[c]);
    const classes = [];
    for (let x = 0; x < root.length; x++) if (root[x] === x) classes.push(x);
    return WiringDiagram.#make(canonical(types, stars, raw, this.outer, outerRaw, classes));
  }

  /**
   * The symmetric group action: inner star `k` of the result is inner star
   * `sigma[k]` of `this`.
   *
   * @param {readonly number[]} sigma
   */
  permute(sigma) {
    const n = this.arity;
    const seen = new Uint8Array(n);
    const ok =
      sigma.length === n &&
      sigma.every((s) => Number.isInteger(s) && s >= 0 && s < n && seen[s]++ === 0);
    if (!ok) {
      throw new WiringError("not_a_permutation", `${JSON.stringify(sigma)} is not a permutation of 0..${n - 1}`);
    }
    const raw = [];
    for (const s of sigma) for (const c of this.innerCables(s)) raw.push(c);
    const all = Array.from(this.cables, (_, c) => c);
    return WiringDiagram.#make(
      canonical(this.cables, sigma.map((s) => this.inner[s]), raw, this.outer, this.#outerCables, all),
    );
  }

  /**
   * The operad functor induced by a function on type names. Mapping every
   * type to one name is the forgetful functor `U: T → S` (Spivak, §4.1).
   *
   * @param {(type: string) => string} f
   */
  mapTypes(f) {
    const types = this.cables.map((t) => f(t));
    /** @param {Star} star @param {ArrayLike<number>} cs */
    const retype = (star, cs) => Star.fromSorted(star.names, Array.from(cs, (c) => types[c]));
    const stars = this.inner.map((x, i) => retype(x, this.innerCables(i)));
    const outer = retype(this.outer, this.#outerCables);
    const all = Array.from(types, (_, c) => c);
    return WiringDiagram.#make(canonical(types, stars, this.#innerCables, outer, this.#outerCables, all));
  }

  // -- equality, serialisation -----------------------------------------------------

  equals(/** @type {WiringDiagram} */ other) {
    if (this === other) return true;
    return (
      sameArray(this.cables, other.cables) &&
      sameArray(this.#innerCables, other.#innerCables) &&
      sameArray(this.#outerCables, other.#outerCables) &&
      this.outer.equals(other.outer) &&
      this.inner.length === other.inner.length &&
      this.inner.every((x, i) => x.equals(other.inner[i]))
    );
  }

  /** A string that is equal for equal morphisms. */
  key() {
    return JSON.stringify(this);
  }

  toJSON() {
    return {
      cables: [...this.cables],
      inner: this.inner.map((_, i) => this.innerWiring(i)),
      outer: this.outerWiring(),
    };
  }

  toString() {
    return `WiringDiagram(${JSON.stringify(this)})`;
  }

  /** Parse `{cables, inner, outer}`; see docs/format.md. */
  static fromJSON(/** @type {unknown} */ data) {
    /** @param {unknown} m */
    const isWiring = (m) => isPlainObject(m) && Object.values(m).every((c) => Number.isInteger(c));
    const ok =
      isPlainObject(data) &&
      sameKeys(data, ["cables", "inner", "outer"]) &&
      Array.isArray(data.cables) &&
      data.cables.every((t) => typeof t === "string") &&
      Array.isArray(data.inner) &&
      data.inner.every(isWiring) &&
      isWiring(data.outer);
    if (!ok) {
      throw new WiringError(
        "invalid_json",
        "a wiring diagram is {cables: [type], inner: [{wire: cable}], outer: {wire: cable}}",
      );
    }
    const d = /** @type {{cables: string[], inner: Record<string, number>[], outer: Record<string, number>}} */ (data);
    return new WiringDiagram(d.cables, d.inner, d.outer);
  }
}

/**
 * Validate one star's `{wire: cable}` and derive the star's types from the cables.
 * @returns {[Star, number[]]}
 */
function wiring(
  /** @type {string[]} */ types,
  /** @type {string} */ where,
  /** @type {Record<string, number> | Iterable<[string, number]>} */ w,
) {
  const pairs = isIterable(w) ? [...w] : Object.entries(w);
  pairs.sort((a, b) => compareCodePoints(a[0], b[0]));
  const k = types.length;
  for (let i = 0; i < pairs.length; i++) {
    const [name, c] = pairs[i];
    if (i > 0 && pairs[i - 1][0] === name) {
      throw new WiringError("duplicate_wire", `${where} wire ${JSON.stringify(name)} appears twice`);
    }
    if (!(Number.isInteger(c) && c >= 0 && c < k)) {
      throw new WiringError(
        "cable_out_of_range",
        `${where} wire ${JSON.stringify(name)} -> cable ${c}, but there are ${k} cables`,
      );
    }
  }
  const star = Star.fromSorted(
    pairs.map((p) => p[0]),
    pairs.map((p) => types[p[1]]),
  );
  return [star, pairs.map((p) => p[1])];
}

/**
 * Relabel raw cable ids by first appearance and append the floating cables
 * sorted by type. `types[c]` is the type of raw cable `c`, and `classes`
 * lists every raw cable of the cospan, including those no wire touches.
 */
function canonical(
  /** @type {readonly string[]} */ types,
  /** @type {readonly Star[]} */ inner,
  /** @type {ArrayLike<number>} */ innerRaw,
  /** @type {Star} */ outer,
  /** @type {ArrayLike<number>} */ outerRaw,
  /** @type {readonly number[]} */ classes,
) {
  const relabel = new Uint32Array(types.length).fill(UNSEEN);
  const cables = [];
  /** @param {number} c */
  const label = (c) => {
    if (relabel[c] === UNSEEN) {
      relabel[c] = cables.length;
      cables.push(types[c]);
    }
    return relabel[c];
  };
  const innerCables = Uint32Array.from(innerRaw, label);
  const outerCables = Uint32Array.from(outerRaw, label);
  const floating = [];
  for (const c of classes) if (relabel[c] === UNSEEN) floating.push(types[c]);
  floating.sort(compareCodePoints);
  for (const t of floating) cables.push(t);

  const offsets = new Uint32Array(inner.length + 1);
  inner.forEach((x, i) => (offsets[i + 1] = offsets[i] + x.size));
  return { cables, inner, offsets, innerCables, outer, outerCables };
}

/** @typedef {{cables: readonly string[], inner: readonly Star[], offsets: Uint32Array, innerCables: Uint32Array, outer: Star, outerCables: Uint32Array}} Parts */

/** @param {ArrayLike<unknown>} a @param {ArrayLike<unknown>} b */
function sameArray(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** @param {object} obj @param {string[]} keys */
function sameKeys(obj, keys) {
  const own = Object.keys(obj);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(obj, k));
}
