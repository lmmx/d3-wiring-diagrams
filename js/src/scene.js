/**
 * A term as a flat list of drawable primitives, in the outer star's unit
 * coordinates. Pure: no DOM, no d3.
 *
 * Two views of the same term:
 *
 * - **nested**: every sub-term is drawn inside the star it fills. Each child
 *   is laid out with its outer wires pinned to the angles its parent gave that
 *   star, so wires run continuously through the intermediate circles. This is
 *   Spivak's picture (13) before the intermediate stars are removed.
 * - **flat**: the composite `term.evaluate()`, laid out on its own.
 *
 * Leaf stars, their wires, and the outer star have the same keys in both
 * views. A keyed renderer can therefore animate one view into the other. The
 * intermediate circles exist only in the nested view, so they fade out, and
 * the cables are redrawn.
 *
 * Every cable primitive carries a `group`. In the nested view the group is
 * the pushout class: the cable of the composite that the cable becomes once the
 * intermediate stars are removed. Highlighting a group shows which cables the
 * composition formula glues together.
 */

import { layout } from "./layout.js";
import { Term } from "./term.js";
import { WiringDiagram } from "./diagram.js";
import { compareCodePoints } from "./order.js";

const STUB = 0.035;
const FONT = 0.052;

/**
 * @typedef {{x: number, y: number, s: number}} Frame  maps unit coords into the parent's
 * @typedef {{key: string, role: "outer" | "intermediate" | "leaf", x: number, y: number, r: number, label: string | null, depth: number, path: string, signature: string}} StarItem
 * @typedef {{key: string, x1: number, y1: number, x2: number, y2: number, type: string, group: string, star: string, name: string}} WireItem
 * @typedef {{key: string, x: number, y: number, text: string, anchor: "start" | "middle" | "end", size: number, role: "wire" | "star"}} LabelItem
 * @typedef {{key: string, d: string, type: string, group: string, kind: string, depth: number, wires: string[]}} CableItem
 * @typedef {{key: string, x: number, y: number, r: number, type: string, group: string, hollow: boolean}} DotItem
 * @typedef {{stars: StarItem[], wires: WireItem[], labels: LabelItem[], cables: CableItem[], dots: DotItem[], types: string[]}} Scene
 */

/**
 * @param {Term | WiringDiagram} input
 * @param {{nested?: boolean}} [options]
 * @returns {Scene}
 */
export function buildScene(input, { nested = true } = {}) {
  const term = input instanceof Term ? input : new Term(input);
  /** @type {Scene} */
  const out = { stars: [], wires: [], labels: [], cables: [], dots: [], types: [] };
  const types = new Set();
  const groups = new Groups();
  if (nested) {
    drawLevel(term, { x: 0, y: 0, s: 1 }, "r", 0, undefined, { leaf: 0 }, out, groups, types);
    for (const c of out.cables) c.group = groups.find(c.group);
    for (const w of out.wires) w.group = groups.find(w.group);
    for (const d of out.dots) d.group = groups.find(d.group);
  } else {
    const flat = new Term(term.evaluate(), null, term.leafLabels(), term.label);
    drawLevel(flat, { x: 0, y: 0, s: 1 }, "f", 0, undefined, { leaf: 0 }, out, groups, types);
  }
  out.types = [...types].sort(compareCodePoints);
  return out;
}

/**
 * Draw one level of the term and recurse into its children.
 *
 * @param {Term} term @param {Frame} frame @param {string} path @param {number} depth
 * @param {number[] | undefined} outerAngles @param {{leaf: number}} counter
 * @param {Scene} out @param {Groups} groups @param {Set<string>} types
 */
function drawLevel(term, frame, path, depth, outerAngles, counter, out, groups, types) {
  const phi = term.diagram;
  const weights = term.children.map((kid) => (kid === null ? 1 : leafCount(kid)));
  const L = layout(phi, { outerAngles, weights });
  const P = (/** @type {number} */ x, /** @type {number} */ y) => [frame.x + frame.s * x, frame.y + frame.s * y];
  const isRoot = depth === 0;
  const outerKey = isRoot ? "outer" : path;
  for (const t of phi.cables) types.add(t);

  // the outer star of this level: the root, or an intermediate star of the parent
  out.stars.push({
    key: outerKey,
    role: isRoot ? "outer" : "intermediate",
    x: frame.x,
    y: frame.y,
    r: frame.s,
    label: term.label,
    depth,
    path,
    signature: signature(phi),
  });
  if (term.label !== null) {
    const [x, y] = P(0, -1 - (isRoot ? 0.17 : 0.12));
    out.labels.push({ key: `${outerKey}:label`, x, y, text: term.label, anchor: "middle", size: FONT * frame.s * (isRoot ? 1.1 : 0.9), role: "star" });
  }
  L.outer.ports.forEach((q) => {
    const [x1, y1] = P(q.x, q.y);
    const [x2, y2] = P(q.x + STUB * q.nx, q.y + STUB * q.ny);
    const group = `${path}#${q.cable}`;
    groups.add(group);
    out.wires.push({ key: `${outerKey}/${q.name}`, x1, y1, x2, y2, type: q.type, group, star: outerKey, name: q.name });
    if (isRoot) {
      // outer wire names sit outside the circle
      const [lx, ly] = P(q.x * 1.075, q.y * 1.075);
      out.labels.push({ key: `outer/${q.name}:label`, x: lx, y: ly, text: q.name, anchor: anchorFor(q.x), size: FONT * frame.s, role: "wire" });
    }
  });

  L.stars.forEach((s, i) => {
    const kid = term.children[i];
    const childPath = `${path}.${i}`;
    if (kid !== null) {
      const childFrame = { x: frame.x + frame.s * s.x, y: frame.y + frame.s * s.y, s: frame.s * s.r };
      // glue: wire w of this star joins our cable to the child's cable of its outer wire w
      s.ports.forEach((q, w) => {
        const childCable = kid.diagram.outerCables[w];
        groups.union(`${path}#${q.cable}`, `${childPath}#${childCable}`);
      });
      const kidTerm = kid.label === null && term.labels[i] !== null ? relabel(kid, term.labels[i]) : kid;
      drawLevel(kidTerm, childFrame, childPath, depth + 1, s.ports.map((q) => q.angle), counter, out, groups, types);
      // the parent's half of each through-wire: a stub outside the intermediate circle
      s.ports.forEach((q) => {
        const [x1, y1] = P(q.x, q.y);
        const [x2, y2] = P(q.x + STUB * q.nx, q.y + STUB * q.ny);
        out.wires.push({ key: `${childPath}/${q.name}:out`, x1, y1, x2, y2, type: q.type, group: `${path}#${q.cable}`, star: childPath, name: q.name });
      });
      return;
    }
    const key = `leaf:${counter.leaf++}`;
    const [cx, cy] = P(s.x, s.y);
    out.stars.push({ key, role: "leaf", x: cx, y: cy, r: frame.s * s.r, label: term.labels[i], depth: depth + 1, path: childPath, signature: String(phi.inner[i]) });
    const r = frame.s * s.r;
    if (term.labels[i] !== null) {
      out.labels.push({ key: `${key}:label`, x: cx, y: cy, text: /** @type {string} */ (term.labels[i]), anchor: "middle", size: Math.min(FONT * frame.s, 0.3 * r), role: "star" });
    }
    s.ports.forEach((q) => {
      const [x1, y1] = P(q.x, q.y);
      const [x2, y2] = P(q.x + STUB * q.nx, q.y + STUB * q.ny);
      const group = `${path}#${q.cable}`;
      groups.add(group);
      out.wires.push({ key: `${key}/${q.name}`, x1, y1, x2, y2, type: q.type, group, star: key, name: q.name });
      // wire names sit inside the circle, two thirds of the way out from the centre
      out.labels.push({ key: `${key}/${q.name}:label`, x: cx + 0.66 * r * q.nx, y: cy + 0.66 * r * q.ny, text: q.name, anchor: "middle", size: Math.min(0.8 * FONT * frame.s, 0.24 * r), role: "wire" });
    });
  });

  for (const c of L.cables) {
    const group = `${path}#${c.index}`;
    groups.add(group);
    const d = c.curves
      .map((curve) => {
        const [x0, y0] = P(curve.x0, curve.y0);
        const segs = curve.segments.map((seg) => {
          const [a, b] = P(seg[0], seg[1]);
          const [e, f] = P(seg[2], seg[3]);
          const [g, h] = P(seg[4], seg[5]);
          return `C${fmt(a)},${fmt(b)} ${fmt(e)},${fmt(f)} ${fmt(g)},${fmt(h)}`;
        });
        return `M${fmt(x0)},${fmt(y0)}${segs.join("")}`;
      })
      .join("");
    // readable names of the soldered wires, for tooltips: "NAND.out", "Y.in"
    const wires = c.ends.map((e) =>
      e.star < 0
        ? `${term.label ?? "Y"}.${L.outer.ports[e.port].name}`
        : `${term.labels[e.star] ?? `X${e.star + 1}`}.${L.stars[e.star].ports[e.port].name}`,
    );
    out.cables.push({ key: `${path}#${c.index}`, d, type: c.type, group, kind: c.kind, depth, wires });
    if (c.junction && c.kind !== "floating") {
      const [x, y] = P(c.junction.x, c.junction.y);
      out.dots.push({ key: `${path}#${c.index}:dot`, x, y, r: 0.011 * frame.s, type: c.type, group, hollow: c.kind === "dangling" });
    }
  }
}

/** @param {Term} t @returns {number} */
function leafCount(t) {
  return t.children.reduce((n, kid) => n + (kid === null ? 1 : leafCount(kid)), 0);
}

/** @param {Term} t @param {string} label */
function relabel(t, label) {
  return new Term(t.diagram, t.children, t.labels, label);
}

/** `X₁, …, Xₙ → Y` with types. @param {WiringDiagram} phi */
function signature(phi) {
  return `(${phi.inner.map(String).join(", ")}) → ${phi.outer}`;
}

/** @param {number} x */
function anchorFor(x) {
  return x > 0.3 ? "start" : x < -0.3 ? "end" : "middle";
}

/** Fixed precision, so scenes are byte-for-byte reproducible. @param {number} v */
function fmt(v) {
  return (Math.round(v * 1e4) / 1e4).toString();
}

/** Union–find over string keys, used for the pushout classes of the nested view. */
class Groups {
  /** @type {Map<string, string>} */
  parent = new Map();

  add(/** @type {string} */ k) {
    if (!this.parent.has(k)) this.parent.set(k, k);
  }

  find(/** @type {string} */ k) {
    this.add(k);
    let root = k;
    while (this.parent.get(root) !== root) root = /** @type {string} */ (this.parent.get(root));
    while (this.parent.get(k) !== root) {
      const next = /** @type {string} */ (this.parent.get(k));
      this.parent.set(k, root);
      k = next;
    }
    return root;
  }

  union(/** @type {string} */ a, /** @type {string} */ b) {
    const ra = this.find(a);
    const rb = this.find(b);
    // keep the lexicographically smaller root, so group ids do not depend on call order
    if (ra !== rb) {
      if (ra < rb) this.parent.set(rb, ra);
      else this.parent.set(ra, rb);
    }
  }
}
