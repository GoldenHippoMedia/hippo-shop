#!/usr/bin/env node
// Generates packages/sdk/dist/index.html — a small landing page served from the
// Cloudflare Pages root. Run automatically after tsup; reads version + sizes
// from the actual build output so the page stays in sync.

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const distDir = resolve(pkgRoot, 'dist');
const pkg = JSON.parse(readFileSync(resolve(pkgRoot, 'package.json'), 'utf8'));

const assets = [
  { name: 'gh.js', label: 'IIFE bundle', note: 'browser <script> tag' },
  { name: 'gh.mjs', label: 'ESM', note: 'modern bundlers' },
  { name: 'gh.cjs', label: 'CJS', note: 'Node / legacy bundlers' },
  { name: 'gh.d.ts', label: 'Types', note: 'TypeScript declaration' },
];

const formatSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
};

const rows = assets
  .map(({ name, label, note }) => {
    const size = statSync(resolve(distDir, name)).size;
    return `<tr><td><a href="/${name}"><code>/${name}</code></a></td><td>${label}</td><td>${note}</td><td class="size">${formatSize(size)}</td></tr>`;
  })
  .join('\n          ');

const escape = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>@goldenhippo/hippo-shop-sdk v${pkg.version}</title>
  <meta name="description" content="${escape(pkg.description)}">
  <style>
    :root {
      --fg: #0f172a;
      --fg-muted: #64748b;
      --bg: #fafafa;
      --surface: #ffffff;
      --accent: #0ea5e9;
      --border: #e2e8f0;
      --code-bg: #f1f5f9;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --fg: #f1f5f9;
        --fg-muted: #94a3b8;
        --bg: #0b1220;
        --surface: #111827;
        --accent: #38bdf8;
        --border: #1f2937;
        --code-bg: #0f172a;
      }
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font: 16px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: var(--fg);
      background: var(--bg);
      padding: 3rem 1.25rem 4rem;
    }
    main {
      max-width: 720px;
      margin: 0 auto;
    }
    header {
      margin-bottom: 2.5rem;
    }
    .pkg-name {
      margin: 0;
      font-family: ui-monospace, 'SF Mono', Menlo, monospace;
      font-size: 1.35rem;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .meta {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-top: 0.5rem;
      color: var(--fg-muted);
      font-family: ui-monospace, 'SF Mono', Menlo, monospace;
      font-size: 0.875rem;
    }
    .badge {
      display: inline-block;
      padding: 0.125rem 0.5rem;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface);
      font-size: 0.75rem;
    }
    .description {
      margin: 1.5rem 0 0;
      color: var(--fg-muted);
      max-width: 60ch;
    }
    section {
      margin-top: 2.5rem;
    }
    h2 {
      margin: 0 0 1rem;
      font-size: 0.75rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--fg-muted);
      font-weight: 600;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      font-size: 0.9rem;
    }
    th, td {
      text-align: left;
      padding: 0.65rem 0.875rem;
      border-bottom: 1px solid var(--border);
    }
    tr:last-child td { border-bottom: 0; }
    th {
      background: var(--code-bg);
      font-weight: 500;
      font-size: 0.75rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--fg-muted);
    }
    td code {
      color: var(--accent);
    }
    td.size {
      font-family: ui-monospace, 'SF Mono', Menlo, monospace;
      font-size: 0.85rem;
      color: var(--fg-muted);
      text-align: right;
      white-space: nowrap;
    }
    pre {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem 1.125rem;
      margin: 0;
      overflow-x: auto;
      font-size: 0.85rem;
      line-height: 1.5;
      font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    }
    a {
      color: var(--accent);
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    footer {
      margin-top: 3rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--border);
      color: var(--fg-muted);
      font-size: 0.85rem;
      display: flex;
      gap: 1.25rem;
      flex-wrap: wrap;
    }
    footer a { color: var(--fg-muted); }
  </style>
</head>
<body>
  <main>
    <header>
      <h1 class="pkg-name">@goldenhippo/hippo-shop-sdk</h1>
      <p class="meta">
        <span class="badge">v${pkg.version}</span>
        <span class="badge">MIT</span>
        <span class="badge">SLSA provenance</span>
      </p>
      <p class="description">${escape(pkg.description)}</p>
    </header>

    <section>
      <h2>Direct asset URLs</h2>
      <table>
        <thead>
          <tr><th>Path</th><th>Format</th><th>Use</th><th class="size">Size</th></tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </section>

    <section>
      <h2>Quickstart</h2>
      <pre><code>&lt;script src="/gh.js"
        data-key="gh_pk_..."
        data-brand="Your Brand"&gt;&lt;/script&gt;</code></pre>
    </section>

    <footer>
      <a href="https://www.npmjs.com/package/@goldenhippo/hippo-shop-sdk">npm</a>
      <a href="https://github.com/GoldenHippoMedia/hippo-shop">source</a>
      <a href="https://www.npmjs.com/package/@goldenhippo/hippo-shop-sdk?activeTab=code">provenance</a>
    </footer>
  </main>
</body>
</html>
`;

writeFileSync(resolve(distDir, 'index.html'), html);
const sizeKB = (html.length / 1024).toFixed(2);
console.log(`landing  dist/index.html  ${sizeKB} KB`);
