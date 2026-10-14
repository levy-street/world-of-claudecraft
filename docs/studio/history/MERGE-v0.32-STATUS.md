# v0.32.0 merge, COMPLETE (branch `merge/v0.32.0`)

**This branch builds and runs.** Every conflict is resolved; `npx tsc --noEmit`
is clean and `npx vite build` is green across all five entries.

- Merged: `upstream/main` @ `a3e5e9596`, the commit issue
  [#2544](https://github.com/levy-street/world-of-claudecraft/issues/2544) cuts
  v0.32.0 from. It carries the **real** v0.31.0 release (PR #2536), which the
  previous merge missed: `merge/v0.31.0` took `origin/main` at `68cfd209a`,
  a pre-release commit.
- Merge base: `68cfd209a`
- Backups: tag `backup/pre-v0.32-2026-07-29`, directory
  `~/Documents/woc-map-editor-backup-2026-07-29-pre-v0.32`

## The rule this merge followed

Same as v0.31: keep **every** fork feature while taking upstream's new work.
Where a hunk had content on both sides, both sides were kept rather than one
picked. 27 conflicts (v0.31 had 110).

## Verification

| gate | result |
|---|---|
| `npx tsc --noEmit` | clean (0 errors) |
| `npx vite build` | green: game, admin, play, guide, editor |
| editor acceptance suite | **82 of 84 files, 811 of 814 tests**, the v0.31 baseline exactly |
| full suite | 90 failing files, vs **89 on the pre-merge branch** |
| parity goldens | 61 failed / 169 passed, **identical to pre-merge** |

The editor suite's only failures are the two long-known baseline suites:
`tests/cave_under_terrain_movement.test.ts` (1) and `tests/minimap_markers.test.ts` (2).

## The headline upstream change: the parkour physics engine (#2527)

v0.32 replaces open-world player movement with a swept-collision solver
(`src/sim/physics/`), adds standable prop tops (`moveTopY`/`standable`/
`topSlope`), the mantle assist, and the ledge climb. This is the deep half of
the merge, because it lands exactly on top of this fork's collision doctrine.

### How the two collision models were reconciled

- **Three orthogonal bypass bands, not one.** Upstream gates on `moveTopY`
  (pass OVER a low prop). This fork gates on `baseY` (pass UNDER a collider , 
  cave tubes) and `hiY` (pass THROUGH a step band, baked per-asset boxes).
  All three now run, in `resolveAgainst` and in the new solver's `blocksAt`.
- **`PrismCollider` taught to the new engine.** Collision Master volumes are
  convex outlines with no `rot`/`hw`/`hd`, which upstream's solver assumes. The
  exact outline still governs depenetration (`pushOutPrism`) and standing
  (`insidePrism`); a new `prismBox()` gives the *swept* paths a conservative
  OBB proxy. Prisms also gained `moveTopY`/`standable`, so an authored deck
  (a second storey, a ramp landing) now CARRIES a body rather than only
  blocking it.
- **Lazy decoration cells kept.** Upstream's grid is eager and dedupes with a
  `Uint32Array` indexed by `gridIndex`. This fork generates the decoration
  field one queried cell at a time (a cold Sim must not enumerate a
  continent-sized custom map). Both survive: packed integer cell keys and stamp
  dedupe from upstream, lazy `decorationCells`/`combinedCells` from the fork,
  with `claimGridIndex()` growing the stamp buffer as cells are built. A
  `decorationPool` keyed by world position returns ONE collider object per
  decoration, so a boundary-straddling rock cannot be depenetrated twice.
- **`floorHeightAt` reads `groundHeightNear`.** Collision Master planes, baked
  box tops, ramp decks and cave sheets are walkable floor in this fork, so the
  solver settles bodies on them. It is the base rather than a `max()` term
  because a cave sheet can sit BELOW the surface.
- **The terrain wall gate gained the fork's exemptions**: authored decks
  (`authoredStep`, reach `STEP_OVER_Y`, using the solver's wider `stepHeight`
  hands jump-spammers a ladder up the world rim), cave sheets, and
  `caveMouthStepOk` so a player is not walled inside their own tunnel.
- **Sealed borders and Great Maze hedges restored.** Moving the open world off
  `resolveMovement` silently dropped `crossesSealedBorder` and
  `crossesGardenHedge`, neither is terrain nor a collider, so the swept solver
  cannot see them. Both are now applied in `moveCharacter`. Without this a
  swimmer (never terrain-gated, by design in both engines) could round the
  world rim.

### Other notable resolutions

- **`layoutColliders` returns `LayoutCollider[]`**, not upstream's `Collider[]`:
  room plans are hand-authored rectangles and circles, and only Collision
  Master emits prisms. This one type fixed ~60 downstream errors.
- **Interior sets went lazy** (upstream's per-dungeon tomb dressing), and
  `INFERNAL_ABYSS_LAYOUT` was registered in `INTERIOR_LAYOUTS` so the fork's
  Abyss resolves its own walls instead of falling back to a crypt.
- **The Sowfield authored-map gate survived** on `valeCupColliders()`, and the
  matching gate on the grandstand lift in `groundHeight`, while taking
  upstream's `dungeonFloorLift` (the raised boss dais).
- **Ravenrift's `barriers`** are still built in `layoutColliders`; upstream's
  `authoredColliders` does not know about them.
- **`addItemSilent`** took upstream's version outright: its `addStacked` now
  deep-clones payloads, keeps charge-bearing items one-per-slot, and carries
  crafted provenance, strictly better than the fork's manual push.
- Upstream's eager `generateDecorations` collider loop was NOT taken (this fork
  builds it per cell); every other collider upstream added in that block , 
  graveyards, town props, stall dressing, mine carts, banker strongboxes, was.

## Known-red after the merge (3 files, all triaged)

Two are upstream tests hard-coded to **upstream's terrain**, which this fork
replaced. Neither indicates a code defect:

- `tests/physics_audit_zonewalls.test.ts`, probes a zone ridge at
  `x=40, z≈180` with a road pass at `x=0±10`. This fork's terrain there is a
  gentle 8.7 → 10.9 → 8.1 hump over 35yd: there is no wall to fail to cross.
- `tests/physics_character.test.ts` (2), `findSteepFace()` scans
  `x ∈ [-130,-184], z ∈ [-60,200]` for a >1.8yd rise and finds none in this
  fork's remapped west band, so the fixture is `undefined`.

One is a **real balance change and needs your call, not a test edit**:

- `tests/chronomancy_balance.test.ts`, the conservative offensive rotation now
  OOMs at **64.4s against a 68 to 82s window**. Upstream `ac3710b17` added the
  Chronomancer barrier to Overflowing Power's cooldown set and kept the window;
  on this fork's numbers it lands ~5% short. Deliberately left failing rather
  than widening the window, because it is a gameplay tuning question.

## Tests updated on purpose (not silently relaxed)

- `climb_slope` rim gate, scoped to the surveyed z corridor, plus a NEW
  assertion that the crest height is never reached. The swept solver slides
  along a face far better than the old resolver, so over 60s of jump-spam the
  player works ~25yd down the rim to a z where the border is open water. It
  leaves the corridor; it never climbs the wall (peak 11.48 vs crest 14.30).
- `player_motion` wedge-escape gate, asserts "moved off the pin, toward the
  standoff, without overshoot" instead of the exact iterated yardage. The
  solver now depenetrates the body itself, so a tick commits part of the
  modelled push. The invariant the test exists for (a concave pocket is
  escapable at all) holds.
- `delves` save migration, 1yd → 2yd, because v0.32 makes the delve arch a
  solid collider, so the ejection resolves clear of it.
- `mob_component_tags` / `gathering`, `glasscarab` (Scorching Wastes) is
  claw-only by design and joins `fen_troll` on the deliberately-unharvestable
  list; the harvestable/untagged count pins were re-derived from this fork's
  roster (28/212, upstream ships 17/101).

## Re-running the gates

```bash
npx vitest run $(ls tests | grep -iE 'editor|city|collision|cave|decal|rock|fluid|terrain|biome|dungeon_draft|marker|foliage|minimap' | sed 's|^|tests/|' | tr '\n' ' ')
```

`npm run build` still fails at `wiki:content` for the pre-existing reason (fork
zones missing from the wiki material table), use `npx vite build` directly.
