# World of ClaudeCraft Performance Doctor

This build adds a game-specific browser diagnostics workbench on top of the renderer,
frame, hitch, asset, memory, input, and network telemetry already present in World of
ClaudeCraft.

## Run it on Windows

Double-click `RUN_DIAGNOSTICS.cmd` in the repository root.

The launcher does not install or change dependencies by default. Install the pinned
repository dependencies yourself first, or explicitly authorize the launcher to do it:

```powershell
powershell -ExecutionPolicy Bypass -File .\diagnostics\start-diagnostics.ps1 -InstallDependencies
```

If a sparse checkout omits the large media-asset tree, the launcher stops without changing
Git state. To explicitly allow it to add `public` to the sparse checkout and download those
assets, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\diagnostics\start-diagnostics.ps1 -AllowSparseCheckoutMutation
```

That flag permits the single `git sparse-checkout add public` mutation. It is never implied
by double-clicking the launcher.

The launcher requires Node.js and npm. Only `-InstallDependencies` runs the repository's
pinned pnpm version without changing your global pnpm installation. It also checks concrete runtime files across the audio, Basis, environment, font, map, model,
texture, UI, and VFX asset trees before starting. If Vite fails, the launcher prints the tail of its server logs and
the exact temporary log paths.

You can also launch it directly:

```powershell
powershell -ExecutionPolicy Bypass -File .\diagnostics\start-diagnostics.ps1
```

## Capture a useful diagnosis

1. The launcher enters **Play Offline** automatically with a local diagnostics character.
2. The 15-second scan starts automatically after the first playable frame. If the game tab is hidden,
   the timer and retained measurements restart when you return, so hidden-tab gaps cannot create
   a false low-FPS diagnosis.
3. Move through the slow area, rotate the camera, and trigger the spell, effect, or UI
   action that stutters.
4. The tool runs a measured scene census at the end of the scan. Use **Refresh scene
   census** after moving the camera if you want to update a completed report without rerunning
   the timed capture.
5. Read the ranked findings. Each one includes the cause, measured evidence, an immediate
   confirmation step, the recommended code change, and the relevant source files.
6. Select **Copy clear report** to paste a Markdown report into a Codex task, issue, or chat.
   The report includes the raw snapshot after the readable recommendations.
   The latest completed report is also available only in local server memory at /__diagnostics/latest; it is never uploaded.

Use **Start 15-second scan** again when you want to compare another location. Keep the camera
path and actions similar when comparing two code changes or graphics tiers.

## What it can distinguish

- software rendering, integrated GPU selection, high-DPI pixel pressure, and graphics
  context resets;
- GPU submission pressure versus CPU-side world, entity, nameplate, sim, HUD, and event
  work;
- excessive draw calls, triangles, and shadow-pass cost, attributed to the largest measured
  scene category such as foliage, props, terrain, water, VFX, or entity views;
- shader compilation, texture upload, entity-view creation, and unattributed long-frame
  hitches;
- slow or failed asset preloads, browser long tasks, and heap pressure;
- online network delivery problems versus expensive snapshot parsing and application.

## Manual URL

If the Vite server is already running, open:

```text
http://127.0.0.1:5173/?diagnostics=1&perfTrace=1&diagnosticsAuto=1&diagnosticsCapture=1
```

For deeper local-only trace attribution, add `&perfTrace=1`, reproduce the hitch, then use
the report's raw `devTrace` section.
