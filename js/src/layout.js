/**
 * Deterministic layout of a single wiring diagram, in unit coordinates.
 *
 * The outer star is the unit circle centred on the origin, as in Spivak's
 * figures. Inner stars are disks inside it. Every wire is a point on its
 * star's circle (a *port*), and every cable is drawn as cubic Bézier curves
 * between its ports. The function is pure (no DOM, no randomness, no clock),
 * so a diagram always gets the same picture and Node can test the layout.
 *
 * Because the wires of a star form a set, the layout may place them anywhere on
 * the circle. Ports are spread evenly, in the circular order that points each
 * one towards the rest of its cable, rotated to fit best.
 *
 * Steps:
 * 1. radii from wire counts, scaled so that inner stars fill ≤ 42% of the disk;
 * 2. positions by a fixed-iteration spring embedding: cables attract, disks
 *    repel and may not overlap, and every disk stays inside the outer circle;
 * 3. outer port angles (unless fixed by the caller, e.g. when this diagram is
 *    drawn inside a star of a parent diagram) chosen to face the stars they
 *    connect to; steps 2–3 alternate twice;
 * 4. inner port angles likewise;
 * 5. cable geometry: floating cables become small loops along the bottom, a
 *    dangling cable is a stub, two ends make one curve, and three or more meet
 *    at a junction dot.
 */

const TAU = 2 * Math.PI;
const MARGIN = 0.07; // between inner stars and the outer circle
const GAP = 0.07; // between inner stars
const FILL = 0.42; // max fraction of the outer disk covered by inner stars
const ITERATIONS = 240;

/**
 * @typedef {{x: number, y: number}} Point
 * @typedef {{name: string, type: string, angle: number, x: number, y: number, nx: number, ny: number, cable: number}} Port
 *   `(nx, ny)` is the unit direction in which the wire leaves its star: away
 *   from an inner star's centre, and towards the centre for the outer star.
 * @typedef {{index: number, x: number, y: number, r: number, ports: Port[]}} StarLayout
 * @typedef {{x0: number, y0: number, segments: number[][]}} Curve
 *   a path from `(x0, y0)`; each segment is a cubic `[c1x, c1y, c2x, c2y, x, y]`
 * @typedef {{star: number, port: number}} End `star` is -1 for the outer star
 * @typedef {{index: number, type: string, kind: "floating" | "dangling" | "pair" | "junction", ends: End[], curves: Curve[], junction: Point | null}} CableLayout
 * @typedef {{outer: {r: 1, ports: Port[]}, stars: StarLayout[], cables: CableLayout[]}} Layout
 */

/**
 * @param {import("./diagram.js").WiringDiagram} phi
 * @param {{outerAngles?: readonly number[], weights?: readonly number[]}} [options]
 *   `outerAngles[k]`: fixed angle (radians) of outer wire `k` in canonical order;
 *   `weights[i]` (≥ 1): relative size of inner star `i`, e.g. the number of
 *   leaves of a sub-term that will be drawn inside it
 * @returns {Layout}
 */
export function layout(phi, options = {}) {
  const n = phi.arity;
  const radii = starRadii(phi, options.weights);
  const fixed = options.outerAngles;
  if (fixed && fixed.length !== phi.outer.size) {
    throw new RangeError(`outerAngles has ${fixed.length} entries for ${phi.outer.size} outer wires`);
  }

  // Cable membership: which stars (with multiplicity) and outer wires each cable touches.
  const k = phi.cables.length;
  /** @type {number[][]} */
  const starsOn = Array.from({ length: k }, () => []);
  /** @type {number[][]} */
  const outerOn = Array.from({ length: k }, () => []);
  for (let i = 0; i < n; i++) for (const c of phi.innerCables(i)) starsOn[c].push(i);
  phi.outerCables.forEach((c, w) => outerOn[c].push(w));

  let outerAngles = fixed ? [...fixed] : evenly(phi.outer.size, Math.PI);
  let centres = initialCentres(n);
  for (let round = 0; round < (fixed ? 1 : 2); round++) {
    centres = placeStars(centres, radii, starsOn, outerOn, outerAngles);
    if (!fixed) outerAngles = orientOuter(phi, centres, starsOn);
  }

  /** @type {Port[]} */
  const outerPorts = phi.outer.names.map((name, w) => {
    const a = outerAngles[w];
    const [x, y] = [Math.cos(a), Math.sin(a)];
    return { name, type: phi.outer.types[w], angle: a, x, y, nx: -x, ny: -y, cable: phi.outerCables[w] };
  });

  /** @type {StarLayout[]} */
  const stars = centres.map((p, i) => ({
    index: i,
    x: p.x,
    y: p.y,
    r: radii[i],
    ports: innerPorts(phi, i, p, radii[i], centres, starsOn, outerOn, outerPorts),
  }));

  return { outer: { r: 1, ports: outerPorts }, stars, cables: cableGeometry(phi, stars, outerPorts) };
}

// -- 1. radii -------------------------------------------------------------------------

/**
 * Radii grow with the square root of the wire count (times the weight). They
 * are scaled so the disks cover at most FILL of the outer disk, or more when
 * some stars will hold sub-diagrams, and capped so that any two still fit
 * (a lone star holding a sub-diagram gets more).
 *
 * @param {import("./diagram.js").WiringDiagram} phi @param {readonly number[] | undefined} weights
 */
function starRadii(phi, weights) {
  const n = phi.arity;
  if (n === 0) return [];
  const w = weights ?? phi.inner.map(() => 1);
  const raw = phi.inner.map((x, i) => (0.1 + 0.035 * Math.sqrt(x.size)) * Math.sqrt(Math.max(1, w[i])));
  const area = raw.reduce((s, r) => s + r * r, 0);
  const fill = w.some((v) => v > 1) ? 0.55 : FILL;
  const scale = Math.sqrt(fill / area);
  // a lone star that holds a sub-diagram (a function whose body is one `match`, say) gets
  // most of the room, leaving a ring for the wires that reach it
  const cap = n === 1 ? (w[0] > 1 ? 0.68 : 0.5) : n === 2 ? 0.43 : 0.38;
  return raw.map((r) => Math.min(cap, r * scale));
}

// -- 2. positions ---------------------------------------------------------------------

/** @param {number} n @returns {Point[]} */
function initialCentres(n) {
  if (n === 1) return [{ x: 0, y: 0 }];
  const rho = n <= 6 ? 0.45 : 0.55;
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (TAU * i) / n;
    return { x: rho * Math.cos(a), y: rho * Math.sin(a) };
  });
}

/**
 * Fixed-iteration spring embedding with linear cooling.
 * @param {Point[]} start @param {number[]} radii
 * @param {number[][]} starsOn @param {number[][]} outerOn @param {number[]} outerAngles
 */
function placeStars(start, radii, starsOn, outerOn, outerAngles) {
  const n = start.length;
  const xs = Float64Array.from(start, (p) => p.x);
  const ys = Float64Array.from(start, (p) => p.y);
  if (n === 0) return [];

  // Pairwise affinity: number of cables two stars share. Outer pulls: per star, the
  // outer wires it shares a cable with.
  const affinity = new Float64Array(n * n);
  /** @type {number[][]} */
  const pulls = Array.from({ length: n }, () => []);
  starsOn.forEach((members, c) => {
    const distinct = [...new Set(members)];
    for (let a = 0; a < distinct.length; a++) {
      for (let b = a + 1; b < distinct.length; b++) {
        affinity[distinct[a] * n + distinct[b]] += 1;
        affinity[distinct[b] * n + distinct[a]] += 1;
      }
      for (const w of outerOn[c]) pulls[distinct[a]].push(w);
    }
  });

  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  for (let it = 0; it < ITERATIONS; it++) {
    const alpha = 1 - it / ITERATIONS;
    fx.fill(0);
    fy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = xs[j] - xs[i];
        let dy = ys[j] - ys[i];
        let d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1e-9) {
          // coincident: separate along a direction fixed by the indices
          const a = (i * 2.399963 + j) % TAU;
          [dx, dy, d] = [Math.cos(a) * 1e-3, Math.sin(a) * 1e-3, 1e-3];
        }
        const ux = dx / d;
        const uy = dy / d;
        const rest = radii[i] + radii[j] + GAP;
        // springs between stars that share cables, a weak repulsion between all
        const pull = affinity[i * n + j] * 0.04 * (d - rest);
        const push = (0.012 * radii[i] * radii[j]) / (d * d);
        const f = pull - push;
        fx[i] += f * ux;
        fy[i] += f * uy;
        fx[j] -= f * ux;
        fy[j] -= f * uy;
      }
      for (const w of pulls[i]) {
        const tx = Math.cos(outerAngles[w]) * (1 - radii[i] - MARGIN);
        const ty = Math.sin(outerAngles[w]) * (1 - radii[i] - MARGIN);
        fx[i] += 0.05 * (tx - xs[i]);
        fy[i] += 0.05 * (ty - ys[i]);
      }
      fx[i] -= 0.01 * xs[i];
      fy[i] -= 0.01 * ys[i];
    }
    for (let i = 0; i < n; i++) {
      const step = Math.sqrt(fx[i] * fx[i] + fy[i] * fy[i]);
      const scale = step > 0.05 ? 0.05 / step : 1;
      xs[i] += alpha * scale * fx[i];
      ys[i] += alpha * scale * fy[i];
    }
    separate(xs, ys, radii);
  }
  for (let pass = 0; pass < 60; pass++) separate(xs, ys, radii);
  return Array.from(xs, (x, i) => ({ x, y: ys[i] }));
}

/** Resolve overlaps pairwise, then pull every disk back inside the outer circle. */
function separate(/** @type {Float64Array} */ xs, /** @type {Float64Array} */ ys, /** @type {number[]} */ radii) {
  const n = xs.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = xs[j] - xs[i];
      const dy = ys[j] - ys[i];
      const d = Math.sqrt(dx * dx + dy * dy) || 1e-9; // (Math.hypot is slow in hot loops)
      const overlap = radii[i] + radii[j] + GAP - d;
      if (overlap > 0) {
        const ux = dx / d;
        const uy = dy / d;
        xs[i] -= (ux * overlap) / 2;
        ys[i] -= (uy * overlap) / 2;
        xs[j] += (ux * overlap) / 2;
        ys[j] += (uy * overlap) / 2;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const limit = Math.max(0, 1 - radii[i] - MARGIN);
    const d = Math.sqrt(xs[i] * xs[i] + ys[i] * ys[i]);
    if (d > limit) {
      xs[i] *= limit / d;
      ys[i] *= limit / d;
    }
  }
}

// -- 3, 4. port angles --------------------------------------------------------------------

/** `count` evenly spaced angles, the first at `start`, going clockwise on screen. */
function evenly(/** @type {number} */ count, /** @type {number} */ start) {
  return Array.from({ length: count }, (_, j) => start + (TAU * j) / count);
}

/**
 * Evenly spaced slots for ports that would each like to sit at `desired[j]`.
 * Keep the circular order of the desired angles and rotate the evenly spaced
 * slots to their circular mean offset. That rotation minimises Σ(1 − cos error).
 * Ties keep index order.
 *
 * @param {readonly number[]} desired
 * @returns {number[]}
 */
export function assignSlots(desired) {
  const m = desired.length;
  if (m === 0) return [];
  const norm = desired.map((a) => ((a % TAU) + TAU) % TAU);
  const order = norm.map((_, j) => j).sort((a, b) => norm[a] - norm[b] || a - b);
  let sx = 0;
  let sy = 0;
  order.forEach((p, j) => {
    const delta = norm[p] - (TAU * j) / m;
    sx += Math.cos(delta);
    sy += Math.sin(delta);
  });
  const phase = sx === 0 && sy === 0 ? 0 : Math.atan2(sy, sx);
  const out = new Array(m);
  order.forEach((p, j) => (out[p] = phase + (TAU * j) / m));
  return out;
}

/** @param {import("./diagram.js").WiringDiagram} phi @param {Point[]} centres @param {number[][]} starsOn */
function orientOuter(phi, centres, starsOn) {
  const fallback = evenly(phi.outer.size, Math.PI);
  const desired = Array.from(phi.outerCables, (c, w) => {
    const members = starsOn[c];
    if (members.length === 0) return fallback[w];
    const cx = members.reduce((s, i) => s + centres[i].x, 0) / members.length;
    const cy = members.reduce((s, i) => s + centres[i].y, 0) / members.length;
    return Math.hypot(cx, cy) < 1e-6 ? fallback[w] : Math.atan2(cy, cx);
  });
  return assignSlots(desired);
}

/**
 * @param {import("./diagram.js").WiringDiagram} phi @param {number} i @param {Point} p @param {number} r
 * @param {Point[]} centres @param {number[][]} starsOn @param {number[][]} outerOn @param {Port[]} outerPorts
 * @returns {Port[]}
 */
function innerPorts(phi, i, p, r, centres, starsOn, outerOn, outerPorts) {
  const x = phi.inner[i];
  const cables = phi.innerCables(i);
  const away = Math.hypot(p.x, p.y) < 1e-6 ? -Math.PI / 2 : Math.atan2(p.y, p.x);
  const desired = Array.from(cables, (c, w) => {
    // aim at the centroid of everything else on this cable
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (const j of starsOn[c]) {
      if (j !== i) {
        sx += centres[j].x;
        sy += centres[j].y;
        count++;
      }
    }
    for (const o of outerOn[c]) {
      sx += outerPorts[o].x;
      sy += outerPorts[o].y;
      count++;
    }
    if (count === 0) return away + (w - (cables.length - 1) / 2) * 0.01; // dangling or self-loop: face outwards
    return Math.atan2(sy / count - p.y, sx / count - p.x);
  });
  return assignSlots(desired).map((a, w) => {
    const [ux, uy] = [Math.cos(a), Math.sin(a)];
    return { name: x.names[w], type: x.types[w], angle: a, x: p.x + r * ux, y: p.y + r * uy, nx: ux, ny: uy, cable: cables[w] };
  });
}

// -- 5. cables ------------------------------------------------------------------------------

const STUB = 0.035; // length of a wire stub outside its star

/**
 * @param {import("./diagram.js").WiringDiagram} phi @param {StarLayout[]} stars @param {Port[]} outerPorts
 * @returns {CableLayout[]}
 */
function cableGeometry(phi, stars, outerPorts) {
  /** @type {End[][]} */
  const ends = phi.cables.map(() => []);
  stars.forEach((s, i) => s.ports.forEach((q, w) => ends[q.cable].push({ star: i, port: w })));
  outerPorts.forEach((q, w) => ends[q.cable].push({ star: -1, port: w }));
  const portOf = (/** @type {End} */ e) => (e.star < 0 ? outerPorts[e.port] : stars[e.star].ports[e.port]);
  // a port's attachment point: the tip of its stub
  const tip = (/** @type {Port} */ q) => ({ x: q.x + STUB * q.nx, y: q.y + STUB * q.ny });

  const [firstFloating] = phi.floatingCables();
  const floatingCount = phi.cables.length - firstFloating;

  return phi.cables.map((type, c) => {
    const es = ends[c];
    const ports = es.map(portOf);
    if (es.length === 0) {
      // floating: a small closed loop, in a row along the bottom of the outer circle
      const j = c - firstFloating;
      const spread = 0.09;
      const x = (j - (floatingCount - 1) / 2) * spread;
      const y = Math.sqrt(Math.max(0, 0.92 * 0.92 - x * x));
      return { index: c, type, kind: "floating", ends: es, curves: [loop(x, y, 0.028)], junction: { x, y } };
    }
    if (es.length === 1) {
      const q = ports[0];
      const t = tip(q);
      const end = { x: q.x + 2.6 * STUB * q.nx, y: q.y + 2.6 * STUB * q.ny };
      return { index: c, type, kind: "dangling", ends: es, curves: [line(t, end)], junction: end };
    }
    if (es.length === 2) {
      return { index: c, type, kind: "pair", ends: es, curves: [between(ports[0], ports[1], tip)], junction: null };
    }
    // three or more: branches from each stub tip to a junction at their centroid
    const tips = ports.map(tip);
    const junction = clearOfStars(
      {
        x: tips.reduce((s, t) => s + t.x, 0) / tips.length,
        y: tips.reduce((s, t) => s + t.y, 0) / tips.length,
      },
      stars,
    );
    const { x: jx, y: jy } = junction;
    const curves = ports.map((q, k) => {
      const t = tips[k];
      const reach = Math.max(0.03, 0.45 * Math.hypot(jx - t.x, jy - t.y));
      return {
        x0: t.x,
        y0: t.y,
        segments: [[t.x + reach * q.nx, t.y + reach * q.ny, jx + (t.x - jx) * 0.25, jy + (t.y - jy) * 0.25, jx, jy]],
      };
    });
    return { index: c, type, kind: "junction", ends: es, curves, junction };
  });
}

/**
 * Move a junction that falls inside (or on the rim of) an inner star out to
 * just beyond the rim, along the ray from that star's centre. A few passes
 * settle junctions near several stars.
 *
 * @param {Point} p @param {StarLayout[]} stars @returns {Point}
 */
function clearOfStars(p, stars) {
  let { x, y } = p;
  for (let pass = 0; pass < 3; pass++) {
    for (const s of stars) {
      const clearance = s.r + 2.2 * STUB;
      const d = Math.hypot(x - s.x, y - s.y);
      if (d < clearance) {
        // at the exact centre, leave towards the outer circle (or upwards)
        const [ux, uy] = d > 1e-9 ? [(x - s.x) / d, (y - s.y) / d] : Math.hypot(s.x, s.y) > 1e-9 ? [s.x / Math.hypot(s.x, s.y), s.y / Math.hypot(s.x, s.y)] : [0, -1];
        x = s.x + clearance * ux;
        y = s.y + clearance * uy;
      }
    }
  }
  return { x, y };
}

/** A curve between two ports that leaves each one along its normal. */
function between(/** @type {Port} */ a, /** @type {Port} */ b, /** @type {(q: Port) => Point} */ tip) {
  const ta = tip(a);
  const tb = tip(b);
  const d = Math.hypot(tb.x - ta.x, tb.y - ta.y);
  const reach = Math.min(0.45, Math.max(0.06, 0.4 * d));
  return {
    x0: ta.x,
    y0: ta.y,
    segments: [[ta.x + reach * a.nx, ta.y + reach * a.ny, tb.x + reach * b.nx, tb.y + reach * b.ny, tb.x, tb.y]],
  };
}

/** @param {Point} a @param {Point} b @returns {Curve} */
function line(a, b) {
  return { x0: a.x, y0: a.y, segments: [[a.x, a.y, b.x, b.y, b.x, b.y]] };
}

/** A circle of radius `r` at `(x, y)` as four cubic segments. @returns {Curve} */
function loop(/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ r) {
  const k = 0.5523 * r; // cubic approximation of a quarter circle
  return {
    x0: x + r,
    y0: y,
    segments: [
      [x + r, y + k, x + k, y + r, x, y + r],
      [x - k, y + r, x - r, y + k, x - r, y],
      [x - r, y - k, x - k, y - r, x, y - r],
      [x + k, y - r, x + r, y - k, x + r, y],
    ],
  };
}
