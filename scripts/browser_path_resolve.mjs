// Non-throwing Chromium-family browser resolver. `browser_path.mjs` wraps this
// with a load-time throw for scripts that REQUIRE a browser; callers that can
// degrade gracefully (the asset pipeline's optional headless preview render)
// import this directly and handle a null result. Keeping the candidate list in
// one place means the two entry points never drift.
import fs from 'node:fs';

export const BROWSER_CANDIDATES = [
  process.env.BROWSER_PATH,
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  // Windows
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  // Linux
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

/** Resolve a local browser binary, or null if none is installed. Never throws. */
export function findBrowserPath() {
  return BROWSER_CANDIDATES.find((p) => fs.existsSync(p)) ?? null;
}
