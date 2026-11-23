# Tavern camera stability

Base: `tavern-v4-aprobada`. Worktree: `C:/tmp/woc-tavern-codex`, branch
`codex/taberna`. The original tavern branch is unchanged.

The tavern now preserves the requested viewing angle inside rooms. Walls and
ceilings shorten the camera distance instead of automatically choosing a new
angle. Doorway height recovery remains smooth, and hiding the close avatar no
longer jumps the lens to the eyes. Other interiors retain adaptive framing.

## Visual comparison

- Hall, desktop: [before](before-desktop-hall_high.png),
  [after](after-desktop-hall_high.png).
- Bar, desktop: [before](before-desktop-bar.png), [after](after-desktop-bar.png).
- Hall, narrow viewport: [before](before-mobile-hall_high.png),
  [after](after-mobile-hall_high.png).

Captured with `scripts/mirefen_tavern_shot.mjs`, high graphics, desktop
1280x720 and narrow viewport 390x844. `CAMERA_DEBUG=1` logs the actual active
camera policy and pose. After captures report `preserve-angle`, with zero
lift, swing and entry cap in the settled room. Restart Vite after changing
these modules if it continues serving cached source from the previous run.

## Validation on Windows

- `pnpm install --frozen-lockfile`: passed.
- `pnpm exec vitest run tests/mirefen_tavern_camera_stability.test.ts tests/interior_camera.test.ts tests/interior_camera_core.test.ts tests/mirefen_tavern_interior_core.test.ts tests/graphics_overhaul_integration.test.ts --maxWorkers=2`: passed.
- `pnpm exec tsc --noEmit` with `GOMAXPROCS=2`: passed.
- `pnpm run build:bundle`: passed.
- Explicit `pnpm exec biome check` on the changed camera and test files: passed.
- `node scripts/gate_select.mjs` with `GATE_SELECT_BASE=tavern-v4-aprobada`
  and `GATE_MAX_WORKERS=2`: not green. Artifact generation/freshness and the
  malware check passed, but the first test leg found an unrelated Windows
  path-separator assertion in `tests/active_kit_prewarm.test.ts`. The run was
  stopped after that failure; remaining gate legs were not completed.
- Reproduced separately with `pnpm exec vitest run tests/active_kit_prewarm.test.ts -t 'leaves out only' --maxWorkers=1`:
  the assertion expects `ability_vfx/fx.ts`, while Windows returns
  `ability_vfx\fx.ts`. That test and its scanned VFX source are unchanged
  from the base tag. No unrelated test was modified to obtain a pass.
- Browser: static desktop/narrow captures and the existing real-movement
  `walk_in_steep` / `walk_out_default` scenarios on port 5190. The entry walk
  reaches the hearth collision and settles there; it does not traverse the
  furniture. Exit restores the outdoor chase camera. The offline browser
  also reports pre-existing missing training-dummy/staff preload warnings.

The focused tests cover indoor angle preservation, ceiling/corner/arch
collisions, entry recovery and stationary stability at 30/60/144 FPS,
close-body hiding and showing without position jumps, and hiding during
doorway recovery without an angle jump. Frontend and test-coverage reviews
found no outstanding scoped issue. Full repository validation remains blocked
by the separate Windows test failure above.

## Try it

Start the client from this worktree, using unused ports:

```powershell
$env:WOC_DEV_API_TARGET='http://127.0.0.1:8790'
pnpm exec vite --host 127.0.0.1 --port 5190 --strictPort
```

Enter offline mode and visit the Mirefen tavern, near world x=-17, z=408.
Walk in, stop, rotate the camera, zoom out against the ceiling, approach and
retreat from a wall, then walk out. The requested angle should remain yours;
collision distance still changes where needed to keep the camera indoors.
