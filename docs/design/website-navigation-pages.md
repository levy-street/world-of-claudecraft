# Website navigation and companion pages

Local design iteration, 14 September 2026, on `codex/main-website-redesign`.

## Design and behavior

The browser header and footer use matte stone surfaces, restrained metal edges,
ivory type, and antique gold accents. Navigation uses plain text with an underline
on hover and a gold underline for the active page. The footer border has no crest.
The existing portal art and its actual ClaudeCraft logo are preserved.

The header Tools disclosure contains the user-provided live website destinations,
updated on 15 September 2026:

- https://records.worldofclaudecraft.com/
- https://scout.worldofclaudecraft.com/
- https://parses.worldofclaudecraft.com/

All three open in a new tab with `noopener noreferrer`. The disclosure is native
HTML, works with the keyboard, and occupies a full row in the mobile navigation.
It is hidden in embedded game shells. The browser Wiki action also opens a new
tab; native and desktop shells retain their existing same-tab navigation through
`openHeaderWiki` in `src/game/website_navigation.ts`.

High Scores, News, Download, and Account share the stone palette, readable spacing,
and consistent headings in `src/styles/shell.website-pages.css`. The standalone
Wiki uses matching colors in its own stylesheet. Account behavior is unchanged.
Recovery codes collapse to one column on narrow screens.

## Verification

Commands run in the website worktree:

```sh
npm run i18n:gen
node_modules/.bin/tsc --noEmit
node_modules/.bin/vitest run tests/website_navigation.test.ts tests/client_shell.test.ts tests/monolith_budget.test.ts tests/css_corpus.test.ts tests/css_value_validity.test.ts tests/css_raw_color_ratchet.test.ts tests/css_token_resolution.test.ts tests/focus_visible_guard.test.ts tests/styles_extraction.test.ts --maxWorkers=2
node_modules/.bin/vitest run tests/guide_route_render.test.ts tests/guide_search.test.ts tests/guide_hash_nav.test.ts tests/wiki_link.test.ts --maxWorkers=2
node_modules/.bin/vitest run tests/client_shell.test.ts --maxWorkers=2
git diff --check
node scripts/gate_select.mjs
```

Generation and typecheck passed. The final focused suite passed 238 tests in nine
files; the guide suite passed 27 tests in four files. The client-shell suite was
rerun after the final mobile navigation ordering change. Explicit Biome checks
passed with existing warnings. `npm run ci:changed` exited successfully but
selected zero files, so it does not establish validation of these working changes.

Browser checks covered phone, tablet, laptop, and desktop layouts. The Tools menu
has the correct destinations and new-tab attributes; active navigation has no
background or shadow; the footer crest pseudo-element is absent. Header bounds
match the viewport exactly at 1280px, with no horizontal page overflow. Populated
leaderboards, news, and account recovery codes were checked using a temporary
fixture because local services returned empty data. That fixture was removed.
The browser Wiki action was observed opening a separate tab and keeping login open.
A final read-only frontend review found no actionable issues.

The full gate stopped during `i18n + wiki + sfx artifacts`: the bundled pnpm
attempted an automatic install and failed with
`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. Dependencies were not purged or
reinstalled. The full build and remaining shared gates are therefore not certified.
No files were staged, committed, or pushed.

15 September URL correction: reran the client-shell command above (136 tests
passed) and `git diff --check` (passed). The local Vite response serves all three
live URLs with the existing new-tab attributes. Reran `node scripts/gate_select.mjs`;
it remains blocked at artifact generation by the same pnpm setup error.
