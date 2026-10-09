// The viewer and playground. The diagrams are spec/examples/*.json (or any
// document) drawn with js/src/render.js, and the relational algebra is computed
// live with js/src/rel.js. Editing operations live in ./edit.js.
//
// URL: `#<slug>` picks an example, `#doc=<code>` carries a whole document (see
// encodeShare), and `?edit` opens the playground.

import { rel } from "../js/src/index.js";
import { createRenderer } from "../js/src/render.js";
import {
  buildLibrary,
  collapse,
  compatible,
  composeAll,
  decodeShare,
  encodeShare,
  nestedRel,
  normalize,
  parse,
  plugIn,
  prettyJSON,
  recursiveStar,
  subtermAt,
} from "./edit.js";
import { scanPython } from "./python.js";

const EXAMPLES = new URL("../spec/examples/", import.meta.url);
const MAX_ROWS = 40;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const svg = /** @type {SVGSVGElement} */ (/** @type {unknown} */ ($("diagram")));
const tooltip = $("tooltip");
const editor = /** @type {HTMLTextAreaElement} */ ($("doc"));

/**
 * @typedef {import("./edit.js").Doc} Doc
 * @typedef {import("../js/src/scene.js").StarItem} StarItem
 */

const state = {
  /** @type {Doc | null} the document on screen (last one that parsed) */ doc: null,
  /** @type {ReturnType<typeof parse> | null} */ parsed: null,
  /** @type {import("./edit.js").Entry[]} sub-terms of the examples, for plugging in */ library: [],
  nested: true,
  labels: true,
  editing: new URLSearchParams(location.search).has("edit"),
  /** @type {StarItem | null} */ selected: null,
};

// d3 is the vendored UMD build loaded by index.html
const renderer = createRenderer(/** @type {any} */ (globalThis).d3, svg, {
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
    state.selected = target?.kind === "star" ? target.item : null;
    renderer.select(state.selected?.key ?? null);
    showAlgebra();
    showTools();
  },
});

// -- loading -----------------------------------------------------------------------------

async function fetchJSON(/** @type {string} */ name) {
  const res = await fetch(new URL(name, EXAMPLES));
  if (!res.ok) throw new Error(`could not load ${name} (${res.status})`);
  return res.json();
}

async function loadIndex() {
  const index = await fetchJSON("index.json");
  const select = /** @type {HTMLSelectElement} */ ($("example"));
  for (const { slug, title, source } of index) select.add(new Option(`${title} — ${source.replace("Spivak, ", "")}`, slug));
  select.add(new Option("(your document)", ""));
  select.addEventListener("change", () => select.value && (location.hash = select.value));
  return index;
}

/** Load whatever the URL fragment names. */
async function route(/** @type {{slug: string}[]} */ index) {
  const hash = location.hash.slice(1);
  if (hash.startsWith("doc=")) return show(await decodeShare(hash.slice(4)), { animate: false });
  const slug = hash || (index.find((e) => e.slug === "half-adder") ?? index[0]).slug;
  /** @type {HTMLSelectElement} */ ($("example")).value = slug;
  return show(await fetchJSON(`${slug}.json`), { animate: false });
}

/**
 * Show a document. Throws (and leaves the screen as it was) if it does not parse.
 * @param {unknown} data
 * @param {{animate?: boolean, updateEditor?: boolean}} [opts]
 */
function show(data, { animate = true, updateEditor = true } = {}) {
  const doc = normalize(data);
  const parsed = parse(doc);
  state.doc = doc;
  state.parsed = parsed;
  state.selected = null;
  hideError();
  if (updateEditor) editor.value = prettyJSON(doc);
  if (doc.code) /** @type {HTMLTextAreaElement} */ ($("py")).value = doc.code.source;
  describe();
  draw(animate);
  showAlgebra();
  showTools();
}

/** Apply an edit: show the new document and make it the current URL's document. */
async function apply(/** @type {Doc} */ doc) {
  show(doc);
  /** @type {HTMLSelectElement} */ ($("example")).value = "";
  history.replaceState(null, "", `${location.search}#doc=${await encodeShare(doc)}`);
}

function draw(animate = true) {
  if (!state.parsed) return;
  renderer.draw(state.parsed.term, { nested: state.nested, labels: state.labels, animate: animate && !reducedMotion.matches });
  renderer.select(state.selected?.key ?? null);
  $("view-nested").setAttribute("aria-pressed", String(state.nested));
  $("view-flat").setAttribute("aria-pressed", String(!state.nested));
}

// -- the panel ---------------------------------------------------------------------------

function describe() {
  const { doc, parsed } = state;
  if (!doc || !parsed) return;
  const { term, flat } = parsed;
  $("title").textContent = doc.title;
  $("source").textContent = doc.source;
  $("description").textContent = doc.description;
  svg.setAttribute("aria-label", `${doc.title}: a wiring diagram with ${flat.arity} inner stars`);
  const [floating] = flat.floatingCables();
  const facts = {
    "inner stars": `${flat.arity} after composition`,
    "term depth": String(depth(term)),
    cables: `${flat.cables.length}${flat.cables.length > floating ? ` (${flat.cables.length - floating} floating)` : ""}`,
    "outer star": String(flat.outer),
  };
  $("facts").replaceChildren(...Object.entries(facts).flatMap(([k, v]) => [el("dt", k), el("dd", v)]));
  $("code").hidden = !doc.code;
  $("code-source").textContent = doc.code?.source ?? "";
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
 * The relation on the selected star: the given one for a leaf, Rel of the
 * sub-term for an intermediate star, and Rel of the whole term otherwise. For
 * a recursive setup, also the fixed point.
 */
function showAlgebra() {
  const alg = state.doc?.algebra;
  const star = state.selected;
  $("algebra").hidden = !alg;
  if (!alg || !state.parsed?.leaves) return;
  const { term, flat, leaves } = state.parsed;
  const box = $("relation");
  try {
    if (star?.role === "leaf") {
      const k = Number(star.key.slice("leaf:".length));
      $("algebra-title").textContent = `Rel(${star.label ?? `X${k + 1}`})`;
      $("algebra-caption").textContent = "Given: this star's relation.";
      box.replaceChildren(table(leaves[k]));
      return;
    }
    if (star?.role === "intermediate") {
      const [sub, offset] = subtermAt(term, pathOf(star));
      $("algebra-title").textContent = `Rel(${sub.label ?? "φ"})`;
      $("algebra-caption").textContent =
        "Computed from the leaves inside this star. Composing first and applying Rel once gives the same relation.";
      box.replaceChildren(table(nestedRel(sub, leaves.slice(offset), alg.domains)));
      return;
    }
    const outer = rel.apply(flat, leaves, alg.domains);
    if (alg.kind === "rel_recursive") {
      const z = recursiveStar(flat);
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
      $("algebra-caption").textContent = `q = Rel(ev)(Rel(φ)(…), −) iterated from the full relation: ${sizes.join(
        " → ",
      )} rows. It is a fixed point, and every other fixed point is contained in it.`;
      box.replaceChildren(table(current));
      return;
    }
    $("algebra-title").textContent = "Rel(φ), the φ-conjunction";
    $("algebra-caption").textContent = `Computed here from the ${leaves.length} leaf relations${
      matches(outer, alg.expected) ? ", and identical to the expected relation in the document" : ""
    }. Click a star to see its relation.`;
    box.replaceChildren(table(outer));
  } catch (e) {
    box.replaceChildren(el("p", message(e)));
  }
}

/** Slot indices of an intermediate star, from its scene path "r.0.1". */
function pathOf(/** @type {StarItem} */ star) {
  return star.path.split(".").slice(1).map(Number);
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

// -- the playground ------------------------------------------------------------------------

function setEditing(/** @type {boolean} */ on) {
  state.editing = on;
  $("editor").hidden = !on;
  $("main").classList.toggle("editing", on);
  $("edit-toggle").setAttribute("aria-pressed", String(on));
  const url = new URL(location.href);
  if (on) url.searchParams.set("edit", "");
  else url.searchParams.delete("edit");
  history.replaceState(null, "", url.href.replace("?edit=", "?edit"));
  // the site's navigation bar (added by the site build) marks Viewer or Playground
  for (const a of document.querySelectorAll(".site-bar a")) {
    const current = a.textContent === (on ? "Playground" : "Viewer");
    if (current) a.setAttribute("aria-current", "page");
    else if (a.textContent === "Viewer" || a.textContent === "Playground") a.removeAttribute("aria-current");
  }
  showTools();
}

/** Operations on the selected star: plug a sub-term into a leaf, or collapse one. */
function showTools() {
  const box = $("tools");
  const { doc, parsed, selected: star } = state;
  if (!state.editing || !doc || !parsed) return box.replaceChildren();
  if (!star || star.role === "outer") {
    return box.replaceChildren(el("p", "Select a star to plug a diagram into it, or to collapse a sub-diagram into one star."));
  }
  if (star.role === "intermediate") {
    const button = el("button", `Collapse “${star.label ?? "sub-term"}” into one star`);
    button.addEventListener("click", () => run(() => collapse(doc, pathOf(star))));
    const note = el("p", "Its relation becomes the one the sub-term computes, so the outer relation does not change.");
    note.classList.add("muted");
    return box.replaceChildren(el("h3", "Selected sub-term"), button, note);
  }
  const k = Number(star.key.slice("leaf:".length));
  const x = parsed.flat.inner[k];
  const fits = compatible(state.library, x);
  if (fits.length === 0) {
    return box.replaceChildren(el("h3", `Plug into ${star.label ?? `X${k + 1}`}`), el("p", `No sub-term in the examples has outer star ${x}.`));
  }
  const select = /** @type {HTMLSelectElement} */ (el("select"));
  fits.forEach((e, i) => select.add(new Option(`${e.label} (from ${e.from})`, String(i))));
  const button = el("button", "Plug in");
  button.addEventListener("click", () => run(() => plugIn(doc, k, /** @type {any} */ (fits[Number(select.value)]))));
  const row = el("div");
  row.classList.add("row");
  row.append(select, button);
  const note = el("p", "Plug-and-play (Spivak §5.1): the star is filled with that diagram, and its relation with that diagram's leaf relations.");
  note.classList.add("muted");
  box.replaceChildren(el("h3", `Plug into ${star.label ?? `X${k + 1}`} : ${x}`), row, note);
}

/** Run an edit; report a failure without changing anything. */
function run(/** @type {() => Doc} */ edit) {
  try {
    apply(marked(edit())).catch(showError);
  } catch (e) {
    showError(e);
  }
}

/** The original example's prose, and any source code, no longer describe an edited document. */
function marked(/** @type {Doc} */ doc) {
  const { code: _, ...rest } = doc;
  if (doc.title.endsWith("(edited)")) return rest;
  return { ...rest, title: `${doc.title} (edited)`, description: `Edited in the playground, starting from “${doc.title}”.` };
}

let typing = 0;
editor.addEventListener("input", () => {
  clearTimeout(typing);
  typing = window.setTimeout(() => {
    try {
      show(JSON.parse(editor.value), { updateEditor: false });
      /** @type {HTMLSelectElement} */ ($("example")).value = "";
    } catch (e) {
      // keep the last good diagram on screen
      $("doc-error").hidden = false;
      $("doc-error").textContent = message(e);
    }
  }, 250);
});

$("compose-all").addEventListener("click", () => state.doc && run(() => composeAll(/** @type {Doc} */ (state.doc))));
$("download").addEventListener("click", () => {
  if (!state.doc) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([prettyJSON(state.doc) + "\n"], { type: "application/json" }));
  a.download = `${state.doc.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "diagram"}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$("share").addEventListener("click", async () => {
  if (!state.doc) return;
  const url = new URL(location.href);
  url.hash = `doc=${await encodeShare(state.doc)}`;
  await navigator.clipboard.writeText(url.href).catch(() => prompt("Copy this link:", url.href));
  $("share").textContent = "Link copied";
  setTimeout(() => ($("share").textContent = "Copy share link"), 1500);
});
$("edit-toggle").addEventListener("click", () => setEditing(!state.editing));

for (const name of ["json", "python"]) {
  $(`tab-${name}`).addEventListener("click", () => {
    for (const other of ["json", "python"]) {
      $(`tab-${other}`).setAttribute("aria-selected", String(other === name));
      $(`pane-${other}`).hidden = other !== name;
    }
  });
}

$("py-scan").addEventListener("click", async () => {
  const button = /** @type {HTMLButtonElement} */ ($("py-scan"));
  const status = (/** @type {string} */ text) => ($("py-status").textContent = text);
  $("py-error").hidden = true;
  button.disabled = true;
  try {
    const doc = await scanPython(
      /** @type {HTMLTextAreaElement} */ ($("py")).value,
      {
        function: /** @type {HTMLInputElement} */ ($("py-function")).value.trim(),
        expand: Number(/** @type {HTMLInputElement} */ ($("py-expand")).value) || 0,
      },
      status,
    );
    await apply(doc);
  } catch (e) {
    $("py-error").hidden = false;
    $("py-error").textContent = message(e);
  } finally {
    button.disabled = false;
  }
});

// -- controls ----------------------------------------------------------------------------

for (const [id, nested] of /** @type {const} */ ([["view-nested", true], ["view-flat", false]])) {
  $(id).addEventListener("click", () => {
    state.nested = nested;
    state.selected = null;
    draw();
    showAlgebra();
    showTools();
  });
}
$("labels").addEventListener("change", (e) => {
  state.labels = /** @type {HTMLInputElement} */ (e.target).checked;
  draw(false);
});
$("reset-zoom").addEventListener("click", () => renderer.resetZoom());
$("file").addEventListener("change", async (e) => {
  const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
  if (file) loadText(await file.text());
});
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file) loadText(await file.text());
});
document.addEventListener("keydown", (e) => {
  const t = e.target;
  if (e.key === "c" && !(t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement)) {
    state.nested = !state.nested;
    draw();
  }
});

function loadText(/** @type {string} */ text) {
  try {
    apply(normalize(JSON.parse(text))).catch(showError);
  } catch (e) {
    showError(e);
  }
}

// -- helpers -----------------------------------------------------------------------------

/** @param {import("../js/src/index.js").Term} t @returns {number} */
function depth(t) {
  return 1 + Math.max(0, ...t.children.map((k) => (k ? depth(k) : 0)));
}

/** @param {string} tag @param {string} [text] */
function el(tag, text) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
}

function message(/** @type {unknown} */ e) {
  return e instanceof Error ? e.message : String(e);
}

function hideError() {
  $("error").hidden = true;
  $("doc-error").hidden = true;
}

function showError(/** @type {unknown} */ e) {
  const target = state.editing ? $("doc-error") : $("error");
  target.hidden = false;
  target.textContent = message(e);
}

// -- start ---------------------------------------------------------------------------------

setEditing(state.editing);
const index = await loadIndex().catch((e) => {
  showError(e);
  return [];
});
await route(index).catch(showError);
addEventListener("hashchange", () => route(index).catch(showError));
// the library of pluggable sub-terms: every labelled sub-term of every example
Promise.all(index.map((/** @type {{slug: string}} */ e) => fetchJSON(`${e.slug}.json`)))
  .then((docs) => {
    state.library = buildLibrary(docs.map(normalize));
    showTools();
  })
  .catch(showError);
