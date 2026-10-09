// The operad laws, the closed structure, and functoriality of Rel and Eq,
// checked over fixed seeds (reproducible; failures name their seed).

import assert from "node:assert/strict";
import { it } from "node:test";

import { WiringDiagram, eq, evaluation, externalize, internalize, rel } from "../src/index.js";
import { DOMAINS, Gen, SEEDS } from "./helpers.js";

const id = WiringDiagram.identity;

/** @param {WiringDiagram} a @param {WiringDiagram} b @param {string} msg */
function same(a, b, msg) {
  assert.ok(a.equals(b), `${msg}\n  ${a}\n  ${b}`);
}

it("identity laws", () => {
  for (const seed of SEEDS) {
    const phi = new Gen(seed).diagram();
    same(phi.compose(phi.inner.map(id)), phi, `right identity, seed ${seed}`);
    same(id(phi.outer).compose([phi]), phi, `left identity, seed ${seed}`);
  }
});

it("associativity", () => {
  for (const seed of SEEDS) {
    const g = new Gen(seed);
    const [phi, psis] = g.twoLevel();
    const chis = psis.map((psi) => psi.inner.map((x) => g.diagram({ outer: x, maxArity: 2 })));
    const lhs = phi.compose(psis.map((psi, i) => psi.compose(chis[i])));
    const rhs = phi.compose(psis).compose(chis.flat());
    same(lhs, rhs, `seed ${seed}`);
  }
});

it("equivariance", () => {
  for (const seed of SEEDS) {
    const g = new Gen(seed);
    const [phi, psis] = g.twoLevel();
    const sigma = g.shuffle(phi.arity);
    const lhs = phi.permute(sigma).compose(sigma.map((s) => psis[s]));
    const starts = [0];
    for (const p of psis) starts.push(starts[starts.length - 1] + p.arity);
    const block = sigma.flatMap((s) => Array.from({ length: psis[s].arity }, (_, j) => starts[s] + j));
    same(lhs, phi.compose(psis).permute(block), `seed ${seed}`);
  }
});

it("permutation is a right action", () => {
  for (const seed of SEEDS) {
    const g = new Gen(seed);
    const phi = g.diagram({ maxArity: 4 });
    const s = g.shuffle(phi.arity);
    const t = g.shuffle(phi.arity);
    same(phi.permute(s).permute(t), phi.permute(t.map((k) => s[k])), `seed ${seed}`);
  }
});

it("partial composition agrees with full composition", () => {
  for (const seed of SEEDS) {
    const g = new Gen(seed);
    const [phi, psis] = g.twoLevel();
    if (phi.arity === 0) continue;
    const i = g.below(phi.arity);
    const kids = phi.inner.map((x, j) => (j === i ? psis[i] : id(x)));
    same(phi.composeAt(i, psis[i]), phi.compose(kids), `seed ${seed}`);
  }
});

it("mapTypes is an operad functor", () => {
  const forget = () => "*";
  for (const seed of SEEDS) {
    const [phi, psis] = new Gen(seed).twoLevel();
    const lhs = phi.compose(psis).mapTypes(forget);
    same(lhs, phi.mapTypes(forget).compose(psis.map((p) => p.mapTypes(forget))), `seed ${seed}`);
  }
});

it("internalize and externalize are inverse, and extl = ev ∘ (φ, id…)", () => {
  for (const seed of SEEDS) {
    const g = new Gen(seed);
    const phi = g.diagram({ maxArity: 4 });
    const m = g.below(phi.arity + 1);
    const ys = phi.inner.slice(m);
    const curried = internalize(phi, m);
    const back = externalize(curried, ys, phi.outer);
    same(back, phi, `inverse, seed ${seed}`);
    same(evaluation(ys, phi.outer).compose([curried, ...ys.map(id)]), back, `ev, seed ${seed}`);
  }
});

it("Rel respects composition, identities and the symmetric action", () => {
  for (const seed of SEEDS) {
    const g = new Gen(seed);
    const [phi, psis] = g.twoLevel();
    const leaves = psis.map((p) => p.inner.map((x) => g.relation(x)));
    const mids = psis.map((p, i) => rel.apply(p, leaves[i], DOMAINS));
    const stepwise = rel.apply(phi, mids, DOMAINS);
    const flat = rel.apply(phi.compose(psis), leaves.flat(), DOMAINS);
    assert.ok(stepwise.equals(flat), `composition, seed ${seed}`);
    phi.inner.forEach((x, i) => assert.ok(rel.apply(id(x), [mids[i]], DOMAINS).equals(mids[i]), `identity, seed ${seed}`));
    const sigma = g.shuffle(phi.arity);
    const permuted = rel.apply(phi.permute(sigma), sigma.map((s) => mids[s]), DOMAINS);
    assert.ok(permuted.equals(stepwise), `equivariance, seed ${seed}`);
  }
});

it("Rel preserves unions in each argument (Proposition 4.3.1)", () => {
  for (const seed of SEEDS) {
    const g = new Gen(seed);
    const phi = g.diagram();
    if (phi.arity === 0) continue;
    const rs = phi.inner.map((x) => g.relation(x));
    const i = g.below(phi.arity);
    const extra = g.relation(phi.inner[i]);
    const joined = rs.map((r, j) => (j === i ? r.union(extra) : r));
    const alt = rs.map((r, j) => (j === i ? extra : r));
    const lhs = rel.apply(phi, joined, DOMAINS);
    const rhs = rel.apply(phi, rs, DOMAINS).union(rel.apply(phi, alt, DOMAINS));
    assert.ok(lhs.equals(rhs), `seed ${seed}`);
  }
});

it("Eq respects composition", () => {
  for (const seed of SEEDS) {
    const g = new Gen(seed);
    const [phi, psis] = g.twoLevel();
    const leaves = psis.map((p) =>
      p.inner.map((x) => new eq.Partition(x, x.names.map(() => g.below(3)))),
    );
    const mids = psis.map((p, i) => eq.apply(p, leaves[i]));
    const stepwise = eq.apply(phi, mids);
    const flat = eq.apply(phi.compose(psis), leaves.flat());
    assert.ok(stepwise.equals(flat), `seed ${seed}`);
  }
});
