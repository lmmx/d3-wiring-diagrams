// Build the static site into dist/: the README and docs/*.md as pages, plus the
// viewer/playground and what it loads (js/src, spec, the vendored d3).
//
//   npm ci --prefix site && npm run --prefix site build
//
// There is no framework. Markdown is rendered with `marked`, and the pages share
// one template. Code blocks are highlighted here, at build time, with the same
// parsers (Lezer) and token classes (viewer/code.css) as the playground's
// editor, so the pages ship no highlighting script. The build fails on any relative link or #anchor that does not
// resolve, so a deploy cannot ship a dead link. Links to repository files that
// are not part of the site (Python and Rust sources, say) point to GitHub.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { classHighlighter, highlightCode } from "@lezer/highlight";
import { parser as javascript } from "@lezer/javascript";
import { parser as json } from "@lezer/json";
import { parser as python } from "@lezer/python";
import { parser as rust } from "@lezer/rust";
import { Marked } from "marked";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const REPO = "https://github.com/lmmx/d3-wiring-diagrams";
const BRANCH = "master";

/** Copied as they are: what the viewer loads, and the images the docs use. */
const ASSETS = ["viewer", "js/src", "spec", "docs/img", "python/src/wiring_diagrams"];

/** Markdown sources (repository paths) → page paths in dist/. */
const PAGES = new Map([["README.md", "index.html"]]);
for (const f of readdirSync(path.join(ROOT, "docs")).filter((f) => f.endsWith(".md")).sort()) {
  PAGES.set(`docs/${f}`, `docs/${f.replace(/\.md$/, ".html")}`);
}
const JOURNAL = readdirSync(path.join(ROOT, "docs/journal")).filter((f) => f.endsWith(".md")).sort();
for (const f of JOURNAL) PAGES.set(`docs/journal/${f}`, `docs/journal/${f.replace(/\.md$/, ".html")}`);

const NAV = [
  ["index.html", "Home"],
  ["viewer/", "Viewer"],
  ["viewer/?edit#code-hypot", "Playground"],
  ["docs/theory.html", "Theory"],
  ["docs/format.html", "Format"],
  ["docs/code.html", "Code"],
  ["docs/visualisation.html", "Visualisation"],
  ["docs/performance.html", "Performance"],
  ["docs/journal/index.html", "Journal"],
];

// -- links ------------------------------------------------------------------------------

/** @type {{page: string, href: string, target: string, fragment: string}[]} links to check once all pages exist */
const pending = [];
/** @type {Map<string, Set<string>>} page → heading ids */
const anchors = new Map();

/**
 * Rewrite a link written for GitHub (relative to the markdown file) into a link
 * that works on the site, relative to the output page.
 * @param {string} source repository path of the markdown file
 * @param {string} page output path of the page
 * @param {string} href
 */
function rewrite(source, page, href) {
  if (/^[a-z]+:/i.test(href)) return href;
  const [beforeFragment, fragment = ""] = href.split("#");
  const [rawPath, query] = beforeFragment.split("?"); // `?edit` opens the playground
  if (rawPath === "") {
    pending.push({ page, href, target: page, fragment });
    return href;
  }
  const repoPath = path.posix.normalize(path.posix.join(path.posix.dirname(source), rawPath)).replace(/\/$/, "");
  const fromPage = (/** @type {string} */ target) => {
    const rel = path.posix.relative(path.posix.dirname(page), target) || path.posix.basename(target);
    pending.push({ page, href, target, fragment });
    // a directory's index is linked as the directory, as written
    const link = rawPath.endsWith("/") && rel.endsWith("index.html") ? rel.slice(0, -"index.html".length) : rel;
    return link + (query !== undefined ? `?${query}` : "") + (fragment ? `#${fragment}` : "");
  };
  if (PAGES.has(repoPath)) return fromPage(/** @type {string} */ (PAGES.get(repoPath)));
  if (repoPath === "docs/journal") return fromPage("docs/journal/index.html");
  if (repoPath === "viewer" || ASSETS.some((a) => repoPath === a || repoPath.startsWith(`${a}/`))) {
    return fromPage(repoPath === "viewer" ? "viewer/index.html" : repoPath);
  }
  const full = path.join(ROOT, repoPath);
  if (!existsSync(full)) throw new Error(`${source}: broken link ${href}`);
  const kind = statSync(full).isDirectory() ? "tree" : "blob";
  return `${REPO}/${kind}/${BRANCH}/${repoPath}${fragment ? `#${fragment}` : ""}`;
}

/** GitHub's heading ids: lower case, punctuation removed, spaces to hyphens, repeats numbered. */
function slugger() {
  /** @type {Map<string, number>} */
  const seen = new Map();
  return (/** @type {string} */ text) => {
    const base = text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

// -- rendering --------------------------------------------------------------------------

const escape = (/** @type {string} */ s) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const stripTags = (/** @type {string} */ html) =>
  html.replace(/<[^>]+>/g, "").replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'");

/** Code block languages → parsers. Blocks in other languages fail the build, except these. */
const PARSERS = new Map([
  ["python", python],
  ["js", javascript],
  ["json", json],
  ["rust", rust],
  ["sh", StreamLanguage.define(shell).parser],
]);
const PLAIN = new Set(["", "text", "markdown"]);

/** A code block as HTML, its tokens wrapped in `tok-*` classes. @param {string} code @param {string} lang */
function highlight(code, lang) {
  const parser = PARSERS.get(lang);
  if (!parser) {
    if (!PLAIN.has(lang)) throw new Error(`no highlighter for code blocks in ${JSON.stringify(lang)}`);
    return escape(code);
  }
  let html = "";
  highlightCode(
    code,
    parser.parse(code),
    classHighlighter,
    (text, classes) => (html += classes ? `<span class="${classes}">${escape(text)}</span>` : escape(text)),
    () => (html += "\n"),
  );
  return html;
}

/** @param {string} source @param {string} page */
function render(source, page) {
  const slug = slugger();
  const ids = new Set();
  let title = "";
  const marked = new Marked({
    gfm: true,
    walkTokens(token) {
      if ((token.type === "link" || token.type === "image") && token.href) token.href = rewrite(source, page, token.href);
    },
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const text = stripTags(html);
        if (depth === 1 && !title) title = text;
        const id = slug(text);
        ids.add(id);
        return `<h${depth} id="${escape(id)}"><a class="anchor" href="#${escape(id)}" aria-hidden="true">#</a>${html}</h${depth}>\n`;
      },
      code({ text, lang }) {
        const name = (lang ?? "").trim().split(/\s/)[0];
        const cls = name ? ` class="language-${escape(name)}"` : "";
        return `<pre><code${cls}>${highlight(text, name)}</code></pre>\n`;
      },
    },
  });
  const body = /** @type {string} */ (marked.parse(readFileSync(path.join(ROOT, source), "utf8")));
  anchors.set(page, ids);
  return { title, body };
}

/**
 * The site's navigation bar, with links relative to `page`.
 * @param {string} page @param {string} [extra] additional class
 */
function navBar(page, extra = "") {
  const up = (/** @type {string} */ target) => path.posix.relative(path.posix.dirname(page), target) || ".";
  const links = NAV.map(([href, label]) => {
    const [file, query] = href.split("?");
    const target = file.endsWith("/") ? `${up(file)}/` : up(file);
    const current = href === page || (file === "viewer/" && page === "viewer/index.html" && !query);
    return `<a href="${escape(target + (query !== undefined ? `?${query}` : ""))}"${current ? ' aria-current="page"' : ""}>${label}</a>`;
  });
  return `<header class="site-bar${extra ? ` ${extra}` : ""}">
      <nav aria-label="Site">
        ${links.join("\n        ")}
        <a href="${REPO}">GitHub</a>
      </nav>
    </header>`;
}

/** @param {string} page @param {string} title @param {string} body */
function template(page, title, body) {
  const up = (/** @type {string} */ target) => path.posix.relative(path.posix.dirname(page), target) || ".";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escape(title)} · Wiring diagrams</title>
    <meta name="description" content="Spivak's operad of wiring diagrams in Python, Rust and JavaScript, with a d3 viewer and playground." />
    <link rel="stylesheet" href="${escape(up("site.css"))}" />
    <link rel="stylesheet" href="${escape(up("nav.css"))}" />
    <link rel="stylesheet" href="${escape(up("viewer/code.css"))}" />
  </head>
  <body>
    ${navBar(page)}
    <main class="prose">
${body}
    </main>
  </body>
</html>
`;
}

const LEAD = `<div class="cta">
  <a class="button primary" href="viewer/#half-adder">Open the viewer</a>
  <a class="button" href="viewer/?edit#code-pipeline">Draw your Python code</a>
  <a class="button" href="viewer/?edit#or-from-nand">Plug diagrams together</a>
  <a class="button" href="docs/theory.html">Read how it maps to the paper</a>
</div>
`;

// -- build --------------------------------------------------------------------------------

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
const notCache = (/** @type {string} */ src) => !src.includes("__pycache__");
for (const dir of ASSETS) cpSync(path.join(ROOT, dir), path.join(DIST, dir), { recursive: true, filter: notCache });
cpSync(path.join(ROOT, "site/site.css"), path.join(DIST, "site.css"));
cpSync(path.join(ROOT, "site/nav.css"), path.join(DIST, "nav.css"));

// the viewer gets the same navigation bar, where its page leaves a marker for it
const viewer = path.join(DIST, "viewer/index.html");
const marker = /<!-- site-nav:[^>]*-->/;
const viewerHTML = readFileSync(viewer, "utf8");
if (!marker.test(viewerHTML)) throw new Error("viewer/index.html has no <!-- site-nav: --> marker");
writeFileSync(
  viewer,
  viewerHTML.replace(marker, `<link rel="stylesheet" href="../nav.css" />\n    ${navBar("viewer/index.html", "wide")}`),
);

for (const [source, page] of PAGES) {
  const { title, body } = render(source, page);
  const out = path.join(DIST, page);
  mkdirSync(path.dirname(out), { recursive: true });
  // the home page's buttons go after the opening paragraph
  const html = page === "index.html" ? body.replace(/<\/p>/, `</p>\n${LEAD}`) : body;
  writeFileSync(out, template(page, page === "index.html" ? "Home" : title, html));
}

// the journal has no index of its own on GitHub (a directory listing); write one
const entries = JOURNAL.map((f) => {
  const page = `docs/journal/${f.replace(/\.md$/, ".html")}`;
  const heading = readFileSync(path.join(ROOT, "docs/journal", f), "utf8").match(/^# (.+)$/m)?.[1] ?? f;
  return `<li><a href="${escape(path.posix.basename(page))}">${escape(heading)}</a></li>`;
});
writeFileSync(
  path.join(DIST, "docs/journal/index.html"),
  template(
    "docs/journal/index.html",
    "Journal",
    `<h1>Journal</h1>\n<p>Development log; the format is described in <a href="../JOURNAL.html">JOURNAL</a>.</p>\n<ul>\n${entries.join("\n")}\n</ul>\n`,
  ),
);
anchors.set("docs/journal/index.html", new Set());

// every relative link must reach a file in dist/, and every #fragment a heading on that page
const broken = [];
for (const { page, href, target, fragment } of pending) {
  const file = path.join(DIST, target);
  if (!existsSync(file)) broken.push(`${page}: ${href} → ${target} does not exist`);
  else if (target === "viewer/index.html") {
    // the viewer's fragment names an example
    if (fragment && !existsSync(path.join(DIST, "spec/examples", `${fragment}.json`))) {
      broken.push(`${page}: ${href} → no example ${fragment} in spec/examples`);
    }
  } else if (fragment && target.endsWith(".html") && !anchors.get(target)?.has(fragment)) {
    broken.push(`${page}: ${href} → no heading #${fragment} in ${target}`);
  }
}
if (broken.length) {
  console.error(broken.join("\n"));
  process.exit(1);
}
console.log(`built ${PAGES.size + 1} pages and ${ASSETS.length} asset directories into dist/ (${pending.length} links checked)`);
