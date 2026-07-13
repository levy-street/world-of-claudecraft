---
name: pr-screenshots
description: Capture before/after screenshots for a World of ClaudeCraft PR (desktop and mobile), commit them under docs/screenshots, and reference them from the PR body. Use when a change is visual (render, HUD, CSS, content models, windows), when the PR template's screenshot requirement applies, or when asked to screenshot the game for a review or comparison. Covers the change-aware capture tooling, the before/after protocol, and the known puppeteer/CDP traps.
user-invocable: true
---

# PR screenshots

The repo rule (root `CLAUDE.md`): a visual change ships with before/after screenshots,
desktop and mobile where relevant, committed under `docs/screenshots/` and referenced from
the PR body. This skill is the capture recipe.

## 1. Use the change-aware tooling first

With `npm run dev` running (serves :5173):

```
git diff <base>...HEAD > /tmp/pr.diff
BROWSER_PATH=/path/to/chrome DIFF_FILE=/tmp/pr.diff SHOTS_DIR=pr-shots \
  node scripts/pr_screenshots.mjs
```

`scripts/pr_screenshots.mjs` drives the OFFLINE client through the shared entry flow
(`scripts/enter_offline_game.mjs`, which handles the intro overlay that otherwise hides
`#ui`) and decides WHAT to shoot from the diff: specific windows via the target table,
the generic desktop/mobile HUD for broad visual changes, and nothing for non-visual diffs.

**Adding coverage is one entry in `scripts/pr_shot_targets.mjs`, not a new script.** Each
target maps changed-path substrings to a bring-up recipe (driving `window.__game`) and a
clip region. Only write a bespoke `scripts/<thing>_shot.mjs` when the flow genuinely cannot
be a target entry (for example an online-only or multi-client scene).

## 2. Before/after protocol

1. Capture AFTER on your branch.
2. `git stash` or check out the base commit in a scratch worktree, capture BEFORE with the
   same script and targets, restore.
3. The Vite dev client picks up source changes live, but `npm run server` bundles at START:
   after any branch flip, restart the server before online captures or you will shoot a
   stale bundle.
4. Move the keepers to `docs/screenshots/<slug>/before-*.png` / `after-*.png`, commit them,
   and reference them from the PR body with repo-relative links.
5. For screenshots in a REVIEW COMMENT on someone else's PR: GitHub `user-attachments`
   upload URLs only work from the web UI. Push the PNGs to a gist and embed the gist's raw
   URLs instead.

## 3. Traps that have burned sessions before

- **Viewport sizing:** after `page.setViewport`, `window.innerWidth` can be stale. Use raw
  CDP `Emulation.setDeviceMetricsOverride` for exact metrics, and remember CDP
  `Page.captureScreenshot` shoots the WINDOW, not the viewport: clip explicitly.
- **`page.evaluate` under tsx:** tsx's keepNames injects `__name` and breaks nested
  functions inside evaluate callbacks. Pass string-form bodies to
  `evaluateOnNewDocument`/`evaluate` when a script runs under tsx.
- **`window.__game` proves reachability only to the window boundary.** For a claim about
  real behavior, drive the actual bound key or click, not the debug hook.
- **Mobile is landscape-only in-game** on the web client: use landscape device metrics for
  mobile HUD shots (the shell/guide/admin pages allow portrait).
- **Dev commands:** captures that teleport, level, or grant items need a server started
  with `ALLOW_DEV_COMMANDS=1` (dev only, never production).
