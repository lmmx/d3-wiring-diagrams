/** Disjoint sets over `0..n`, with union by size and path halving. */
export class UnionFind {
  constructor(/** @type {number} */ n) {
    this.parent = Uint32Array.from({ length: n }, (_, k) => k);
    this.size = new Uint32Array(n).fill(1);
  }

  find(/** @type {number} */ x) {
    const p = this.parent;
    while (p[x] !== x) {
      p[x] = p[p[x]];
      x = p[x];
    }
    return x;
  }

  union(/** @type {number} */ a, /** @type {number} */ b) {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return;
    if (this.size[ra] < this.size[rb]) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;
    this.size[ra] += this.size[rb];
  }

  roots() {
    return Uint32Array.from(this.parent, (_, x) => this.find(x));
  }
}
