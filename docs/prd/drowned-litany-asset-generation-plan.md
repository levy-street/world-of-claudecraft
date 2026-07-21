# Drowned Litany: asset generation plan (Meshy)

Companion to `drowned-litany-redesign.md`'s "Asset generation backlog" section.
This doc is the execution brief for a **separate chat** (the redesign work is
committed and done; this is pure visual polish, no gameplay/sim changes).

Read `src/render/characters/CLAUDE.md` and `src/render/CLAUDE.md` in full before
touching anything here: every mob/NPC visual is a **rigged, animated GLB** run
through `SkeletonUtils` + an `AnimationMixer` (`src/render/characters/visual.ts`).
There is no static-mesh or procedural-rig path for characters. This is the single
biggest constraint on this whole plan: a freshly Meshy-generated mesh is NOT
usable as-is, it needs a compatible rig + the right animation clip names before
`manifest.ts` can reference it.

## Phase 0: free wins first, no Meshy spend

Before generating anything, `src/render/characters/manifest.ts`'s `VISUALS` table
already has GLBs sitting in `public/models/creatures/` that are **loaded by zero
mob/NPC today** (confirmed via `grep -c "<file>.glb" manifest.ts` == 0 for each):

- `velociraptor.glb`, `crabenemy.glb` - unused, either could be a much better fit
  for **Deepfen Spearjaw** (a toothy/aquatic swamp beast) than the current wolf
  fallback, and cost nothing.
- `ghost.glb` - unused, likely a strong fit for **Choir Thrall** (an undead swarm
  add) instead of the generic `skel_minion` skeleton.
- `tribal.glb` - unused, a *possible* fit for **Reedbound Acolyte** or **Edda
  Reedhand** (needs an in-game preview to judge - "tribal" may read as jungle/
  primitive rather than marsh-cultist/lantern-bearer).
- `glubevolved.glb`, `orcenemy.glb`, `bull.glb`, `yeti.glb` - also unused, less
  obviously thematic, worth a 10-second look in case one surprises.

**Do this first:** load each candidate GLB in the browser (e.g. temporarily
point a `VisualDef` at it, or use the character preview turntable in
`src/render/characters/preview.ts`) and screenshot it. Every candidate GLB
already has clip names matching an existing `ClipMap` (they came from the same
KayKit/Quaternius packs as everything else in `manifest.ts`), so wiring up a hit
is a five-line change: a new `VISUALS` entry (`url`, `height`, `clips`, `tint`)
+ a `MOB_KEYS` line. **No rigging, no Meshy cost, no new code pattern.**

Only generate via Meshy for whatever doesn't get a good free match here. Based
on the shapes involved, expect that to be **the Tolling Bell** at minimum (a
rolling bell has no obvious existing-asset stand-in) and possibly Edda Reedhand
if `tribal.glb` doesn't read right for a companion NPC.

## Asset list (priority order, from the redesign doc's backlog)

For each: current state, target size (the `height` field other `VisualDef`s use,
in meters - **match the numbers below so it doesn't tower over or vanish next to
everything else already in this delve**), and the animation clips the rig
actually needs (missing ones degrade gracefully per
`src/render/characters/visual.ts`'s `baseAction()`, so don't over-build - skip
`attack`/`hit`/`death` for anything that never fights).

| # | Mob/NPC | Current fallback | Target height | Reference for scale | Clips needed |
|---|---|---|---|---|---|
| 1 | **Tolling Bell** (`tolling_bell`, boss projectile) | `skel_minion` (skeleton) | ~0.6-0.9m (a hand-bell to church-bell size, it's a thrown/rolling object, not a creature) | smaller than `mob_spider` (1.4m) | idle + one looping "roll/spin/sway" clip only (it's non-combat, `hostile:false`, moved manually by the boss driver every tick - no walk/run/attack/death ever needed) |
| 2 | **Deepfen Spearjaw** | generic wolf (`FAMILY_KEYS.beast`) | ~1.6-2.0m nose-to-tail | between `mob_spider` (1.4) and `mob_troll` (2.4) | idle, walk, run, attack, hit, death (full quadruped/beast set - check Phase 0 first, this is the most likely free win) |
| 3 | **Edda Reedhand** (companion NPC) | generic humanoid (`FAMILY_KEYS.humanoid`) | ~1.7-1.8m (human-scale, matches player character height) | player character height | idle, walk, run, cast/attack (she fights alongside the party), hit, death - full humanoid set |
| 4 | **Reedbound Acolyte** | generic humanoid | ~1.7m | player character height | idle, walk, run, cast (ranged caster per its kit), hit, death |
| 5 | **Choir Thrall** | `skel_minion` (skeleton) | ~1.6m (frail swarm add, slightly smaller than a normal humanoid) | check Phase 0 (`ghost.glb`) first | idle, walk, run, attack, hit, death |
| 6 | **12 new Rite loot item icons** | procedural `itemFallback` | n/a (2D icon, not a 3D asset) | n/a | Not a Meshy job at all - add an `ITEM_RECIPES` entry per item in `src/ui/icons.ts` using the existing vector-primitive recipe system (`r(bg, pal, prims, fx?)`). Free, procedural, no external generation. |

Everything else (Sump Troll Devourer, Mirefen Widowling, Grave-Silt Bulwark,
Drowned Cantor, Sister Nhalia, the room/water/dressing visuals, the Reliquary +
4 shrine props) is already a good reuse or fully custom - not in scope here.

## Style brief for every Meshy generation (per the user's ask)

- **Low poly**, matching the chunky/stylized look of the existing KayKit and
  Quaternius packs already in `public/models/` - not photorealistic, not
  high-frequency surface detail. Roughly the same silhouette-driven, flat-shaded-
  friendly complexity as `spider.glb`/`orc.glb`/`giant.glb`.
- **Size**: use the `height` column above; that's what every other `VisualDef` is
  keyed to (`src/render/characters/visual.ts` normalizes the model to this value
  at load time), so the exact source-mesh scale matters less than getting the
  right real-world proportions to normalize *from* (a bell that's taller than it
  is wide, a quadruped beast, a humanoid biped).
- **Target format**: `glb` (this renderer is Three.js/glTF only). Decide this
  before generating, per the Meshy tool's own rule.
- **Marsh/drowned-litany palette**: muted greens, waterlogged greys/browns, faint
  bioluminescent or bone-pale highlights for undead - consistent with the blue-
  black water and dead-tree dressing already in the room visuals
  (`src/render/props.ts`, `delve_marsh_dressing.ts`). `tint`/`tintStrength` in
  `VisualDef` can also recolor a mesh at runtime (see how `mob_troll`/`mob_ogre`
  use a faint `tint: 'entity'` wash), so the source generation doesn't need to
  nail the final color exactly.

## Map/wall assets: NOT recommended right now

Checked the actual in-game look (`tmp/litany_int_0_sluice.png`, `tmp/litany_int_rite.png`
from this session's screenshots): the rooms use the existing grey-stone KayKit
dungeon kit (`interior: 'cave'`), which reads as a generic-but-reasonable
crypt/reliquary look - it doesn't clash, it just doesn't scream "swamp" on its
own (the water/dead-tree dressing already carries that). Not flagged as broken by
anyone in this project so far. If you look at the screenshots yourself and want a
more distinctly waterlogged/moss-root wall set, that's a legitimate follow-up,
but it's a bigger job (walls are shared dungeon infrastructure, not delve-
specific) - decide after eyeballing the screenshots, don't default into it.

## Execution pipeline once Meshy generation is actually needed

1. Confirm cost with the user before every credit-spending call (per the `meshy`
   MCP server's own rule) - `meshy_text_to_3d` (5-20 credits) is the starting
   point unless there's a reference image; `target_formats: ["glb"]` from the
   first call.
2. `meshy_rig` (5 credits, includes walk+run) then `meshy_animate` (3 credits)
   for anything in rows 2-5 above that needs locomotion. Row 1 (Tolling Bell)
   may not need a skeletal rig at all if a simple idle/spin loop can be done as a
   node-transform animation (see `CHICKEN_COW`'s comment in `manifest.ts`:
   "procedurally authored... Node-transform animations" - i.e. some existing
   rigs in this codebase aren't even skeleton-based, worth matching that
   approach for something as simple as a bell).
3. `meshy_download_model` the result, drop it under `public/models/creatures/`
   (matching the existing folder convention).
4. Inspect the actual animation clip names Meshy produced. They will NOT match
   an existing `ClipMap` (KayKit/Quaternius naming is asset-pack-specific) -
   either rename the clips to match an existing `ClipMap` (`BIPED14`/`ENEMY7`/
   `animal`/`FLOATING`) if the count and rough motion match, or write a small new
   `ClipMap` factory following the existing pattern (`manifest.ts` lines ~130-213)
   if they don't.
5. Add a `VisualDef` to `VISUALS`, wire it into `MOB_KEYS` (or `NPC_KEYS` for
   Edda), per `src/render/characters/CLAUDE.md`'s "Adding things" section.
6. `npm run dev` and look at it in-game before moving to the next asset - this
   is exactly the kind of change that needs eyes-on verification, not just a
   green test suite (there is no automated test for "does this mesh look right").
7. Only for a final production build: `node scripts/build_media_manifest.mjs
   generate` (not needed for local `npm run dev` iteration).

## What the new chat needs to know that isn't repeated here

- The gameplay/sim work (7 room redesign, Tolling Bells mechanic, Drowned
  Reliquary Rite finale, i18n) is DONE and committed on `feature/drowned-litany`
  (commits through `8bd7bbb8`). This plan is pure visual asset work on top of
  that - no sim/test changes expected, only `public/models/`,
  `src/render/characters/manifest.ts`, and `src/ui/icons.ts`.
- Nothing here is committed yet (this doc itself will be committed once written,
  but the actual asset work starts fresh). Don't re-run the QA/architecture
  review agents for this - it's a render-only, non-sim change; a visual check
  in-browser is the actual acceptance test.
