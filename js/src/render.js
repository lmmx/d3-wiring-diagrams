/**
 * Render scenes (./scene.js) into an SVG with d3.
 *
 * `d3` is passed in rather than imported, so the module works with a
 * vendored UMD build (`globalThis.d3`), an npm install, or a custom bundle.
 * Selections, transitions and zoom are the only parts of d3 it uses.
 *
 * Every primitive is joined by its key. Calling `show` with a new scene
 * therefore animates whatever the two scenes share, such as the leaf stars
 * when switching between the nested and flat views of one term. Everything
 * else fades.
 *
 * Styling is left to CSS: the elements carry classes (`wd-star`, `wd-cable`,
 * …), roles as `data-role`, and type colours as the CSS variables
 * `--wd-type-0` … `--wd-type-5`, assigned in sorted type order.
 */

import { buildScene } from "./scene.js";

const DURATION = 650;
const PALETTE_SIZE = 6;
const MIN_LABEL_PX = 6; // labels smaller than this on screen are hidden

/**
 * @typedef {import("./scene.js").Scene} Scene
 * @typedef {{kind: "star", item: import("./scene.js").StarItem} | {kind: "cable", item: import("./scene.js").CableItem} | {kind: "wire", item: import("./scene.js").WireItem}} Target
 * @typedef {{onHover?: (t: Target | null, event: PointerEvent) => void, onSelect?: (t: Target | null) => void}} Callbacks
 */

/**
 * @param {any} d3 the d3 namespace (v7)
 * @param {SVGSVGElement} svgNode
 * @param {Callbacks} [callbacks]
 */
export function createRenderer(d3, svgNode, callbacks = {}) {
  const svg = d3.select(svgNode);
  svg
    .attr("viewBox", "-1.32 -1.28 2.64 2.56")
    .attr("role", "img")
    .classed("wd", true);
  svg.selectAll("*").remove();
  const root = svg.append("g").attr("class", "wd-root");
  const layers = Object.fromEntries(
    ["stars", "cables", "wires", "dots", "labels"].map((name) => [name, root.append("g").attr("class", `wd-${name}`)]),
  );

  let k = 1; // zoom scale, for label level of detail
  const zoom = d3
    .zoom()
    .scaleExtent([0.5, 60])
    .on("zoom", (/** @type {any} */ e) => {
      root.attr("transform", e.transform);
      k = e.transform.k;
      updateLabelVisibility();
    });
  svg.call(zoom).on("dblclick.zoom", null);
  svg.on("click", (/** @type {MouseEvent} */ e) => {
    if (e.target === svgNode) callbacks.onSelect?.(null);
  });

  /** @type {Map<string, number>} */
  let typeIndex = new Map();

  /** Screen pixels per unit at zoom 1. */
  const pxPerUnit = () => (svgNode.clientWidth || 800) / 2.64;

  function updateLabelVisibility() {
    const px = pxPerUnit() * k;
    layers.labels
      .selectAll("text")
      .attr("display", (/** @type {any} */ d) => (d.size * px < MIN_LABEL_PX ? "none" : null));
  }

  /** @param {string} type */
  const colour = (type) =>
    typeIndex.size <= 1 ? "var(--wd-wire)" : `var(--wd-type-${(typeIndex.get(type) ?? 0) % PALETTE_SIZE})`;

  /** @param {string | null} group */
  function highlight(group) {
    root.classed("wd-highlighting", group !== null);
    for (const name of ["cables", "wires", "dots"]) {
      layers[name].selectAll("*").classed("wd-hot", (/** @type {any} */ d) => group !== null && d.group === group);
    }
  }

  /**
   * Draw a scene, animating from whatever is on screen.
   * @param {Scene} scene
   * @param {{animate?: boolean, labels?: boolean}} [opts]
   */
  function show(scene, { animate = true, labels = true } = {}) {
    typeIndex = new Map(scene.types.map((t, i) => [t, i]));
    const t = svg.transition().duration(animate ? DURATION : 0).ease(d3.easeCubicInOut);
    const fadeIn = (/** @type {any} */ sel) => sel.attr("opacity", 0).transition(t).attr("opacity", 1);
    const fadeOut = (/** @type {any} */ sel) => sel.transition(t).attr("opacity", 0).remove();
    const key = (/** @type {any} */ d) => d.key;

    layers.stars
      .selectAll("circle")
      .data(scene.stars, key)
      .join(
        (/** @type {any} */ enter) =>
          enter
            .append("circle")
            .attr("cx", (/** @type {any} */ d) => d.x)
            .attr("cy", (/** @type {any} */ d) => d.y)
            .attr("r", (/** @type {any} */ d) => d.r)
            .call(fadeIn),
        (/** @type {any} */ update) =>
          update.call((/** @type {any} */ u) =>
            u.transition(t).attr("cx", (/** @type {any} */ d) => d.x).attr("cy", (/** @type {any} */ d) => d.y).attr("r", (/** @type {any} */ d) => d.r).attr("opacity", 1),
          ),
        fadeOut,
      )
      .attr("class", "wd-star")
      .attr("data-role", (/** @type {any} */ d) => d.role)
      .attr("stroke-width", (/** @type {any} */ d) => (d.role === "outer" ? 0.008 : 0.006 * Math.min(1, 3 * d.r)))
      .on("pointerenter", (/** @type {PointerEvent} */ e, /** @type {any} */ d) => callbacks.onHover?.({ kind: "star", item: d }, e))
      .on("pointerleave", (/** @type {PointerEvent} */ e) => callbacks.onHover?.(null, e))
      .on("click", (/** @type {MouseEvent} */ e, /** @type {any} */ d) => {
        e.stopPropagation();
        callbacks.onSelect?.({ kind: "star", item: d });
      });

    layers.cables
      .selectAll("path")
      .data(scene.cables, key)
      .join(
        (/** @type {any} */ enter) =>
          enter
            .append("path")
            .attr("d", (/** @type {any} */ d) => d.d)
            .attr("opacity", 0)
            .call((/** @type {any} */ s) => s.transition(t).delay(animate ? DURATION * 0.5 : 0).attr("opacity", 1)),
        (/** @type {any} */ update) => update.call((/** @type {any} */ u) => u.transition(t).attr("d", (/** @type {any} */ d) => d.d).attr("opacity", 1)),
        fadeOut,
      )
      .attr("class", (/** @type {any} */ d) => `wd-cable wd-${d.kind}`)
      .attr("stroke", (/** @type {any} */ d) => colour(d.type))
      .attr("stroke-width", (/** @type {any} */ d) => 0.0075 * Math.pow(0.8, d.depth))
      .on("pointerenter", (/** @type {PointerEvent} */ e, /** @type {any} */ d) => {
        highlight(d.group);
        callbacks.onHover?.({ kind: "cable", item: d }, e);
      })
      .on("pointerleave", (/** @type {PointerEvent} */ e) => {
        highlight(null);
        callbacks.onHover?.(null, e);
      });

    layers.wires
      .selectAll("line")
      .data(scene.wires, key)
      .join(
        (/** @type {any} */ enter) =>
          enter
            .append("line")
            .attr("x1", (/** @type {any} */ d) => d.x1)
            .attr("y1", (/** @type {any} */ d) => d.y1)
            .attr("x2", (/** @type {any} */ d) => d.x2)
            .attr("y2", (/** @type {any} */ d) => d.y2)
            .call(fadeIn),
        (/** @type {any} */ update) =>
          update.call((/** @type {any} */ u) =>
            u
              .transition(t)
              .attr("x1", (/** @type {any} */ d) => d.x1)
              .attr("y1", (/** @type {any} */ d) => d.y1)
              .attr("x2", (/** @type {any} */ d) => d.x2)
              .attr("y2", (/** @type {any} */ d) => d.y2)
              .attr("opacity", 1),
          ),
        fadeOut,
      )
      .attr("class", "wd-wire")
      .attr("stroke", (/** @type {any} */ d) => colour(d.type))
      .attr("stroke-width", (/** @type {any} */ d) => Math.hypot(d.x2 - d.x1, d.y2 - d.y1) * 0.32);

    layers.dots
      .selectAll("circle")
      .data(scene.dots, key)
      .join(
        (/** @type {any} */ enter) =>
          enter
            .append("circle")
            .attr("cx", (/** @type {any} */ d) => d.x)
            .attr("cy", (/** @type {any} */ d) => d.y)
            .attr("r", (/** @type {any} */ d) => d.r)
            .attr("opacity", 0)
            .call((/** @type {any} */ s) => s.transition(t).delay(animate ? DURATION * 0.5 : 0).attr("opacity", 1)),
        (/** @type {any} */ update) =>
          update.call((/** @type {any} */ u) =>
            u.transition(t).attr("cx", (/** @type {any} */ d) => d.x).attr("cy", (/** @type {any} */ d) => d.y).attr("r", (/** @type {any} */ d) => d.r).attr("opacity", 1),
          ),
        fadeOut,
      )
      .attr("class", (/** @type {any} */ d) => (d.hollow ? "wd-dot wd-end" : "wd-dot"))
      .attr("fill", (/** @type {any} */ d) => (d.hollow ? "var(--wd-bg)" : colour(d.type)))
      .attr("stroke", (/** @type {any} */ d) => colour(d.type))
      .attr("stroke-width", (/** @type {any} */ d) => d.r * 0.45);

    layers.labels
      .selectAll("text")
      .data(labels ? scene.labels : scene.labels.filter((l) => l.role === "star"), key)
      .join(
        (/** @type {any} */ enter) =>
          enter
            .append("text")
            .attr("x", (/** @type {any} */ d) => d.x)
            .attr("y", (/** @type {any} */ d) => d.y)
            .call(fadeIn),
        (/** @type {any} */ update) =>
          update.call((/** @type {any} */ u) =>
            u.transition(t).attr("x", (/** @type {any} */ d) => d.x).attr("y", (/** @type {any} */ d) => d.y).attr("opacity", 1),
          ),
        fadeOut,
      )
      .attr("class", (/** @type {any} */ d) => `wd-label wd-label-${d.role}`)
      .attr("text-anchor", (/** @type {any} */ d) => d.anchor)
      .attr("dominant-baseline", "central")
      .attr("font-size", (/** @type {any} */ d) => d.size)
      .text((/** @type {any} */ d) => d.text);

    updateLabelVisibility();
  }

  return {
    show,
    /** Build and show a term or diagram. */
    draw(/** @type {any} */ termOrDiagram, /** @type {{nested?: boolean, animate?: boolean, labels?: boolean}} */ opts = {}) {
      show(buildScene(termOrDiagram, { nested: opts.nested ?? true }), opts);
    },
    /** Mark one star as selected (by key), or none. */
    select(/** @type {string | null} */ key) {
      layers.stars.selectAll("circle").classed("wd-selected", (/** @type {any} */ d) => d.key === key);
    },
    resetZoom() {
      svg.transition().duration(DURATION).call(zoom.transform, d3.zoomIdentity);
    },
  };
}
