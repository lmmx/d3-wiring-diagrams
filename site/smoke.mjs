// Browser smoke test of the built site (dist/): every page loads without errors,
// the viewer draws and computes a relation, and a playground edit works.
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

// the playground's Python tab: scan code with the library's scanner, in Pyodide
await page.click("#tab-python");
await page.fill("#py", "def square(x):\n    return x * x\n\ndef hypot(a, b):\n    return (square(a) + square(b)) ** 0.5\n");
await page.fill("#py-function", "hypot");
await page.click("#py-scan");
await page.waitForFunction(() => document.querySelector("#title")?.textContent === "function hypot (scanned)", null, {
  timeout: 180_000,
});
check((await page.$$("#code:not([hidden])")).length === 1, "a scanned document shows its source");
await page.waitForTimeout(1000); // let the previous diagram finish fading out
const nested = await page.$$eval(".wd-star[data-role=intermediate]", (cs) => cs.length);
check(nested === 2, "with expand=1 both square calls are filled with square's body");
await page.fill("#py", "def f(:\n");
await page.click("#py-scan");
await page.waitForSelector("#py-error:not([hidden])", { timeout: 60_000 });
check((await page.textContent("#py-error"))?.includes("line 1") === true, "a syntax error names its line");

await browser.close();
server.close();
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
