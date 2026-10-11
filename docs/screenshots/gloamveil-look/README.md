# Gloamveil look (the Shadow priest's form)

Before and after captures of the Shadow priest's form on the v0.45 player bodies.

- BEFORE: the integration head the branch is based on, where the old face veil (sized for the
  previous head) draws as a black ball floating over the new body and the whole body is tinted
  violet.
- AFTER: this branch. The dark climbs the legs, a living pool lies under the feet, dark smoke
  curls off the lower body and the halo turns violet. No veil.

Same spot, same camera, same time of day (noon), offline client, captured with
`scripts/gloamveil_look_shot.mjs` on a real GPU backend, about twenty seconds after world entry
so the client's background shader work has settled. Each still is read off the game canvas in
the frame that drew it, at an offset measured on the page clock.

| Moment | Before | After |
|---|---|---|
| Entry, 0.33 s after the shift (preset 4) | `before-world-entry.png` | `after-world-entry.png` |
| Standing, 5.2 s after the shift (preset 4) | `before-world-standing.png` | `after-world-standing.png` |
| Casting, 0.9 s into a Mind Blast cast (preset 4) | `before-world-casting.png` | `after-world-casting.png` |
| Walking, 1.5 s into a run (preset 4) | `before-world-walking.png` | `after-world-walking.png` |
| Standing on the lowest preset (preset 1) | `before-low-standing.png` | `after-low-standing.png` |
| Standing inside a dungeon instance, the Hollow Crypt (preset 4) | `before-dungeon-standing.png` | `after-dungeon-standing.png` |
| Standing in a paladin's Holy Ground, 2.5 s after it lands (preset 4) | `before-overlap-consecration.png` | `after-overlap-consecration.png` |

Notes for a reviewer:

- `after-world-entry.png` is the entry: the whole body dark inside the smoke column while the
  pool erupts and the ring races out, all on one clock. The form shows on the frame of the
  shift on any client; on one that is still linking shaders the body wears stand-in materials
  for the first fraction of a second, which read a touch lighter under sun shafts.
- The lowest preset keeps the dark legs, the violet halo, the pool and a thin smoke. It sheds
  the haze, the bubbles and the wake (`docs/design/graphics-settings-fairness.md`).
- The dungeon instance sits about a hundred thousand yards from the world origin. The pool is
  positioned camera-relative and does not flicker against the floor there.
- `after-overlap-consecration.png` is the fairness case. The pool is near-black and nearly
  opaque, so it draws UNDER every ground effect a player casts and every encounter telegraph
  (`docs/design/vfx-floor-layering.md`): the Holy Ground's wash and lines stay readable right
  through the priest's feet, where the pool only shows as a faint dark star under the light. On
  plain ground (every other still here) nothing is over it and it reads at full strength.
