# Nythraxis playtest tuning: color comparison

Captured on 7 September 2026 with the `nythraxis-hazards` target in
`scripts/pr_shot_targets.mjs`.

| Capture | Source |
| --- | --- |
| Before | Original PR head `890f8282a10cba5caf1a9de0f5c0dc664813f41c` |
| After | Tuning head `7ac4d70a2f` |

Both legs use the same staged offline Heroic raid, LOW graphics preset and camera.
Desktop is 1600x900. Mobile emulates an 844x390 touch viewport at 2x resolution.
The images show Grave Flame changing from green to purple and Soulfire from red
to purple. Soul Rend retains its red solo and green stacked markers, and the
friendly Binding Sigil keeps its pale blue cue.

The target creates the real practice raid, freezes simulation ticks, and supplies
fixed ground readouts plus three Soul Rend marks. Tutorial, greeting and loot
panels are dismissed after entry; the world-loading wait remains active. Fixed
lifetimes and the staged sigil footprint are visual fixtures. These images do not
measure encounter balance, expiry timing, full spell-animation sequences or frame
rate. The Gravefire line is viewed nearly end-on, so its shape is poorly exposed.

To select this target with the shared screenshot runner, run a local dev server
and prepare a diff limited to the changed grave-fire palette:

```sh
git diff 890f8282a10cba5caf1a9de0f5c0dc664813f41c HEAD -- src/render/nythraxis_grave_core.ts > /tmp/nythraxis-colors.diff
GAME_URL=http://localhost:5173 DIFF_FILE=/tmp/nythraxis-colors.diff SHOTS_DIR=/tmp/nythraxis-shots node scripts/pr_screenshots.mjs
```

This host's capture used a temporary wrapper around the same shipping target and
`enterOfflineGame` helper: navigation waited for `domcontentloaded` because local
API polling did not settle, and the wrapper seeded build-metadata globals after
the dev entrypoint raised `__APP_VERSION__ is not defined` on both legs. Neither
workaround changed the game sources or shared runner. The temporary wrapper and
local capture servers were removed or stopped after capture.
