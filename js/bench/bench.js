// The workloads of rust/benches/operad.rs, timed in Node: `node bench/bench.js`.
// Reports the median of several runs after a warm-up. Numbers: docs/performance.md.

import { Star, WiringDiagram, rel } from "../src/index.js";

function ring(/** @type {number} */ n) {
  const inner = Array.from({ length: n }, (_, i) => ({ l: i, r: (i + 1) % n, o: n + i }));
  const outer = Object.fromEntries(Array.from({ length: n }, (_, i) => [`o${String(i).padStart(6, "0")}`, n + i]));
  return new WiringDiagram(Array(2 * n).fill("A"), inner, outer);
}

function chain(/** @type {number} */ m) {
  const inner = Array.from({ length: m }, (_, i) => ({ l: i, r: i + 1, o: m + 1 + i }));
  return new WiringDiagram(Array(2 * m + 1).fill("A"), inner, { l: 0, r: m, o: m + 1 });
}

function timed(/** @type {() => unknown} */ f, repeat = 9) {
  f(); // warm up the JIT
  const runs = [];
  for (let k = 0; k < repeat; k++) {
    const t = performance.now();
    f();
    runs.push(performance.now() - t);
  }
  runs.sort((a, b) => a - b);
  return runs[repeat >> 1];
}

/** @type {[string, number][]} */
const rows = [];
for (const n of [100, 1000, 10000]) {
  const outer = ring(n);
  const kids = Array(n).fill(chain(8));
  rows.push([`compose/ring_of_chains/${n}`, timed(() => outer.compose(kids))]);
}
{
  const outer = ring(10000);
  const kid = chain(8);
  rows.push(["compose/compose_at/10000", timed(() => outer.composeAt(5000, kid))]);
}
for (const n of [1000, 10000]) {
  const phi = ring(n);
  const text = JSON.stringify(phi);
  rows.push([`canonical/from_json/${n}`, timed(() => WiringDiagram.fromJSON(JSON.parse(text)))]);
  const sigma = Array.from({ length: n }, (_, i) => n - 1 - i);
  rows.push([`canonical/permute/${n}`, timed(() => phi.permute(sigma))]);
}
for (const [m, d] of [
  [8, 64],
  [32, 64],
  [8, 512],
]) {
  const star = new Star({ l: "N", r: "N" });
  const succ = new rel.Relation(star, Array.from({ length: d }, (_, x) => [x, (x + 1) % d]));
  const phi = new WiringDiagram(Array(m + 1).fill("N"), Array.from({ length: m }, (_, i) => ({ l: i, r: i + 1 })), { a: 0, b: m });
  const doms = { N: Array.from({ length: d }, (_, x) => x) };
  rows.push([`rel/path/m=${m}/d=${d}`, timed(() => rel.apply(phi, Array(m).fill(succ), doms))]);
}
for (const [name, ms] of rows) console.log(`${name.padEnd(32)} ${ms.toFixed(3).padStart(10)} ms`);
