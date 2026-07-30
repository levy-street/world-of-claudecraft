// Resolves a local Chromium-family browser binary for puppeteer-core.
// Override with BROWSER_PATH=/path/to/browser if yours lives elsewhere.
// The candidate list and the non-throwing resolver live in
// browser_path_resolve.mjs; this module keeps the load-time throw for the many
// screenshot/E2E scripts that cannot run without a browser.
import { findBrowserPath } from './browser_path_resolve.mjs';

export const BROWSER_PATH = findBrowserPath();

if (!BROWSER_PATH) {
  throw new Error(
    'No Chrome/Edge/Chromium binary found. Set BROWSER_PATH to your browser executable.',
  );
}
