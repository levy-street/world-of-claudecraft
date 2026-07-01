# The Drowned Litany: room + boss redesign

Status board (update as stages land). Each stage ends at a committable, green state
so we always have a clean saving point. If we stop mid-stage, the "Resume" note for
that stage is the handoff.

| Stage | Scope | Status |
|---|---|---|
| 0 | Entrance recolor (blue water portal) | DONE (uncommitted, see note) |
| 1 | Room layouts + shallow/deep water tiers + jump-dodge | DONE (commit, see board) |
| 2 | Render: shallow/deep visuals + marsh dead-tree/plank assets | DONE (commit, see board) |
| 3 | Boss: Tolling Bells line projectiles + knockback | DONE (commit, see board) |
| 4 | Verify pass: guard tests, tsc, i18n S3, biome | DONE (commit, see board) |

All four stages landed. Guard gate at completion: tsc clean (outside 3 pre-existing
tests/browser errors), 160 passed / 1 pre-existing fail (world_api/chat.ts, unrelated)
/ 3 skipped, biome formatted on changed files. Pre-existing issue to hand back to the
user: src/world_api/chat.ts value-imports OVERHEAD_EMOTE_IDS from sim (architecture
guard fail) - predates this work, not fixed here.

Known follow-up: the Tolling Bell renders as a generic mob mesh (Stage 3 was sim-only);
a custom rolling-bell visual + telegraph-lane decal is a nice-to-have render pass.

## Asset generation backlog (nice-to-have, none blocking release)

Everything below currently renders via a generic fallback (family model or the
procedural item-icon fallback) and functions correctly; none of this blocks release.
Priority order if picked up:

1. **Tolling Bell** (`src/sim/content/delves/mobs.ts` `tolling_bell`, `family: 'undead'`)
   - Renders as `skel_minion` (a generic skeleton) via the undead family fallback in
     `src/render/characters/manifest.ts` (`FAMILY_KEYS.undead`) - no dedicated `MOB_KEYS`
     entry. A rolling bell projectile currently looks like a skeleton. HIGHEST priority:
     the visual mismatch is the most jarring of this list.
   - Asset need: a small bell/orb-shaped rolling mesh (GLB) registered in `MOB_KEYS`, or a
     purely procedural geometry builder in `src/render/props.ts` if a full model feels
     like overkill for a short-lived projectile.
2. **Deepfen Spearjaw** (`mirefen` marsh mob, `family: 'beast'`)
   - No `MOB_KEYS` entry -> falls back to the generic wolf beast model. A swamp
     "spearjaw" reads as more aquatic/reptilian than wolf-shaped.
3. **Edda Reedhand** (the delve companion NPC, `family: 'humanoid'`)
   - No `MOB_KEYS` entry -> generic humanoid fallback. She's a recurring ally the
     player sees for the whole run, unlike a one-off trash mob, so a distinct look
     (lantern, reeds) pays off more than most of this list.
4. **Reedbound Acolyte** (`family: 'humanoid'`) - generic humanoid fallback; lower
   priority than Edda since it's disposable trash.
5. **Choir Thrall** (`family: 'undead'`) - same `skel_minion` fallback as the Tolling
   Bell; thematically passable (an undead swarm add) so lowest priority of the mob list.
6. **12 new Reliquary Rite loot items** (`src/sim/content/delves/items.ts`, e.g.
   `siltguard_helm`, `nhalias_bell_maul`, `blackwater_vanguard_chest`...) have no
   `ITEM_RECIPES` entry in `src/ui/icons.ts`; they render via the procedural
   `itemFallback` (works, generic slot/school icon). Bespoke recipes are pure polish.

Reused-and-fine, no action needed: Sump Troll Devourer -> `mob_troll` (literal name
match), Mirefen Widowling -> `mob_spider` (spider/widow theme fits), Grave-Silt Bulwark
-> `mob_ogre` (hulking-brute silhouette fits), Drowned Cantor -> `delve_mob_acolyte`,
Sister Nhalia -> `mob_dark_caster` (shared with every other dark-caster boss, already
the established convention for humanoid casters in this codebase).
The room/water/dressing visuals (blue entrance, shallow/deep water materials, dead
trees, the Reliquary + 4 shrine props) are already fully custom and procedural
(`src/render/props.ts`, `delve_marsh_dressing.ts`, `delve_props.ts`) - nothing to
generate there.

Generating a 3D model needs the `meshy` MCP tools (text-to-3d costs 5-20 credits per
generation, confirm cost before running); a mob needs its GLB registered in
`src/render/dungeon.ts` `KIT_MODELS`/preloads and wired into `manifest.ts` `MOB_KEYS`.
An icon just needs a new `ITEM_RECIPES` entry in `src/ui/icons.ts` (no external
generation, procedural, free).

Full execution brief for picking this up (sizes, clip requirements, a Phase 0
free-reuse check before spending any Meshy credits): see
`drowned-litany-asset-generation-plan.md` in this same directory.

Post-Stage-4 manual verification (in-game, via new scripts/drowned_litany_shots.mjs and
scripts/drowned_litany_boss_shot.mjs): screenshotted all 7 rooms (size curve and
shallow/deep water tiers visually confirmed) and drove a live Tolling Bells volley.
Found and fixed a real bug this way (commit 78341724): spawnBellEntity and the
knockback altarPos both used the room-local ALTAR_X directly instead of
run.origin.x + ALTAR_X (every other spawn site in this delve adds run.origin.x).
Drowned Litany's world-X origin is a large nonzero constant, so bells were spawning
thousands of yards from the fight and the knockback direction was nonsensical before
the fix. This is why running the actual game, not just unit tests, was worth doing.

Stage 0 note: `src/render/props.ts` already recolors the Drowned Litany entrance to a
blue "water" palette (portal shader `uRim` uniform, `drownVeilMaterial` red->blue veil
recolor, blue backsplash/mouth-light/embers) and `src/sim/content/zone3.ts` registers
its `delveMarkers` entry. Not yet committed.

---

## Design summary (agreed with the user)

Goal: the current 7 rooms all read as the same rectangular box with one central pool.
Redesign for (a) genuine shape variety, (b) a deliberate tight->huge size curve,
(c) deep water that makes you think where you step but stays completable, (d) a
jump-to-dodge interaction, (e) distinct shallow vs deep water, (f) a unique boss
mechanic (Tolling Bells).

Completability rule: every room is clearable. 3 rooms have a fully dry route
(Baptistry, Choir Loft, Apse). 4 rooms force short deep crossings you hop with the
jump (Sluice, Ledger, Causeway) or offer an optional risky shortcut (Ring).

Water tiers:
- shallow = light telegraph margin, little/no damage, safe-ish to clip.
- deep = the real drowning damage (~2x the base Blackwater tick), but a 1-2s ford is
  survivable; lingering drowns you.

Jump-dodge: the jump already exists (`Entity.jumping`/`vy`, apex ~1.1yd, ~0.7s
airborne at run speed ~= 5yd horizontal). No raised platforms are added (the delve
floor is a single flat plane; variable floor height would be a sim-core rewrite we are
NOT doing). Instead: deep water's per-tick damage SKIPS airborne players, so a well
timed jump across a short deep gap (stepping-stone to stepping-stone) avoids the tick.

---

## Coordinate spec for the 7 rooms (Stage 1)

Conventions: room is centered on x=0; entry at the bottom (low z), exit/dais at the top
(high z). `hw` = side-wall half width (so room spans x in [-hw, hw]); `z0`/`z1` =
zMin/zMax. Pools are `[x, z, rx, rz]` (a circle when rx==rz). Islands/platforms are
`[x, z, hw, hd]` (visual dry stone; NOT colliders). Dead trees are `[x, z]` (colliders
+ a `dead_tree` dressing anchor). These map onto `LitanyModuleGeometry` like so:
- deep pools -> `hazards` with `tier:'deep'`
- shallow pools -> `hazards` with `tier:'shallow'`
- islands/platforms -> `islands` (kept walkable/visual, no collider)
- dead trees -> `pillars` (collider) AND a `dead_tree` dressing anchor
- dais/exit per room as noted

### 1. Sluice  (TIGHT)  hw 14, z0 -12, z1 62
shallow: [-2,26,13,22]
deep:    [-2,26,10,18], [5,48,7,7]
islands: [0,-9,5,3], [9,5,3,3], [11,22,3,3], [8,40,3,3], [2,54,4,3], [0,59,4,3]
trees:   [-9,16], [-7,36], [5,30], [-3,50]
dais: [0,59,5]   (exit pad; trash room)
note: single S-curve of stepping stones hugging the right wall; 2 deep gaps you jump
(stone 9,5 -> 11,22 and stone 8,40 -> 2,54).

### 2. Ledger  (MEDIUM)  hw 22, z0 -14, z1 86
shallow: [0,40,21,32]
deep:    [0,40,18,28]
islands: [0,-11,5,3], [-12,8,4,3], [-6,24,4,3], [3,40,4,4], [9,56,4,3], [2,72,4,3], [0,82,5,3]
trees:   [16,30], [-16,42], [15,62], [-15,16]
dais: [0,82,6]
note: archipelago; 3 deep hops between islands.

### 3. Ring  (LARGE)  hw 25, z0 -16, z1 90
shallow: [0,40,18,31]
deep:    [0,40,15,27]
islands (dry perimeter): [-20,4,4,5], [-21,26,4,11], [-21,52,4,11], [-16,72,4,5],
        [20,4,4,5], [21,26,4,11], [21,52,4,11], [16,72,4,5], [0,-13,5,3], [0,82,6,4]
islands (optional shortcut stones across the lake): [0,20,3,3], [0,40,3,3], [0,60,3,3]
trees:   [-8,40], [8,40]
dais: [0,82,6]
note: dry lap around the edge; the 3 center stones are an optional 2-jump shortcut
straight across the deep lake.

### 4. Baptistry  (MEDIUM-TIGHT, fully dry)  hw 18, z0 -12, z1 72
shallow: [0,40,16,16], [-14,22,7,7], [14,24,7,7]
deep:    [0,40,12,12]
islands: [0,-9,5,3], [15,9,4,4], [16,34,4,5], [12,56,4,4], [0,64,6,4]
trees(posts): [8,34], [-8,34], [8,46], [-8,46]
dais: [0,64,6]
note: dry route hugs the right wall; the central sinkhole sits to your left.

### 5. Choir Loft  (WIDE/LARGE, fully dry)  hw 25, z0 -12, z1 84
shallow: [-14,32,8,20], [0,42,7,18], [14,32,8,20]
deep:    [-14,32,6,17], [0,42,5,15], [14,32,6,17]
islands: [0,-9,4,3], [-7,8,4,3], [-20,28,4,6], [-14,54,4,5], [0,74,6,4],
        [7,8,3,6], [20,28,4,6], [14,54,4,5]
trees:   [-20,48], [20,48], [-12,18], [12,18]
dais: [0,74,6]
note: braided delta with parallel dry lanes (left lane is the reference dry route).

### 6. Causeway  (TIGHT/LONG)  hw 15, z0 -14, z1 92
shallow: [-12,40,9,41], [12,40,9,41]
deep:    [-12,40,7,38], [12,40,7,38], [0,22,4,4], [0,50,4,4], [0,72,4,4]
islands(spine + stepstones): [0,-9,4,4], [0,9,3,5], [0,22,2,2], [0,35,3,5],
        [0,50,2,2], [0,61,3,5], [0,72,2,2], [0,82,4,4]
trees(flanks): [-10,16], [10,30], [-10,52], [10,64], [-8,82]
dais: [0,82,4]
note: the gauntlet; one central spine broken by 3 deep fords, each with a tiny
stepping stone to jump onto. Deep water on both flanks the whole way.

### 7. Apse  (BOSS/LARGE)  hw 25, z0 -16, z1 92
shallow: [0,56,24,17]
deep:    [0,56,21,14], [-12,22,6,6], [12,26,6,6]
islands: [0,-13,5,3], [-12,6,5,4], [12,8,5,4], [-10,30,4,4], [10,32,4,4],
        [0,44,5,4], [0,58,3,8] (plank causeway bridging the moat), [0,72,11,11] (altar)
trees:   [-18,52], [18,54]
pillars: [-16,12], [16,14], [-16,26], [16,28]
dais: [0,72,12]  (boss altar; safe core)
note: raised altar ringed by a deep moat; a plank causeway (island at 0,58) bridges it
dry. Tolling Bells push you off the altar toward the moat.

---

## Stage 1 implementation (sim only; no render)

Files: `src/sim/delve_litany_layout.ts`, `src/sim/types.ts`,
`src/sim/delves/runs.ts`, plus tests.

1. Per-room size: `litanyRoom` currently hardcodes wallX/zMin/zMax from
   `LITANY_WALL_X`/`LITANY_Z_MIN`/`LITANY_Z_MAX`. Extend `LitanyRoomDef` to accept
   optional `wallX`/`zMin`/`zMax` overrides (default to the constants). Each room above
   sets its own. Verify `shellColliders` (side walls at +/-wallX, end walls at
   zMin/zMax) and `litanyModuleLayout` (renderer bridge) already read `geo.wallX/zMin/
   zMax` -> they do, so size propagates to collision AND the renderer interior.
   `LITANY_SIDE_Z`/`LITANY_SIDE_HD` are shared constants used for the side-wall OBB
   center/half-depth; if a room is much shorter, recompute side-wall z/hd from its own
   zMin/zMax instead of the constants so walls span the actual room.

2. Water tier:
   - `LitanyHazardZone`: add `tier?: 'shallow' | 'deep'` (default `'deep'`).
   - `DelveHazardZone` (types.ts ~1902): add `tier?: 'shallow' | 'deep'`.
   - `litanyModuleHazards` must pass `tier` through (currently strips to x/z/r).
   - `tickDelveBlackwater` (runs.ts ~1079): for each standing player, find the
     worst-tier zone they are in. shallow -> light pct (e.g. base * 0.35, or 0 if we
     want shallow purely cosmetic; use base * 0.35). deep -> base * 2.0. Keep the
     existing high_water affix multiplier. Apply only the worst zone (do not stack
     shallow+deep).
   - Airborne skip: a player who is airborne (jumping / `pos.y` meaningfully above the
     flat delve floor, see how `onGround` is set in sim.ts move) takes NO water tick.
     Add the check at the top of the per-player loop.

3. Re-point each room's hazards/islands/pillars/dais to the coordinate spec above.
   Add a `dead_tree` kind to `LitanyDressingAnchor` (render handles it in Stage 2; the
   sim only authors the anchor + the collider pillar).

Acceptance (Stage 1, must be green before commit):
- `npx tsc --noEmit` clean for changed files (the 3 pre-existing tests/browser errors
  are unrelated and expected).
- `npx vitest run tests/architecture.test.ts` green (sim purity + determinism).
- Any collider/delve test that references litany geometry still green; update expected
  values where the geometry legitimately changed.
- `npx vitest run tests/localization_fixes.test.ts` green if any player string touched.
Commit: `feat(delves): redesign Drowned Litany rooms with shallow/deep water + jump-dodge`

Resume note (if interrupted mid-Stage-1): the coordinate spec above is the source of
truth; finish transcribing remaining rooms, then run the acceptance checks.

---

## Stage 2 implementation (render)

Files: `src/render/delve_marsh_dressing.ts`, `src/render/dungeon.ts`,
`src/render/delve_marsh_dressing.ts` water pools, render asset list.
- Draw shallow vs deep pools with distinct materials (shallow = lighter translucent
  teal; deep = dark near-opaque navy). The hazard zones now carry `tier`.
- Wire marsh assets: add `tree_dead_*` / `trunk_*` GLBs (already in
  `public/models/dungeon/` and `public/models/foliage/`) to the dungeon kit load list,
  and render a `dead_tree` dressing anchor + denser plank bridges.
Acceptance: dev build renders; manual look at each module; no console errors.
Commit: `feat(render): shallow/deep Blackwater + marsh dead-tree dressing`

---

## Stage 3 implementation (Tolling Bells boss)

Files: `src/sim/delves/drowned_litany_boss.ts`, `src/sim/types.ts`
(`DrownedLitanyBossState`), `src/net/online.ts` (ClientWorld parity if a new entity),
render mesh for the rolling bell, i18n keys for new log lines.
Mechanic: every ~10-12s Nhalia tolls a volley (2 normal / 3 heroic). Each bell flashes
a straight telegraph lane ~1.2s, then a replicated bell entity rolls down the lane at a
dodgeable speed (~8 yd/s) and expires at the moat. Contact: ~12% maxHp + knockback
directed radially outward from the altar center (pushes toward the moat). Interleave
with the existing markTimer/Cantor/Final Bell logic. Server-authoritative + seeded.
Decision needed at build time: represent the bell as a `mob` entity (no AI, untargetable,
moved by the driver, replicates via normal snapshot) vs a new replicated hazard list.
Recommended: a minimal non-attackable `mob` template moved each tick by the driver, so
it reuses existing entity replication and render.
Acceptance: vitest for the boss tick (bell spawns, moves, damages, knocks back,
expires); architecture + parity tests green.
Commit: `feat(delves): Tolling Bells dodge mechanic for Sister Nhalia`

---

## Stage 4 verify
- Re-render the minimap FROM the real sim data (a small script reading
  `litanyModuleMapPrimitives`) to confirm in-game geometry matches the proposal.
- Full `npm test` (or at least architecture, sim, progression, localization_fixes).
- `npx tsc --noEmit`, biome on changed files only.
- `npm run wiki:content` if any player-facing content names changed.
