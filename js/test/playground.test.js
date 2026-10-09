// The playground's editing operations (viewer/edit.js): plug-and-play keeps
// the algebra consistent, and collapsing a sub-term preserves the relation.

import assert from "node:assert/strict";
import { it } from "node:test";

import { Term, rel } from "../src/index.js";
import {
  buildLibrary,
  collapse,
  compatible,
  composeAll,
  decodeShare,
  encodeShare,
  leafPath,
  normalize,
  parse,
  plugIn,
  prettyJSON,
} from "../../viewer/edit.js";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PACKAGE_FILES } from "../../viewer/python.js";
import { readSpec } from "./helpers.js";

const docs = readSpec("examples/index.json").map((/** @type {{slug: string}} */ e) => readSpec(`examples/${e.slug}.json`));
const bySlug = (/** @type {string} */ slug) => readSpec(`examples/${slug}.json`);
const library = buildLibrary(docs);

/** The outer relation of a document, recomputed from scratch. */
function outer(/** @type {any} */ doc) {
  const { flat, leaves } = parse(doc);
  return rel.apply(flat, /** @type {rel.Relation[]} */ (leaves), doc.algebra.domains);
}

/** Truth table {A,B,out} of a document whose outer star is a binary gate. */
function table(/** @type {any} */ doc) {
  return new Set(outer(doc).records().map((r) => `${r.A}${r.B}${r.out}`));
}

it("the library holds every labelled sub-term, with its leaf relations", () => {
  const labels = new Set(library.map((e) => e.label));
  for (const name of ["NOT", "AND", "OR", "XOR", "half adder"]) assert.ok(labels.has(name), name);
  for (const e of library) if (e.leaves) assert.equal(e.leaves.length, e.term.evaluate().arity);
});

it("plugging AND into the NAND of NOT gives a gate that copies its input", () => {
  const not = bySlug("not-from-nand");
  const nand = parse(not).flat.inner[0];
  const and = compatible(library, nand).find((e) => e.label === "AND");
  assert.ok(and);
  const plugged = plugIn(not, 0, and);
  const r = outer(plugged);
  assert.deepStrictEqual(r.records(), [{ in: false, out: false }, { in: true, out: true }]);
  assert.deepStrictEqual(plugged.algebra.expected, r.toJSON());
  assert.equal(parse(plugged).flat.arity, 2); // AND = NAND then NOT(NAND)
});

it("plugging XOR into the final NAND of OR changes the truth table as expected", () => {
  const or = bySlug("or-from-nand");
  const { term } = parse(or);
  const k = term.leafLabels().lastIndexOf("NAND"); // the NAND fed by the two NOTs
  const xor = compatible(library, parse(or).flat.inner[k]).find((e) => e.label === "XOR");
  assert.ok(xor);
  // XOR(NOT A, NOT B) = XOR(A, B)
  assert.deepStrictEqual(table(plugIn(or, k, xor)), new Set(["falsefalsefalse", "falsetruetrue", "truefalsetrue", "truetruefalse"]));
});

it("collapsing a sub-term into a leaf keeps the outer relation (functoriality)", () => {
  const adder = bySlug("half-adder");
  const before = outer(adder);
  for (const path of [[0], [1], [1, 1]]) {
    const after = collapse(adder, path);
    assert.ok(outer(after).equals(before), String(path));
    assert.equal(parse(after).leaves?.length, parse(after).flat.arity);
  }
  const collapsed = collapse(adder, [0]);
  assert.equal(Term.fromJSON(collapsed.term).labels[0], "XOR");
});

it("composing the term keeps leaves, labels and the relation", () => {
  const adder = bySlug("half-adder");
  const flat = composeAll(adder);
  assert.equal(Term.fromJSON(flat.term).children.every((k) => k === null), true);
  assert.deepStrictEqual(Term.fromJSON(flat.term).leafLabels(), parse(adder).term.leafLabels());
  assert.ok(outer(flat).equals(outer(adder)));
});

it("leafPath finds the slot of every leaf", () => {
  const { term } = parse(bySlug("half-adder"));
  assert.deepStrictEqual(leafPath(term, 0), [0, 0]);
  assert.deepStrictEqual(leafPath(term, 4), [1, 0]);
  assert.deepStrictEqual(leafPath(term, 5), [1, 1, 0]);
  assert.throws(() => leafPath(term, 6), RangeError);
});

it("documents round-trip through share links and pretty printing", async () => {
  for (const doc of docs) {
    assert.deepStrictEqual(await decodeShare(await encodeShare(doc)), doc);
    assert.deepStrictEqual(JSON.parse(prettyJSON(doc)), doc);
  }
  assert.deepStrictEqual(normalize({ cables: [], inner: [], outer: {} }).term, { diagram: { cables: [], inner: [], outer: {} } });
});

it("the playground loads every module of the Python package into Pyodide", () => {
  const dir = fileURLToPath(new URL("../../python/src/wiring_diagrams/", import.meta.url));
  assert.deepStrictEqual([...PACKAGE_FILES].sort(), readdirSync(dir).filter((f) => f.endsWith(".py")).sort());
});
