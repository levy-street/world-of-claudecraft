# Composed player portraits

Before/after captures for the change that draws a player's composed (authored) face in
every frame that holds a player, not only the player's own frame. Captured by the
change-aware rig (`scripts/pr_screenshots.mjs`, target `composed-player-portraits` in
`scripts/pr_shot_targets.mjs`) on the lowest graphics preset, desktop viewport, offline
world, with a deliberately distinctive seeded look (female body, dark skin, violet hair)
so the composed face and the stock warrior headshot cannot be mistaken for each other.

- `before-frames-desktop.png` / `after-frames-desktop.png`: the player frame (left), the
  target frame with the player self-targeted (right), and the player menu's title chip
  above them. Before, only the player frame showed the authored face; the target frame
  and the chip drew the stock class art.
- `before-inspect-desktop.png` / `after-inspect-desktop.png`: the Inspect card's turntable
  for the same player. Before, it mounted the stock class rig.

Recapture:

```
BROWSER_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe" GAME_URL=http://localhost:5173 \
  DIFF_FILE=<diff naming src/ui/player_portrait_core.ts> SHOTS_DIR=pr-shots \
  node scripts/pr_screenshots.mjs
```

The before side runs the same command against a dev server serving the base commit.
