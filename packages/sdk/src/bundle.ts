/**
 * Browser IIFE entry point.
 *
 * Deliberately a side-effect-only import of `./index`: evaluating that module
 * auto-boots the SDK and attaches `window.gh.data`. Nothing is re-exported.
 *
 * Why this file exists rather than pointing the IIFE build straight at
 * `./index`: `index.ts` re-exports the package's public API for the ESM/CJS
 * builds, and an IIFE has nowhere to put those exports. esbuild emitted them
 * onto a throwaway object (`exports.GhDataClient = …` against `({})`) that no
 * caller could ever reach — dead bytes on the CDN — and the live bindings
 * pinned every exported symbol against tree-shaking. The ESM/CJS builds still
 * use `index.ts`, so the published package's API is unchanged.
 */
import './index';
