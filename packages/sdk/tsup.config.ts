import { defineConfig } from 'tsup';

export default defineConfig([
  // Browser IIFE bundle — what Cloudflare serves and Kong fronts at /sdk/v3/gh.js
  // (active CDN URL for the current SDK major; future majors get their own /sdk/vN/ path).
  // Side-effect bundle: attaches window.gh.data on load. Filename matches the prod URL.
  // Entry is src/bundle.ts, not src/index.ts: index.ts re-exports the public API
  // for the ESM/CJS builds, and an IIFE has nowhere to put exports — esbuild emitted
  // them against an unreachable throwaway object and the live bindings blocked
  // tree-shaking. bundle.ts is a side-effect-only import of index.ts.
  {
    entry: { gh: 'src/bundle.ts' },
    format: ['iife'],
    platform: 'browser',
    target: 'es2020',
    minify: true,
    sourcemap: true,
    clean: true,
    outDir: 'dist',
    outExtension: () => ({ js: '.js' }),
    noExternal: ['@goldenhippo/hippo-shop-types'],
    treeshake: true,
  },
  // ESM + CJS dual build for consumers that want to embed the SDK in their own bundle.
  {
    entry: { gh: 'src/index.ts' },
    format: ['esm', 'cjs'],
    platform: 'neutral',
    target: 'es2022',
    dts: true,
    sourcemap: true,
    clean: false,
    outDir: 'dist',
    outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.mjs' }),
    noExternal: ['@goldenhippo/hippo-shop-types'],
    treeshake: true,
  },
]);
