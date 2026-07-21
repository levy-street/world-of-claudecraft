// Type surface for the zero-dep .browserslistrc floor parser (see
// browserslist_targets.mjs). Mirrors the scripts/*.d.mts convention so the test and
// vite.config can import the .mjs under strict tsc without an implicit-any error.

// Parse .browserslistrc text into the ['<id> <version>', ...] array that
// lightningcss browserslistToTargets() consumes (e.g. ['chrome 120', 'safari 17.2']).
export function parseBrowserslistFloors(text: string): string[];

// Read a .browserslistrc from disk and return its parsed floor array.
export function loadBrowserslistFloors(path: string): string[];
