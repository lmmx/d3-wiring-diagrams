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
let loaded = false;

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
    loaded = true;
    return py;
  })();
  ready.catch(() => (ready = null)); // let a later attempt retry after a network failure
  return ready;
}

/** A scan that failed: what went wrong, and where in the source if it is known. */
export class ScanError extends Error {
  /** @param {string} message @param {import("./editor.js").Diagnostic | null} where */
  constructor(message, where) {
    super(message);
    this.where = where;
  }
}

// Python's errors become data here, rather than a traceback to pick apart in JS
const SCAN = `
import json
from wiring_diagrams.code import document

def _scan():
    try:
        return {"doc": document(source, name=name, function=function, expand=expand)}
    except SyntaxError as e:
        line, col = e.lineno or 1, max((e.offset or 1) - 1, 0)
        end_line, end_col = e.end_lineno or line, max((e.end_offset or 0) - 1, col + 1)
        where = {"line": line, "column": col, "endLine": end_line, "endColumn": end_col}
        return {"error": f"{type(e).__name__}: {e.msg} (line {line})", "where": where}
    except KeyError as e:  # no such function
        return {"error": str(e.args[0]), "where": None}

json.dumps(_scan())
`;

/**
 * Scan Python source into a document (docs/format.md), with `code` set.
 *
 * @param {string} source
 * @param {{name?: string, function?: string, expand?: number}} options
 * @param {(status: string) => void} onStatus
 * @returns {Promise<import("./edit.js").Doc>}
 * @throws {ScanError} if the source does not parse or has no such function
 */
export async function scanPython(source, options, onStatus) {
  const py = await python(onStatus);
  const globals = py.toPy({
    source,
    name: options.name ?? "playground.py",
    function: options.function || null,
    expand: options.expand ?? 0,
  });
  try {
    const result = JSON.parse(py.runPython(SCAN, { globals }));
    if (result.error) throw new ScanError(result.error, result.where);
    return result.doc;
  } finally {
    globals.destroy();
  }
}

/** Whether Pyodide has been loaded (a scan then takes milliseconds, not seconds). */
export function pythonReady() {
  return loaded;
}
