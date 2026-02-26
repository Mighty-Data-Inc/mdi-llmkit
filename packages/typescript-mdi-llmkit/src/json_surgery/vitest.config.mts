// vitest file to permit running tests for kai-scan-template-system package
// conveniently from the package directory.
// npx vitest run --config vitest.config.mts

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/tests/**/*.{test,spec}.ts'],
    exclude: ['node_modules/**', 'dist/**', 'build/**']
  }
});
