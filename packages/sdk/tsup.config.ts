import { defineConfig } from 'tsup';

export default defineConfig([
  // Browser IIFE bundle — what Cloudflare serves and Kong fronts at /sdk/v1/gh.js.
  // Side-effect bundle: attaches window.gh.data on load. Filename matches the prod URL.
  {
    entry: { gh: 'src/index.ts' },
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
