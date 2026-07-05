import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// OPT-IN Vitest 4 Browser Mode suite for the P15b accessibility gate (axe-core over every
// built window, a keyboard-navigation trap+Esc+return E2E, and a mobile-viewport >=40x40
// target-size pass). Run it explicitly with `npm run test:browser`; a bare `vitest run` uses
// vite.config.ts, which excludes tests/browser/** and **/*.browser.test.ts, so the default
// Node suite never imports the Playwright provider or launches a browser.
//
// The FB Vitest-4 Browser Mode pattern (verified against vitest 4.1.x): the Playwright
// provider moved to its own package `@vitest/browser-playwright` and is passed as the
// `playwright()` FUNCTION (not the old `provider: 'playwright'` string + `browser.name`),
// with `browser.instances`. This config runs Chromium locally; turning the whole suite on
// across engines (WebKit, Firefox) in CI is P17b (decision 14), so only chromium is listed
// here to keep the local run installable with `npx playwright install chromium`.
export default defineConfig({
  test: {
    include: ['tests/browser/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      // P17b adds { browser: 'webkit' } and { browser: 'firefox' } here + the CI matrix.
      instances: [{ browser: 'chromium' }],
    },
  },
});
