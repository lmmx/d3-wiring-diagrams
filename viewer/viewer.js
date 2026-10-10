// The viewer and playground. The diagrams are spec/examples/*.json (or any
// document) drawn with js/src/render.js, and the relational algebra is computed
// live with js/src/rel.js. Editing operations live in ./edit.js, the code
// editors in ./editor.js, and Python scanning in ./python.js.
//
// URL: `#<slug>` picks an example, `#doc=<code>` carries a whole document (see
// encodeShare), and `?edit` opens the playground.
//
// A scanned document's stars are linked to its source (`code.spans`): hovering
// a star marks its code, and the cursor in the code marks its stars.

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
  starSpans,
  starsOnLines,
  subtermAt,
} from "./edit.js";
import { createEditor } from "./editor.js";
import { ScanError, pythonReady, scanPython } from "./python.js";

const EXAMPLES = new URL("../spec/examples/", import.meta.url);
const MAX_ROWS = 40;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const svg = /** @type {SVGSVGElement} */ (/** @type {unknown} */ ($("diagram")));
const tooltip = $("tooltip");
const select = (/** @type {string} */ id) => /** @type {HTMLSelectElement} */ ($(id));

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
  /** @type {Map<string, import("./edit.js").Span>} source spans of the stars, by key */ spans: new Map(),
  /** @type {"python" | "json"} the playground's tab */ tab: /** @type {"python" | "json"} */ ("python"),
  /** the module name scans of the Python editor use */ pyName: "playground.py",
};

// d3 is the vendored UMD build loaded by index.html
const renderer = createRenderer(/** @type {any} */ (globalThis).d3, svg, {
  onHover(target, event) {
    if (!target) {
      tooltip.hidden = true;
      markCode(state.selected);
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
    markCode(target.kind === "star" ? target.item : state.selected);
  },
  onSelect(target) {
    state.selected = target?.kind === "star" ? target.item : null;
    renderer.select(state.selected?.key ?? null);
    markCode(state.selected);
    showAlgebra();
    showTools();
  },
});

// -- code: the editors, and the links between stars and source -------------------------------

/** Mark the stars whose code is on the lines the cursor is on (only while the editor has focus). */
function linkFromCode(/** @type {import("./editor.js").Cursor} */ cursor, /** @type {import("./editor.js").Editor} */ from) {
  if (!from.view.hasFocus) return;
  renderer.link(starsOnLines(state.spans, cursor.fromLine, cursor.toLine));
}

const pyEditor = createEditor($("py-editor"), {
  language: "python",
  label: "Python source",
  placeholder: "def area(width, height):\n    return width * height",
  onChange: () => {
    select("py-program").value = "";
    refreshFunctions();
    scheduleScan();
  },
  onRun: () => void scanNow(),
  onCursor: (c) => linkFromCode(c, pyEditor),
});
const sourceView = createEditor($("code-source"), {
  language: "python",
  label: "Source code of the diagram",
  readOnly: true,
  onCursor: (c) => linkFromCode(c, sourceView),
});
const jsonEditor = createEditor($("doc-editor"), {
  language: "json",
  label: "Document JSON",
  onChange: () => {
    clearTimeout(typing);
    typing = window.setTimeout(() => {
      try {
        show(JSON.parse(jsonEditor.text), { from: "json" });
        select("example").value = "";
      } catch (e) {
        // keep the last good diagram on screen
        $("doc-error").hidden = false;
        $("doc-error").textContent = message(e);
      }
    }, 250);
  },
});
let typing = 0;
for (const e of [pyEditor, sourceView]) e.view.dom.addEventListener("focusout", () => renderer.link(new Set()));

/** The code view the user sees: the playground's Python editor, or the panel's source. */
function codeView() {
  return state.editing && state.tab === "python" ? pyEditor : sourceView;
}

/** Mark the code of a star (or of none) in the visible code view. */
function markCode(/** @type {StarItem | null} */ star) {
  const span = star ? state.spans.get(star.key) : undefined;
  codeView().mark(span ? [span] : []);
}

// -- loading -----------------------------------------------------------------------------

async function fetchJSON(/** @type {string} */ name) {
  const res = await fetch(new URL(name, EXAMPLES));
  if (!res.ok) throw new Error(`could not load ${name} (${res.status})`);
  return res.json();
}

/** @typedef {{slug: string, title: string, source: string, kind: "paper" | "program"}} IndexEntry */

async function loadIndex() {
  /** @type {IndexEntry[]} */
  const index = await fetchJSON("index.json");
  const examples = select("example");
  const groups = { paper: "Spivak's examples", program: "Python programs, scanned" };
  for (const [kind, label] of Object.entries(groups)) {
    const group = document.createElement("optgroup");
    group.label = label;
    for (const e of index.filter((e) => e.kind === kind)) {
      group.append(new Option(kind === "paper" ? `${e.title} — ${e.source.replace("Spivak, ", "")}` : `${e.title} — ${e.source.replace("examples/python/", "")}`, e.slug));
    }
    examples.append(group);
  }
  examples.add(new Option("(your document)", ""));
  examples.addEventListener("change", () => examples.value && (location.hash = examples.value));
  const programs = select("py-program");
  for (const e of index.filter((e) => e.kind === "program")) {
    programs.add(new Option(`${e.source.replace("examples/python/", "")} — ${e.title}`, e.slug));
  }
  programs.add(new Option("Your code", ""));
  programs.addEventListener("change", () => programs.value && (location.hash = programs.value));
  return index;
}

/** Load whatever the URL fragment names. */
async function route(/** @type {{slug: string}[]} */ index) {
  const hash = location.hash.slice(1);
  if (hash.startsWith("doc=")) return show(await decodeShare(hash.slice(4)), { animate: false });
  const slug = hash || (index.find((e) => e.slug === "half-adder") ?? index[0]).slug;
  const doc = await fetchJSON(`${slug}.json`);
  select("example").value = slug;
  select("py-program").value = doc.code ? slug : "";
  // an example opens on the tab that shows what it was made from
  setTab(doc.code ? "python" : "json");
  return show(doc, { animate: false });
}

/**
 * Show a document. Throws (and leaves the screen as it was) if it does not parse.
 * `from` names the editor the document came from, which is left as it is.
 * @param {unknown} data
 * @param {{animate?: boolean, from?: "json" | "python"}} [opts]
 */
function show(data, { animate = true, from } = {}) {
  const doc = normalize(data);
  const parsed = parse(doc);
  state.doc = doc;
  state.parsed = parsed;
  state.selected = null;
  state.spans = doc.code?.spans ? starSpans(parsed.term, doc.code.spans) : new Map();
  hideError();
  if (from !== "json") jsonEditor.text = prettyJSON(doc);
  if (doc.code) {
    sourceView.text = doc.code.source;
    if (from !== "python") {
      pyEditor.text = doc.code.source;
      state.pyName = doc.code.name ?? "playground.py";
      refreshFunctions(doc.code.function ?? "");
      select("py-expand").value = String(doc.code.expand ?? 0);
      pyEditor.diagnose(null);
      $("py-error").hidden = true;
    }
  }
  describe();
  draw(animate);
  showAlgebra();
  showTools();
}

/** Apply an edit: show the new document and make it the current URL's document. */
async function apply(/** @type {Doc} */ doc, /** @type {"json" | "python" | undefined} */ from = undefined) {
  show(doc, { from });
  select("example").value = "";
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
  showCodePanel();
  $("code-name").textContent = doc.code ? `${doc.code.name ?? ""}${doc.code.function ? ` · ${doc.code.function}` : ""}` : "";
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

/** The panel shows the source, unless the playground's Python editor already does. */
function showCodePanel() {
  $("code").hidden = !state.doc?.code || (state.editing && state.tab === "python");
}

function setTab(/** @type {"python" | "json"} */ name) {
  state.tab = name;
  for (const other of ["json", "python"]) {
    $(`tab-${other}`).setAttribute("aria-selected", String(other === name));
    $(`pane-${other}`).hidden = other !== name;
  }
  showCodePanel();
}

function setEditing(/** @type {boolean} */ on) {
  state.editing = on;
  showCodePanel();
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

for (const name of /** @type {const} */ (["json", "python"])) $(`tab-${name}`).addEventListener("click", () => setTab(name));

// -- scanning Python -------------------------------------------------------------------------

let scanTimer = 0;
let scanGeneration = 0;

/** Scan soon: right away the first time (Python has to load), then after a pause in typing. */
function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => void scanNow(), pythonReady() ? 350 : 0);
}

/** Scan the editor's code and draw it. A scan that a newer one overtakes is dropped. */
async function scanNow() {
  clearTimeout(scanTimer);
  const generation = ++scanGeneration;
  const status = (/** @type {string} */ text) => generation === scanGeneration && ($("py-status").textContent = text);
  const started = performance.now();
  const loading = !pythonReady();
  try {
    const doc = await scanPython(
      pyEditor.text,
      { name: state.pyName, function: select("py-function").value, expand: Number(select("py-expand").value) },
      status,
    );
    if (generation !== scanGeneration) return;
    pyEditor.diagnose(null);
    $("py-error").hidden = true;
    await apply(doc, "python");
    status(loading ? "Python loaded; the diagram now follows your edits." : `Drawn in ${Math.round(performance.now() - started)} ms.`);
  } catch (e) {
    if (generation !== scanGeneration) return;
    status("");
    $("py-error").hidden = false;
    $("py-error").textContent = message(e);
    pyEditor.diagnose(e instanceof ScanError ? e.where : null, message(e));
  }
}

/**
 * Offer the functions the code defines (read from the editor's syntax tree),
 * keeping the current choice. A choice the code no longer defines stays, marked,
 * so that the scan can say so.
 */
function refreshFunctions(/** @type {string | undefined} */ choose = undefined) {
  const box = select("py-function");
  const current = choose ?? box.value;
  const names = pyEditor.functions();
  const options = [["", "the whole module"], ...names.map((n) => [n, `def ${n}`])];
  if (current && !names.includes(current)) options.push([current, `${current} (not found)`]);
  const same = box.options.length === options.length && options.every(([v, t], i) => box.options[i].value === v && box.options[i].text === t);
  if (!same) box.replaceChildren(...options.map(([v, t]) => new Option(t, v)));
  box.value = current;
}

$("py-scan").addEventListener("click", () => void scanNow());
for (const id of ["py-function", "py-expand"]) $(id).addEventListener("change", () => void scanNow());

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
  const typing = t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;
  if (e.key === "c" && !typing && !(t instanceof HTMLElement && t.isContentEditable)) {
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
