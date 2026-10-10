// Code editors for the viewer and playground: CodeMirror 6 (the vendored bundle,
// built by site/vendor.mjs), configured once here.
//
// The editor knows nothing about diagrams. It can mark source spans (the code of
// the star under the pointer), show diagnostics (a syntax error), report where
// the cursor is, and list the functions a scan can draw. viewer.js connects
// these to the renderer.

import {
  Decoration,
  EditorState,
  EditorView,
  StateEffect,
  StateField,
  bracketMatching,
  closeBrackets,
  closeBracketsKeymap,
  defaultKeymap,
  drawSelection,
  ensureSyntaxTree,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSelectionMatches,
  highlightSpecialChars,
  history,
  historyKeymap,
  indentOnInput,
  indentUnit,
  indentWithTab,
  json,
  keymap,
  lineNumbers,
  lintGutter,
  placeholder,
  python,
  searchKeymap,
  setDiagnostics,
  syntaxHighlighting,
  classHighlighter,
} from "./vendor/codemirror.js";

/**
 * `[line, column, endLine, endColumn]`: lines from 1, columns in code points
 * from 0, end exclusive (wiring_diagrams.code).
 * @typedef {[number, number, number, number]} Span
 * @typedef {{line: number, column: number, endLine: number, endColumn: number}} Diagnostic
 * @typedef {{fromLine: number, toLine: number}} Cursor  the lines the selection covers, from 1
 */

/** @type {import("@codemirror/state").StateEffectType<import("@codemirror/view").DecorationSet>} */
const markLinked = StateEffect.define();
const linkedMark = Decoration.mark({ class: "cm-linked" });

/** Decorations for the linked spans, replaced wholesale by `markLinked`. */
const linked = StateField.define({
  create: () => Decoration.none,
  update(marks, tr) {
    for (const e of tr.effects) if (e.is(markLinked)) return e.value;
    return marks.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * @param {HTMLElement} parent
 * @param {{
 *   language: "python" | "json",
 *   label: string,
 *   readOnly?: boolean,
 *   placeholder?: string,
 *   onChange?: (text: string) => void,
 *   onRun?: () => void,
 *   onCursor?: (cursor: Cursor) => void,
 * }} options
 */
export function createEditor(parent, { language, label, readOnly = false, placeholder: hint, onChange, onRun, onCursor }) {
  let quiet = false; // set while the text is replaced from outside, so onChange is not called
  /** @type {import("@codemirror/state").Extension[]} */
  const extensions = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    drawSelection(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    bracketMatching(),
    syntaxHighlighting(classHighlighter),
    language === "python" ? [python(), indentUnit.of("    ")] : [json(), indentUnit.of("  ")],
    // the playground's pane and the panel are narrow: wrap long lines rather than scroll sideways
    EditorView.lineWrapping,
    linked,
    lintGutter(),
    EditorView.contentAttributes.of({ "aria-label": label }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && !quiet) onChange?.(u.state.doc.toString());
      if (u.selectionSet || u.docChanged) onCursor?.(cursorOf(u.state));
    }),
  ];
  if (hint) extensions.push(placeholder(hint));
  if (readOnly) {
    extensions.push(EditorState.readOnly.of(true));
  } else {
    extensions.push(
      history(),
      indentOnInput(),
      closeBrackets(),
      keymap.of([
        { key: "Mod-Enter", run: () => (onRun?.(), true) },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        // Tab indents; Escape then Tab leaves the editor (CodeMirror's default)
        indentWithTab,
      ]),
    );
  }
  const view = new EditorView({ parent, state: EditorState.create({ doc: "", extensions }) });

  return {
    view,
    get text() {
      return view.state.doc.toString();
    },
    /** Replace the text (without calling onChange), keeping the cursor where it can be. */
    set text(text) {
      if (text === view.state.doc.toString()) return;
      quiet = true;
      const head = Math.min(view.state.selection.main.head, text.length);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: head },
        effects: [markLinked.of(Decoration.none)],
      });
      view.dispatch(setDiagnostics(view.state, []));
      quiet = false;
    },
    /** Highlight the code of these spans, scrolling the first into view. @param {readonly Span[]} spans */
    mark(spans) {
      const ranges = spans
        .flatMap((s) => toRange(view.state, s) ?? [])
        .filter((r) => r.to > r.from)
        .sort((a, b) => a.from - b.from || a.to - b.to)
        .map((r) => linkedMark.range(r.from, r.to));
      const first = ranges[0];
      view.dispatch({
        effects: [
          markLinked.of(Decoration.set(ranges)),
          ...(first ? [EditorView.scrollIntoView(first.from, { y: "nearest", yMargin: 24 })] : []),
        ],
      });
    },
    /** Show an error at a place in the code, or clear it. @param {Diagnostic | null} d @param {string} [message] */
    diagnose(d, message = "") {
      const range = d && toRange(view.state, [d.line, d.column, d.endLine, d.endColumn]);
      const diagnostics = range
        ? [{ from: range.from, to: Math.max(range.to, Math.min(range.from + 1, view.state.doc.length)), severity: /** @type {const} */ ("error"), message }]
        : [];
      view.dispatch(setDiagnostics(view.state, diagnostics));
    },
    /** Top-level functions and methods of top-level classes, as the scanner names them. */
    functions() {
      return pythonFunctions(view.state);
    },
    focus() {
      view.focus();
    },
  };
}

/** @typedef {ReturnType<typeof createEditor>} Editor */

/** @param {EditorState} state @returns {Cursor} */
function cursorOf(state) {
  const { from, to } = state.selection.main;
  return { fromLine: state.doc.lineAt(from).number, toLine: state.doc.lineAt(to).number };
}

/** A span as document offsets (code points → UTF-16), or null if it is not in the text. @param {EditorState} state @param {Span} span */
function toRange(state, [line, column, endLine, endColumn]) {
  const lines = state.doc.lines;
  if (line < 1 || endLine < line || line > lines) return null;
  const at = (/** @type {number} */ n, /** @type {number} */ col) => {
    const l = state.doc.line(Math.min(n, lines));
    return l.from + [...l.text].slice(0, Math.max(0, col)).join("").length;
  };
  return { from: at(line, column), to: at(endLine, endColumn) };
}

/**
 * What `wiring_diagrams.code` can scan as `function`: functions at the top
 * level ("f"), and methods of classes at the top level ("C.m"), in order.
 * Read from the editor's own syntax tree (Lezer's Python grammar).
 * @param {EditorState} state @returns {string[]}
 */
function pythonFunctions(state) {
  const tree = ensureSyntaxTree(state, state.doc.length, 200);
  if (!tree) return [];
  const text = (/** @type {import("@lezer/common").SyntaxNode} */ n) => state.doc.sliceString(n.from, n.to);
  /** @param {import("@lezer/common").SyntaxNode | null} n @returns {import("@lezer/common").SyntaxNode | null} */
  const undecorated = (n) => (n?.name === "DecoratedStatement" ? n.getChild("FunctionDefinition") ?? n.getChild("ClassDefinition") : n);
  /** @type {string[]} */
  const out = [];
  for (let n = tree.topNode.firstChild; n; n = n.nextSibling) {
    const def = undecorated(n);
    const name = def?.getChild("VariableName");
    if (!def || !name) continue;
    if (def.name === "FunctionDefinition") out.push(text(name));
    else if (def.name === "ClassDefinition") {
      for (let m = def.getChild("Body")?.firstChild ?? null; m; m = m.nextSibling) {
        const method = undecorated(m);
        const mname = method?.name === "FunctionDefinition" ? method.getChild("VariableName") : null;
        if (mname) out.push(`${text(name)}.${text(mname)}`);
      }
    }
  }
  return out;
}
