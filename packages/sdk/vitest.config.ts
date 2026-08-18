import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['test/**/*.spec.ts'],
    // Every `vi.spyOn` is restored after the test that created it. Several
    // specs spy on `console.warn`/`console.debug` without restoring, which
    // otherwise bleeds into later tests in the same file and makes assertions
    // depend on execution order.
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
    },
  },
});
