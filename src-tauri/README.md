# Desktop shell (Tauri)

A lightweight, Rust-based desktop wrapper for World of ClaudeCraft — an alternative
to the Electron desktop build with much smaller binaries. The window is a thin
webview that loads the live game; there are no custom Rust commands, so the game
runs entirely in the webview against the configured server.

This is offered as a *choice* alongside the existing Electron packaging, not a
replacement.

## Configure

App identity lives in `tauri.conf.json`:

- `productName`, `identifier` — the app name and bundle id.
- `app.windows[0].title` / `app.windows[0].url` — the window title and the site the
  shell loads. Point `url` at your deployment.

## Icons are placeholders

Everything under `icons/` is a **neutral placeholder** (a plain dark square) so no
project's branding ships in this contribution. Replace them with your own art before
publishing a build. The easiest way is:

```
npx @tauri-apps/cli icon path/to/your-logo.png --output src-tauri/icons
```

## Build

```
npm run tauri:dev      # run the shell in dev
npm run tauri:build    # produce a desktop bundle (loads the live site)
npm run tauri:build:lite   # bundle the offline shell-stub fallback instead
```

Requires the Rust toolchain and the Tauri v2 prerequisites for your platform
(see https://tauri.app). `target/` and `Cargo.lock` are gitignored.
