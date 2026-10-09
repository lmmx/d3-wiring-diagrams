/**
 * The relational algebra Rel (Spivak, Example 2.2.10, Lemma 4.1.2, §4.3, §5.2).
 *
 * `Rel(φ)(R₁, …, Rₙ)` is the φ-conjunction: the set of `c ∘ g` over cable
 * assignments `c` with `c ∘ f|Xᵢ ∈ Rᵢ` for every `i` (a conjunctive query).
 * The evaluation plan matches the Python and Rust implementations: selection on
 * repeated cables, then greedy hash joins with early projection, and declared
 * domains for output-only and floating cables.
 *
 * Values are JSON scalars (string, finite number, boolean, null). Two values
 * are equal when they have the same JSON text, so `1` and `"1"` differ.
 */

import { evaluation, internalHom } from "./closed.js";
import { WiringDiagram } from "./diagram.js";
import { WiringError } from "./errors.js";
import { compareCodePoints } from "./order.js";
import { Star, isPlainObject } from "./star.js";

/** @typedef {string | number | boolean | null} Scalar */
/** @typedef {Record<string, readonly Scalar[]>} Domains */

const rowKey = (/** @type {readonly Scalar[]} */ row) => JSON.stringify(row);

/** Total order on scalars: booleans < numbers < strings < null, then by value. */
export function compareScalars(/** @type {Scalar} */ a, /** @type {Scalar} */ b) {
  const rank = (/** @type {Scalar} */ v) =>
    typeof v === "boolean" ? 0 : typeof v === "number" ? 1 : typeof v === "string" ? 2 : 3;
  const d = rank(a) - rank(b);
  if (d !== 0) return d;
  if (typeof a === "string") return compareCodePoints(a, /** @type {string} */ (b));
  return a === b ? 0 : /** @type {number} */ (a) < /** @type {number} */ (b) ? -1 : 1;
}

/** @param {readonly Scalar[]} a @param {readonly Scalar[]} b */
function compareRows(a, b) {
  for (let i = 0; i < a.length; i++) {
    const c = compareScalars(a[i], b[i]);
    if (c !== 0) return c;
  }
  return 0;
}

/** A finite relation on a star: a set of rows, one value per wire in canonical order. */
export class Relation {
  #keys;

  /**
   * @param {Star} star
   * @param {Iterable<readonly Scalar[]>} rows
   */
  constructor(star, rows) {
    const byKey = new Map();
    for (const row of rows) {
      if (row.length !== star.size) {
        throw new WiringError(
          "relation_arity",
          `row ${JSON.stringify(row)} has ${row.length} values, star has ${star.size} wires`,
        );
      }
      byKey.set(rowKey(row), Object.freeze([...row]));
    }
    this.star = star;
    /** @type {readonly (readonly Scalar[])[]} rows in ascending order */
    this.rows = Object.freeze([...byKey.values()].sort(compareRows));
    this.#keys = new Set(byKey.keys());
    Object.freeze(this);
  }

  /** All rows over the declared domains that satisfy `predicate(record)`. */
  static fromPredicate(
    /** @type {Star} */ star,
    /** @type {Domains} */ domains,
    /** @type {(record: Record<string, Scalar>) => boolean} */ predicate,
  ) {
    const doms = star.types.map((t) => domain(domains, t));
    const rows = [];
    for (const row of product(doms)) {
      if (predicate(Object.fromEntries(star.names.map((n, k) => [n, row[k]])))) rows.push(row);
    }
    return new Relation(star, rows);
  }

  static full(/** @type {Star} */ star, /** @type {Domains} */ domains) {
    return new Relation(star, product(star.types.map((t) => domain(domains, t))));
  }

  get size() {
    return this.rows.length;
  }

  has(/** @type {readonly Scalar[]} */ row) {
    return this.#keys.has(rowKey(row));
  }

  /** @returns {Record<string, Scalar>[]} */
  records() {
    return this.rows.map((r) => Object.fromEntries(this.star.names.map((n, k) => [n, r[k]])));
  }

  /** Join in the semilattice `JRel(X)` (Spivak, Proposition 4.3.1). */
  union(/** @type {Relation} */ other) {
    if (!other.star.equals(this.star)) {
      throw new WiringError("star_mismatch", `${this.star} vs ${other.star}`);
    }
    return new Relation(this.star, [...this.rows, ...other.rows]);
  }

  equals(/** @type {Relation} */ other) {
    return (
      this.star.equals(other.star) &&
      this.rows.length === other.rows.length &&
      this.rows.every((r) => other.has(r))
    );
  }

  toJSON() {
    return { wires: [...this.star.names], rows: this.rows.map((r) => [...r]) };
  }

  /** Parse `{wires, rows}` as a relation on `star`. */
  static fromJSON(/** @type {Star} */ star, /** @type {unknown} */ data) {
    if (!isPlainObject(data) || !Array.isArray(data.wires) || !Array.isArray(data.rows)) {
      throw new WiringError("invalid_json", "a relation is {wires: [name], rows: [[value]]}");
    }
    const wires = /** @type {unknown[]} */ (data.wires);
    if (wires.length !== star.size || wires.some((w, k) => w !== star.names[k])) {
      throw new WiringError("star_mismatch", `relation on wires ${JSON.stringify(wires)}, expected ${star}`);
    }
    if (!data.rows.every(Array.isArray)) throw new WiringError("invalid_json", "rows must be arrays");
    return new Relation(star, /** @type {Scalar[][]} */ (data.rows));
  }
}

/** @returns {readonly Scalar[]} */
function domain(/** @type {Domains | undefined} */ domains, /** @type {string} */ type) {
  if (!domains || !Object.hasOwn(domains, type)) {
    throw new WiringError("missing_domain", `no finite domain declared for type ${JSON.stringify(type)}`);
  }
  return domains[type];
}

/** Cartesian product, last coordinate fastest. @param {readonly (readonly Scalar[])[]} doms */
function* product(doms) {
  if (doms.some((d) => d.length === 0)) return;
  const idx = new Array(doms.length).fill(0);
  for (;;) {
    yield idx.map((j, k) => doms[k][j]);
    let k = doms.length;
    for (;;) {
      if (k === 0) return;
      k--;
      if (++idx[k] < doms[k].length) break;
      idx[k] = 0;
    }
  }
}

/** @typedef {{cols: number[], rows: Map<string, Scalar[]>}} Table */

/**
 * `Rel(φ)(R₁, …, Rₙ)`, the φ-conjunction of the relations.
 *
 * @param {WiringDiagram} phi
 * @param {readonly Relation[]} relations
 * @param {Domains} [domains]
 */
export function apply(phi, relations, domains) {
  if (relations.length !== phi.arity) {
    throw new WiringError("arity_mismatch", `diagram has ${phi.arity} inner stars, got ${relations.length} relations`);
  }
  const k = phi.cables.length;
  const constrained = new Uint8Array(k);
  /** @type {Table[]} */
  const tables = [];
  relations.forEach((r, i) => {
    if (!r.star.equals(phi.inner[i])) {
      throw new WiringError("star_mismatch", `relation ${i} is on ${r.star}, expected ${phi.inner[i]}`);
    }
    const wiring = phi.innerCables(i);
    for (const c of wiring) constrained[c] = 1;
    tables.push(select(wiring, r.rows));
  });
  for (const c of phi.outerCables) {
    if (!constrained[c]) {
      const rows = new Map(domain(domains, phi.cables[c]).map((v) => [rowKey([v]), [v]]));
      tables.push({ cols: [c], rows });
      constrained[c] = 1;
    }
  }
  for (let c = 0; c < k; c++) {
    if (!constrained[c] && domain(domains, phi.cables[c]).length === 0) return new Relation(phi.outer, []);
  }

  const result = joinAll(tables, new Set(phi.outerCables));
  if (result.rows.size === 0) return new Relation(phi.outer, []);
  const pos = Array.from(phi.outerCables, (c) => result.cols.indexOf(c));
  return new Relation(
    phi.outer,
    Array.from(result.rows.values(), (r) => pos.map((j) => r[j])),
  );
}

/** A relation on `Xᵢ` as a table over its distinct cables. @returns {Table} */
function select(/** @type {ArrayLike<number>} */ wiring, /** @type {readonly (readonly Scalar[])[]} */ rows) {
  /** @type {number[]} */
  const cols = [];
  /** @type {number[]} */
  const reps = [];
  /** @type {[number, number][]} */
  const checks = [];
  for (let w = 0; w < wiring.length; w++) {
    const j = cols.indexOf(wiring[w]);
    if (j >= 0) checks.push([w, reps[j]]);
    else {
      cols.push(wiring[w]);
      reps.push(w);
    }
  }
  const out = new Map();
  for (const r of rows) {
    if (checks.every(([a, b]) => rowKey([r[a]]) === rowKey([r[b]]))) {
      const t = reps.map((w) => r[w]);
      out.set(rowKey(t), t);
    }
  }
  return { cols, rows: out };
}

/** @param {Table[]} tables @param {Set<number>} keep @returns {Table} */
function joinAll(tables, keep) {
  const remaining = [...tables].sort((a, b) => a.rows.size - b.rows.size);
  /** @type {Table} */
  let cur = { cols: [], rows: new Map([["[]", []]]) };
  while (remaining.length > 0) {
    if (cur.rows.size === 0) return cur;
    // most shared cables, then fewest rows, then earliest
    let best = 0;
    let bestScore = [-1, 0];
    remaining.forEach((t, j) => {
      const shared = t.cols.filter((c) => cur.cols.includes(c)).length;
      if (shared > bestScore[0] || (shared === bestScore[0] && t.rows.size < bestScore[1])) {
        best = j;
        bestScore = [shared, t.rows.size];
      }
    });
    const [next] = remaining.splice(best, 1);
    cur = hashJoin(cur, next);
    const needed = (/** @type {number} */ c) => keep.has(c) || remaining.some((t) => t.cols.includes(c));
    cur = project(cur, needed);
  }
  return cur;
}

/** @param {Table} a @param {Table} b @returns {Table} */
function hashJoin(a, b) {
  const shared = a.cols.filter((c) => b.cols.includes(c));
  const aKey = shared.map((c) => a.cols.indexOf(c));
  const bKey = shared.map((c) => b.cols.indexOf(c));
  const bRest = b.cols.map((_, j) => j).filter((j) => !shared.includes(b.cols[j]));
  /** @type {Map<string, Scalar[][]>} */
  const index = new Map();
  for (const r of b.rows.values()) {
    const key = rowKey(bKey.map((j) => r[j]));
    let tails = index.get(key);
    if (!tails) index.set(key, (tails = []));
    tails.push(bRest.map((j) => r[j]));
  }
  const rows = new Map();
  for (const r of a.rows.values()) {
    for (const tail of index.get(rowKey(aKey.map((j) => r[j]))) ?? []) {
      const joined = r.concat(tail);
      rows.set(rowKey(joined), joined);
    }
  }
  return { cols: a.cols.concat(bRest.map((j) => b.cols[j])), rows };
}

/** @param {Table} t @param {(c: number) => boolean} needed @returns {Table} */
function project(t, needed) {
  const keepIdx = t.cols.map((_, j) => j).filter((j) => needed(t.cols[j]));
  if (keepIdx.length === t.cols.length) return t;
  const rows = new Map();
  for (const r of t.rows.values()) {
    const p = keepIdx.map((j) => r[j]);
    rows.set(rowKey(p), p);
  }
  return { cols: keepIdx.map((j) => t.cols[j]), rows };
}

/**
 * The closing transformation `Rel([Y ⇒ Z]) → [Rel(Y) ⇒ Rel(Z)]` (Definition 5.1.6).
 * @returns {(rs: readonly Relation[]) => Relation}
 */
export function close(
  /** @type {Relation} */ q,
  /** @type {readonly Star[]} */ ys,
  /** @type {Star} */ z,
  /** @type {Domains} */ domains,
) {
  const ev = evaluation(ys, z);
  if (!q.star.equals(ev.inner[0])) throw new WiringError("hom_mismatch", `${q.star} is not [Y ⇒ Z]`);
  return (rs) => apply(ev, [q, ...rs], domains);
}

/**
 * The greatest recursive relation of a recursive setup `phi: X → [Z ⇒ Z]`
 * (Spivak, §5.2): iterate the monotone `q` down from the full relation until it
 * stops changing. At most `|∏ τ| + 1` steps; every fixed point lies below it.
 */
export function recursive(
  /** @type {WiringDiagram} */ phi,
  /** @type {readonly Relation[]} */ relations,
  /** @type {Star} */ z,
  /** @type {Domains} */ domains,
) {
  const hom = internalHom([z], z);
  if (!phi.outer.equals(hom)) {
    throw new WiringError("hom_mismatch", `outer star ${phi.outer} is not [Z ⇒ Z] = ${hom}`);
  }
  const q = close(apply(phi, relations, domains), [z], z, domains);
  let current = Relation.full(z, domains);
  for (;;) {
    const next = q([current]);
    if (next.equals(current)) return current;
    current = next;
  }
}
