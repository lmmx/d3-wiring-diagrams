// Editing operations for the playground, on documents in the shared JSON format.
// Pure functions: no DOM, so js/test/playground.test.js runs them in Node.
//
// A *document* is an example object {title, source, description, term, algebra?}
// (docs/format.md). Every operation takes a document and returns a new one, and
// keeps the algebra consistent. Leaf relations stay aligned with the leaves of
// the term, and `expected` is recomputed.

import { Star, Term, rel } from "../js/src/index.js";

/**
 * @typedef {{kind: "rel" | "rel_recursive", domains: rel.Domains, relations: any[], expected: any}} Algebra
 * @typedef {{title: string, source: string, description: string, term: any, algebra?: Algebra}} Doc
 * @typedef {{id: string, label: string, from: string, term: Term, leaves: rel.Relation[] | null, domains: rel.Domains}} Entry
 */

/** Accept an example, a term, or a bare diagram, and return a document. @returns {Doc} */
export function normalize(/** @type {any} */ data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError("expected a JSON object: an example, a term or a diagram");
  }
  if ("term" in data) return { title: "Untitled", source: "", description: "", ...data };
  if ("diagram" in data) return { title: "Term", source: "", description: "", term: data };
  return { title: "Wiring diagram", source: "", description: "", term: { diagram: data } };
}

/** The parsed term and leaf relations of a document. */
export function parse(/** @type {Doc} */ doc) {
  const term = Term.fromJSON(doc.term);
  const flat = term.evaluate();
  const alg = doc.algebra;
  if (alg && (!Array.isArray(alg.relations) || alg.relations.length !== flat.arity)) {
    throw new RangeError(`algebra.relations has ${alg.relations?.length} entries for ${flat.arity} leaves`);
  }
  const leaves = alg ? flat.inner.map((x, i) => rel.Relation.fromJSON(x, alg.relations[i])) : null;
  return { term, flat, leaves };
}

/** @param {Term} t @returns {number} */
export function leafCount(t) {
  return t.children.reduce((n, kid) => n + (kid === null ? 1 : leafCount(kid)), 0);
}

/** Indices from the root to the open slot holding leaf `k`. @returns {number[]} */
export function leafPath(/** @type {Term} */ t, /** @type {number} */ k) {
  let offset = 0;
  for (let i = 0; i < t.children.length; i++) {
    const kid = t.children[i];
    const n = kid === null ? 1 : leafCount(kid);
    if (k < offset + n) return kid === null ? [i] : [i, ...leafPath(kid, k - offset)];
    offset += n;
  }
  throw new RangeError(`no leaf ${k}`);
}

/** The sub-term at `path` and the index of its first leaf. @returns {[Term, number]} */
export function subtermAt(/** @type {Term} */ t, /** @type {readonly number[]} */ path) {
  let offset = 0;
  for (const i of path) {
    for (let j = 0; j < i; j++) {
      const kid = t.children[j];
      offset += kid === null ? 1 : leafCount(kid);
    }
    const kid = t.children[i];
    if (kid === null) throw new RangeError(`slot ${path.join(".")} is open`);
    t = kid;
  }
  return [t, offset];
}

/** `t` with slot `path` filled by `child` (or emptied, with `null`). @returns {Term} */
export function replaceAt(/** @type {Term} */ t, /** @type {readonly number[]} */ path, /** @type {Term | null} */ child) {
  const [i, ...rest] = path;
  if (i === undefined) throw new RangeError("empty path");
  const kids = [...t.children];
  if (rest.length === 0) kids[i] = child;
  else {
    const kid = kids[i];
    if (kid === null) throw new RangeError(`slot ${i} is open`);
    kids[i] = replaceAt(kid, rest, child);
  }
  return new Term(t.diagram, kids, t.labels, t.label);
}

/** Rel of a term level by level, consuming `leaves` in order. */
export function nestedRel(/** @type {Term} */ t, /** @type {readonly rel.Relation[]} */ leaves, /** @type {rel.Domains} */ domains) {
  let next = 0;
  /** @type {(u: Term) => rel.Relation} */
  const go = (u) =>
    rel.apply(
      u.diagram,
      u.children.map((kid) => (kid === null ? leaves[next++] : go(kid))),
      domains,
    );
  return go(t);
}

/** `Z` from an outer star `[Z ⇒ Z]` (its `out.*` wires). */
export function recursiveStar(/** @type {import("../js/src/index.js").WiringDiagram} */ flat) {
  /** @type {[string, string][]} */
  const wires = [...flat.outer].filter(([n]) => n.startsWith("out.")).map(([n, t]) => [n.slice(4), t]);
  return new Star(wires);
}

/**
 * Rebuild a document from a term and leaf relations, recomputing `expected`.
 * @param {Doc} doc @param {Term} term @param {rel.Relation[] | null} leaves @param {rel.Domains} [domains]
 * @returns {Doc}
 */
function rebuild(doc, term, leaves, domains) {
  const out = { ...doc, term: term.toJSON() };
  if (!doc.algebra || leaves === null) {
    delete out.algebra;
    return out;
  }
  const doms = domains ?? doc.algebra.domains;
  const flat = term.evaluate();
  const expected =
    doc.algebra.kind === "rel_recursive"
      ? rel.recursive(flat, leaves, recursiveStar(flat), doms)
      : rel.apply(flat, leaves, doms);
  out.algebra = { kind: doc.algebra.kind, domains: doms, relations: leaves.map((r) => r.toJSON()), expected: expected.toJSON() };
  return out;
}

/**
 * Plug a library entry into leaf `k` (plug-and-play, Spivak §5.1): the leaf's
 * slot is filled with the entry's term, and the leaf's relation is replaced by
 * the entry's leaf relations. If the entry has no relations, the document
 * loses its algebra.
 *
 * @param {Doc} doc @param {number} k @param {Entry} entry @returns {Doc}
 */
export function plugIn(doc, k, entry) {
  const { term, leaves } = parse(doc);
  const next = replaceAt(term, leafPath(term, k), entry.term);
  if (!leaves || !entry.leaves) return rebuild(doc, next, null);
  const spliced = [...leaves.slice(0, k), ...entry.leaves, ...leaves.slice(k + 1)];
  return rebuild(doc, next, spliced, { ...entry.domains, ...doc.algebra?.domains });
}

/**
 * Collapse the sub-term at `path` back into one leaf. Its relation becomes the
 * relation the sub-term computes, so the outer relation is unchanged
 * (functoriality).
 *
 * @param {Doc} doc @param {readonly number[]} path @returns {Doc}
 */
export function collapse(doc, path) {
  const { term, leaves } = parse(doc);
  const [sub, offset] = subtermAt(term, path);
  const n = leafCount(sub);
  const parentPath = path.slice(0, -1);
  const [parent] = parentPath.length ? subtermAt(term, parentPath) : [term];
  const slot = /** @type {number} */ (path[path.length - 1]);
  // keep the sub-term's name as the leaf's label
  const labels = [...parent.labels];
  labels[slot] = sub.label ?? labels[slot];
  const relabelled = new Term(parent.diagram, parent.children, labels, parent.label);
  const withLabel = parentPath.length ? replaceAt(term, parentPath, relabelled) : relabelled;
  const next = replaceAt(withLabel, path, null);
  if (!leaves || !doc.algebra) return rebuild(doc, next, null);
  const r = nestedRel(sub, leaves.slice(offset, offset + n), doc.algebra.domains);
  return rebuild(doc, next, [...leaves.slice(0, offset), r, ...leaves.slice(offset + n)]);
}

/** Replace the term by its composite: one diagram, with the leaf labels. @returns {Doc} */
export function composeAll(/** @type {Doc} */ doc) {
  const { term, flat, leaves } = parse(doc);
  return rebuild(doc, new Term(flat, undefined, term.leafLabels(), term.label), leaves);
}

/**
 * Every labelled term and sub-term of the given documents, with its leaf
 * relations where the document has them. Recursive setups are left out:
 * their outer star `[Z ⇒ Z]` fits no other example.
 *
 * @param {readonly Doc[]} docs @returns {Entry[]}
 */
export function buildLibrary(docs) {
  /** @type {Map<string, Entry>} */
  const seen = new Map();
  for (const doc of docs) {
    if (doc.algebra?.kind === "rel_recursive") continue;
    const { term, leaves } = parse(doc);
    const domains = doc.algebra?.domains ?? {};
    /** @param {Term} t @param {number} offset @param {string | null} label */
    const visit = (t, offset, label) => {
      const name = t.label ?? label;
      if (name !== null) {
        const own = leaves ? leaves.slice(offset, offset + leafCount(t)) : null;
        const id = JSON.stringify([t.toJSON(), own?.map((r) => r.toJSON()) ?? null]);
        if (!seen.has(id)) seen.set(id, { id, label: name, from: doc.title, term: t, leaves: own, domains });
      }
      let o = offset;
      t.children.forEach((kid, i) => {
        if (kid !== null) visit(kid, o, t.labels[i]);
        o += kid === null ? 1 : leafCount(kid);
      });
    };
    visit(term, 0, null);
  }
  return [...seen.values()];
}

/** Library entries that fit a star (same wire names and types). */
export function compatible(/** @type {readonly Entry[]} */ library, /** @type {Star} */ star) {
  return library.filter((e) => e.term.diagram.outer.equals(star));
}

/**
 * Indented JSON in which arrays and objects of scalars (rows, wirings) stay on one line.
 * @param {unknown} value @param {number} [depth] @returns {string}
 */
export function prettyJSON(value, depth = 0) {
  const pad = " ".repeat(depth);
  const inner = " ".repeat(depth + 1);
  const nested = (/** @type {unknown} */ v) => typeof v === "object" && v !== null;
  if (Array.isArray(value) && value.some(nested)) {
    return `[\n${value.map((v) => inner + prettyJSON(v, depth + 1)).join(",\n")}\n${pad}]`;
  }
  if (nested(value) && !Array.isArray(value) && Object.values(/** @type {object} */ (value)).some(nested)) {
    /** @type {string[]} */
    const items = Object.entries(/** @type {object} */ (value)).map(([k, v]) => `${inner}${JSON.stringify(k)}: ${prettyJSON(v, depth + 1)}`);
    return `{\n${items.join(",\n")}\n${pad}}`;
  }
  return JSON.stringify(value);
}

// -- share links: deflate-raw + base64url in the URL fragment ---------------------------

/** @returns {Promise<string>} */
export async function encodeShare(/** @type {Doc} */ doc) {
  const stream = new Blob([JSON.stringify(doc)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** @returns {Promise<Doc>} */
export async function decodeShare(/** @type {string} */ code) {
  const bin = atob(code.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return normalize(JSON.parse(await new Response(stream).text()));
}
