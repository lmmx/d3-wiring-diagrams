// Scan Python code in the browser by running the library's own scanner
// (python/src/wiring_diagrams/code.py) in Pyodide, so the playground and
// `python -m wiring_diagrams.code` cannot disagree.
//
// Pyodide (about 10 MB) is fetched from jsDelivr the first time a scan is
// asked for, and not before.

const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";
const PACKAGE = new URL("../python/src/wiring_diagrams/", import.meta.url);

/** The package's modules (js/test/playground.test.js checks this list against the directory). */
export const PACKAGE_FILES = [
  "__init__.py",
  "closed.py",
  "code.py",
  "diagram.py",
  "eq.py",
  "errors.py",
  "examples.py",
  "rel.py",
  "star.py",
  "term.py",
];

/** @type {Promise<any> | null} */
let ready = null;

/** Load Pyodide and the package once; later calls share the same promise. */
function python(/** @type {(status: string) => void} */ onStatus) {
  ready ??= (async () => {
    onStatus("Loading Python (Pyodide, about 10 MB, only once)…");
    const url = `${PYODIDE}pyodide.mjs`;
    const { loadPyodide } = /** @type {any} */ (await import(url));
    const py = await loadPyodide({ indexURL: PYODIDE });
    py.FS.mkdirTree("/lib/wiring_diagrams");
    await Promise.all(
      PACKAGE_FILES.map(async (f) => {
        const res = await fetch(new URL(f, PACKAGE));
        if (!res.ok) throw new Error(`could not load ${f} (${res.status})`);
        py.FS.writeFile(`/lib/wiring_diagrams/${f}`, await res.text());
      }),
    );
    py.runPython("import sys; sys.path.insert(0, '/lib')");
    return py;
  })();
  ready.catch(() => (ready = null)); // let a later attempt retry after a network failure
  return ready;
}

/**
 * Scan Python source into a document (docs/format.md), with `code` set.
 *
 * @param {string} source
 * @param {{name?: string, function?: string, expand?: number}} options
 * @param {(status: string) => void} onStatus
 * @returns {Promise<import("./edit.js").Doc>}
 */
export async function scanPython(source, options, onStatus) {
  const py = await python(onStatus);
  onStatus("Scanning…");
  const globals = py.toPy({
    source,
    name: options.name ?? "playground.py",
    function: options.function || null,
    expand: options.expand ?? 0,
  });
  try {
    const json = py.runPython(
      [
        "import json",
        "from wiring_diagrams.code import document",
        "json.dumps(document(source, name=name, function=function, expand=expand))",
      ].join("\n"),
      { globals },
    );
    return JSON.parse(json);
  } catch (e) {
    // a PythonError's message is the whole traceback: its last line says what went
    // wrong, and the last "line N" mention says where
    const text = String(e instanceof Error ? e.message : e).trim();
    const what = text.split("\n").pop() ?? text;
    const where = [...text.matchAll(/line (\d+)/g)].pop()?.[1];
    throw new Error(where && !what.includes(`line ${where}`) ? `${what} (line ${where})` : what);
  } finally {
    globals.destroy();
    onStatus("");
  }
}
