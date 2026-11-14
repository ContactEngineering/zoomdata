import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

/**
 * Two projects: unit tests in happy-dom, and render tests in headless
 * Chromium with WebGL (SwiftShader). Run one with --project; a run of both
 * with --coverage measures the library across both.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          environment: 'happy-dom',
          setupFiles: ['./vitest.setup.ts'],
        },
      },
      {
        test: {
          name: 'render',
          include: ['test/render/**/*.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            screenshotFailures: false,
            provider: playwright({
              launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
            }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      // A run with --coverage fails below these
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 80 },
    },
  },
});
