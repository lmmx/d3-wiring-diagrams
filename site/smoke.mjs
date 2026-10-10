// Browser smoke test of the built site (dist/): every page loads without errors,
// the viewer draws and computes a relation, a playground edit works, and Python
// code is scanned, drawn and linked to its diagram.
//
//   npm run --prefix site build && npm run --prefix site smoke

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };

const server = createServer((req, res) => {
  let file = path.join(DIST, decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!file.startsWith(DIST) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
const address = server.address();
const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
/** @type {string[]} */
const problems = [];
page.on("pageerror", (e) => problems.push(`page error: ${e}`));
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));

/** @param {boolean} ok @param {string} what */
const check = (ok, what) => {
  if (!ok) problems.push(`failed: ${what}`);
  console.log(`${ok ? "ok" : "FAIL"} - ${what}`);
};

// every page of the site, and every link in the navigation
await page.goto(`${base}/`);
const nav = await page.$$eval(".site-bar a, .cta a", (as) => as.map((a) => /** @type {HTMLAnchorElement} */ (a).href));
for (const href of nav.filter((h) => h.startsWith(base))) {
  const r = await page.request.get(href);
  check(r.status() === 200, `GET ${href.slice(base.length)}`);
}

// the viewer draws the half adder and computes its relation
await page.goto(`${base}/viewer/#half-adder`);
await page.waitForSelector(".wd-star");
check((await page.$$(".wd-star")).length >= 10, "viewer draws the nested half adder");
check((await page.$$("#relation tr")).length === 5, "viewer computes the half adder's 4-row relation");

// the playground: plug AND into the NAND of NOT, giving a gate that copies its input
await page.goto(`${base}/viewer/?edit#not-from-nand`);
await page.waitForSelector(".wd-star[data-role=leaf]");
const leaf = await page.$eval(".wd-star[data-role=leaf]", (c) => {
  const b = c.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height * 0.3 };
});
await page.mouse.click(leaf.x, leaf.y);
const and = await page.$$eval("#tools option", (os) => os.find((o) => o.textContent?.startsWith("AND"))?.getAttribute("value"));
check(and !== undefined, "AND is offered for the NAND star");
await page.selectOption("#tools select", String(and));
await page.click("#tools button");
await page.waitForFunction(() => document.querySelector("#title")?.textContent?.endsWith("(edited)"));
const rows = await page.$$eval("#relation tr", (rs) => rs.slice(1).map((r) => r.textContent));
check(JSON.stringify(rows) === JSON.stringify(["falsefalse", "truetrue"]), "plugging AND into NOT copies its input");
check((await page.evaluate(() => location.hash)).startsWith("#doc="), "the edited document is in the URL");

// a scanned program: the source panel is highlighted, and stars and code are linked
await page.goto(`${base}/viewer/#code-pipeline`);
await page.waitForSelector("#code:not([hidden]) .cm-content .tok-keyword");
check(true, "a scanned example shows its highlighted source");
await page.hover(".wd-star[data-role=leaf] >> nth=0");
const marked = await page.$$eval("#code .cm-linked", (es) => es.map((e) => e.textContent).join(""));
check(marked.length > 0, `hovering a star marks its code (${JSON.stringify(marked)})`);

// the playground opens a program in the Python editor, with its scan options
await page.goto(`${base}/viewer/?edit#code-hypot`);
await page.waitForSelector("#py-editor .cm-content");
check((await page.getAttribute("#tab-python", "aria-selected")) === "true", "a program opens on the Python tab");
check(
  (await page.inputValue("#py-function")) === "hypot" && (await page.inputValue("#py-expand")) === "1",
  "the scan's function and expansion are preselected",
);
// the cursor on square's body marks the two inlined copies of it (a * and a return each)
await page.click("#py-editor .cm-line:has-text('return x * x')");
check((await page.$$(".wd-star.wd-linked")).length === 4, "the cursor in square's body marks both inlined copies");

// editing redraws, with the library's scanner running in Pyodide
const editor = page.locator("#py-editor .cm-content");
await editor.click();
await page.keyboard.press("ControlOrMeta+a");
await page.keyboard.insertText("def square(x):\n    return x * x\n\ndef hypot(a, b):\n    return (square(a) + square(b)) ** 0.5\n");
await page.waitForFunction(() => document.querySelector("#py-status")?.textContent?.includes("loaded"), null, {
  timeout: 180_000,
});
check((await page.textContent("#title")) === "function hypot (scanned)", "an edit is scanned and drawn");
await page.waitForTimeout(1000); // let the previous diagram finish fading out
const nested = await page.$$eval(".wd-star[data-role=intermediate]", (cs) => cs.length);
check(nested === 2, "with one level of inlining both square calls are filled with square's body");
check(
  (await page.$$eval("#py-function option", (os) => os.map((o) => o.value))).join() === ",square,hypot",
  "the functions on offer follow the code",
);
await editor.click();
await page.keyboard.press("ControlOrMeta+a");
await page.keyboard.insertText("def f(:\n");
await page.waitForSelector("#py-error:not([hidden])", { timeout: 60_000 });
check((await page.textContent("#py-error"))?.includes("line 1") === true, "a syntax error names its line");
check((await page.$$("#py-editor .cm-lintRange-error")).length === 1, "and is marked in the editor");

// docs: code blocks are highlighted when the site is built
await page.goto(`${base}/docs/code.html`);
check((await page.$$("pre code .tok-keyword")).length > 0, "docs code blocks are highlighted");

await browser.close();
server.close();
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
