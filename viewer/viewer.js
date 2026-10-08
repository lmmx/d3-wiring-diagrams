// The example viewer: spec/examples/*.json drawn with js/src/render.js, plus the
// relational algebra computed live with js/src/rel.js. Serve the repository
// root (e.g. `python -m http.server`) and open /viewer/.

import { Star, Term, WiringDiagram, rel } from "../js/src/index.js";
import { createRenderer } from "../js/src/render.js";

const EXAMPLES = new URL("../spec/examples/", import.meta.url);
const MAX_ROWS = 40;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const svg = /** @type {SVGSVGElement} */ (/** @type {unknown} */ ($("diagram")));
const tooltip = $("tooltip");

/**
 * @typedef {{title: string, source?: string, description?: string, term: unknown,
 *   algebra?: {kind: "rel" | "rel_recursive", domains: rel.Domains, relations: unknown[], expected: unknown}}} Example
 */

const state = {
  /** @type {Example | null} */ example: null,
  /** @type {Term | null} */ term: null,
  /** @type {rel.Relation[] | null} leaf relations, in leaf order */ leaves: null,
  nested: true,
  labels: true,
  /** @type {string | null} */ selected: null,
};

const renderer = createRenderer(globalThis.d3, svg, {
  onHover(target, event) {
    if (!target) {
      tooltip.hidden = true;
      return;
    }
    const box = /** @type {HTMLElement} */ (svg.parentElement).getBoundingClientRect();
    tooltip.hidden = false;
    tooltip.style.left = `${event.clientX - box.left + 14}px`;
    tooltip.style.top = `${event.clientY - box.top + 14}px`;
    if (target.kind === "cable") {
      const c = target.item;
      const what = { floating: "floating cable", dangling: "dangling cable", pair: "cable", junction: "cable" }[c.kind];
      tooltip.textContent = `${what} : ${c.type}${c.wires.length ? ` — ${c.wires.join(", ")}` : ""}`;
    } else if (target.kind === "star") {
      const s = target.item;
      tooltip.textContent = `${s.label ?? s.role} ${s.role === "leaf" ? s.signature : `φ : ${s.signature}`}`;
    }
  },
  onSelect(target) {
    state.selected = target?.kind === "star" ? target.item.key : null;
    renderer.select(state.selected);
    showAlgebra(target?.kind === "star" ? target.item : null);
  },
});

// -- loading -----------------------------------------------------------------------------

async function loadIndex() {
  const index = await (await fetch(new URL("index.json", EXAMPLES))).json();
  const select = /** @type {HTMLSelectElement} */ ($("example"));
  for (const { slug, title, source } of index) {
    const opt = new Option(`${title} — ${source.replace("Spivak, ", "")}`, slug);
    select.add(opt);
  }
  select.addEventListener("change", () => (location.hash = select.value));
  return index;
}

async function loadSlug(/** @type {string} */ slug) {
  const res = await fetch(new URL(`${slug}.json`, EXAMPLES));
  if (!res.ok) throw new Error(`no example ${slug}`);
  /** @type {HTMLSelectElement} */ ($("example")).value = slug;
  load(await res.json(), false);
}

/** Accept an example, a term, or a bare diagram. */
function load(/** @type {any} */ data, animate = true) {
  $("error").hidden = true;
  try {
    /** @type {Example} */
    const example =
      "term" in data ? data : "diagram" in data ? { title: "Term", term: data } : { title: "Wiring diagram", term: { diagram: data } };
    const term = Term.fromJSON(example.term);
    const flat = term.evaluate();
    state.example = example;
    state.term = term;
    state.leaves = example.algebra
      ? flat.inner.map((x, i) => rel.Relation.fromJSON(x, /** @type {any} */ (example.algebra).relations[i]))
      : null;
    state.selected = null;
    describe(example, term, flat);
    draw(animate);
    showAlgebra(null);
  } catch (e) {
    $("error").hidden = false;
    $("error").textContent = e instanceof Error ? e.message : String(e);
  }
}

function draw(animate = true) {
  if (!state.term) return;
  renderer.draw(state.term, { nested: state.nested, labels: state.labels, animate: animate && !reducedMotion.matches });
  renderer.select(state.selected);
  $("view-nested").setAttribute("aria-pressed", String(state.nested));
  $("view-flat").setAttribute("aria-pressed", String(!state.nested));
}

// -- the panel ---------------------------------------------------------------------------

/** @param {Example} ex @param {Term} term @param {WiringDiagram} flat */
function describe(ex, term, flat) {
  $("title").textContent = ex.title;
  $("source").textContent = ex.source ?? "";
  $("description").textContent = ex.description ?? "";
  svg.setAttribute("aria-label", `${ex.title}: a wiring diagram with ${flat.arity} inner stars`);
  const [floating] = flat.floatingCables();
  const facts = {
    "inner stars": `${flat.arity} after composition`,
    "term depth": String(depth(term)),
    cables: `${flat.cables.length}${flat.cables.length > floating ? ` (${flat.cables.length - floating} floating)` : ""}`,
    "outer star": String(flat.outer),
  };
  $("facts").replaceChildren(
    ...Object.entries(facts).flatMap(([k, v]) => [el("dt", k), el("dd", v)]),
  );
  const types = [...new Set(flat.cables.concat(term.diagram.cables))].sort();
  $("legend").replaceChildren(
    ...(types.length > 1
      ? types.map((t, i) => {
          const li = el("li", t);
          li.style.setProperty("--swatch", `var(--wd-type-${i % 6})`);
          return li;
        })
      : []),
  );
}

/**
 * Show the relation on the selected star: the given one for a leaf, Rel of the
 * sub-term for an intermediate star, and Rel of the whole term for the outer
 * star (the default). For a recursive setup, also the fixed point.
 *
 * @param {import("../js/src/scene.js").StarItem | null} star
 */
function showAlgebra(star) {
  const alg = state.example?.algebra;
  const term = state.term;
  const leaves = state.leaves;
  $("algebra").hidden = !alg;
  if (!alg || !term || !leaves) return;
  const box = $("relation");
  try {
    if (star?.role === "leaf") {
      const k = Number(star.key.slice("leaf:".length));
      $("algebra-title").textContent = `Rel(${star.label ?? `X${k + 1}`})`;
      $("algebra-caption").textContent = "Given: this star's relation.";
      box.replaceChildren(table(leaves[k]));
      return;
    }
    if (star?.role === "intermediate" && star.path) {
      const [sub, offset] = subterm(term, star.path);
      const r = nestedRel(sub, leaves.slice(offset), alg.domains);
      $("algebra-title").textContent = `Rel(${sub.label ?? "φ"})`;
      $("algebra-caption").textContent =
        "Computed from the leaves inside this star. Composing first and applying Rel once gives the same relation.";
      box.replaceChildren(table(r));
      return;
    }
    const flat = term.evaluate();
    const outer = rel.apply(flat, leaves, alg.domains);
    if (alg.kind === "rel_recursive") {
      const z = new Star([...flat.outer].filter(([n]) => n.startsWith("out.")).map(([n, t]) => [n.slice(4), t]));
      const q = rel.close(outer, [z], z, alg.domains);
      const sizes = [];
      let current = rel.Relation.full(z, alg.domains);
      for (;;) {
        sizes.push(current.size);
        const next = q([current]);
        if (next.equals(current)) break;
        current = next;
      }
      $("algebra-title").textContent = "Greatest recursive relation";
      $("algebra-caption").textContent =
        `q = Rel(ev)(Rel(φ)(…), −) iterated from the full relation: ${sizes.join(" → ")} rows. It is a fixed point, and every other fixed point is contained in it.`;
      box.replaceChildren(table(current));
      return;
    }
    $("algebra-title").textContent = "Rel(φ), the φ-conjunction";
    $("algebra-caption").textContent = `Computed here from the ${leaves.length} leaf relations${
      matches(outer, alg.expected) ? ", and identical to the expected relation in the spec" : ""
    }. Click a star to see its relation.`;
    box.replaceChildren(table(outer));
  } catch (e) {
    box.replaceChildren(el("p", e instanceof Error ? e.message : String(e)));
  }
}

/** The sub-term at a scene path like "r.0.1", and the index of its first leaf. @returns {[Term, number]} */
function subterm(/** @type {Term} */ term, /** @type {string} */ path) {
  let t = term;
  let offset = 0;
  for (const part of path.split(".").slice(1).map(Number)) {
    for (let j = 0; j < part; j++) offset += t.children[j] ? t.children[j].evaluate().arity : 1;
    t = /** @type {Term} */ (t.children[part]);
  }
  return [t, offset];
}

/** Rel evaluated level by level, consuming leaves in order. */
function nestedRel(/** @type {Term} */ t, /** @type {rel.Relation[]} */ leaves, /** @type {rel.Domains} */ domains) {
  let next = 0;
  const go = (/** @type {Term} */ u) =>
    rel.apply(
      u.diagram,
      u.children.map((kid) => (kid ? go(kid) : leaves[next++])),
      domains,
    );
  return go(t);
}

function matches(/** @type {rel.Relation} */ r, /** @type {unknown} */ expected) {
  try {
    return r.equals(rel.Relation.fromJSON(r.star, expected));
  } catch {
    return false;
  }
}

function table(/** @type {rel.Relation} */ r) {
  const t = el("table");
  const head = el("tr");
  for (const n of r.star.names) head.append(el("th", n));
  t.append(head);
  for (const row of r.rows.slice(0, MAX_ROWS)) {
    const tr = el("tr");
    for (const v of row) tr.append(el("td", String(v)));
    t.append(tr);
  }
  const wrap = el("div");
  wrap.append(el("p", `${r.size} row${r.size === 1 ? "" : "s"} on ${r.star}`), t);
  if (r.size > MAX_ROWS) wrap.append(el("p", `… ${r.size - MAX_ROWS} more`));
  wrap.querySelectorAll("p").forEach((p) => p.classList.add("muted"));
  return wrap;
}

/** @param {Term} t @returns {number} */
function depth(t) {
  return 1 + Math.max(0, ...t.children.map((k) => (k ? depth(k) : 0)));
}

/** @param {string} tag @param {string} [text] */
function el(tag, text) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
}

// -- controls ----------------------------------------------------------------------------

$("view-nested").addEventListener("click", () => {
  state.nested = true;
  state.selected = null;
  draw();
  showAlgebra(null);
});
$("view-flat").addEventListener("click", () => {
  state.nested = false;
  state.selected = null;
  draw();
  showAlgebra(null);
});
$("labels").addEventListener("change", (e) => {
  state.labels = /** @type {HTMLInputElement} */ (e.target).checked;
  draw(false);
});
$("reset-zoom").addEventListener("click", () => renderer.resetZoom());
$("file").addEventListener("change", async (e) => {
  const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
  if (file) load(JSON.parse(await file.text()));
});
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file) load(JSON.parse(await file.text()));
});
document.addEventListener("keydown", (e) => {
  if (e.key === "c" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) {
    state.nested = !state.nested;
    draw();
  }
});
addEventListener("hashchange", () => loadSlug(location.hash.slice(1)).catch(showError));

function showError(/** @type {unknown} */ e) {
  $("error").hidden = false;
  $("error").textContent = e instanceof Error ? e.message : String(e);
}

loadIndex()
  .then((index) => loadSlug(location.hash.slice(1) || (index.find((/** @type {any} */ e) => e.slug === "half-adder") ?? index[0]).slug))
  .catch(showError);
