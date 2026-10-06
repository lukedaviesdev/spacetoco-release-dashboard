import { defineVitestConfig } from '@nuxt/test-utils/config';

// Same shape as spacetoco-app's packages/ui. Tests sit next to the file they test;
// node-only tests opt out with `// @vitest-environment node`.
export default defineVitestConfig({
  test: {
    environment: 'nuxt',
    globals: true,
    hookTimeout: 15000,
  },
});
