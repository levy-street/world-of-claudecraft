# Fenbridge town quality bar

Status: living handoff for the remaining quality rebuilds.

This document freezes what "beautiful and performant enough" means for every
Fenbridge town asset after the Crooked Reed Inn polish pass. Use it as the
acceptance checklist for each remaining building and prop. The master plan
(`master-plan.md`) still owns gameplay locks, site plan, and hard wave ceilings.
This file owns craft standards, shared recipes, and the per-asset rebuild queue.

Eastbrook is the process base (procedural Three.js factory, Meshopt GLB, shared
surface maps, exterior shells, `IWorld` placement). It is **not** the quality
ceiling. Concept art plus the inn reference are the quality floor for every
remaining model.

## Full rewrite rule (every asset)

**Do not polish, patch, or extend a first-pass kit factory.** Every Fenbridge town
asset is a ground-up exterior reconstruction from the admitted turnaround crops
and detail inventory. The early kit pass (`addFoundation` + `addTimberShell` +
floating roof trim + mass helpers) exists only as temporary placeholders until
that asset's turn. When an asset's turn starts:

1. **Delete the old factory body** for that asset (and any first-pass mass helpers
   only that body called). Do not leave half-migrated kit calls.
2. **Ignore old studio previews and shipping GLBs as visual targets.** They are
   discardable placeholders. Open the concept turnaround + zone crops only.
3. **Write a new exterior factory** in the inn style: identity inventory header,
   raised structure, continuous seated roof, open service apron, concept clutter.
4. **Full export + re-pin** replaces the old GLB completely. Do not mix old and
   new geometry in one asset.
5. Shared primitives (`addBox`, `addBentConceptRoof`, `addBarrel`, plank faces,
   doors, windows) are allowed. Reusing a kit **composition** (`addTimberShell`
   + `addBentRoofTrim` + `addRoofStructure` as the whole building) is not.

This rule applies to **all 14** assets, not only hero buildings. Props get the
same clean-slate treatment when their turn arrives.

## Quality reference asset

**Asset:** Crooked Reed Inn (`crooked_reed_inn`)

| Metric | Shipping value | Contract ceiling |
| --- | ---: | ---: |
| Optimized triangles | `7,869` | `9,500` |
| Optimized bytes | `133,476` (`~130 KiB`) | `420 KiB` |
| Primitives | `1` opaque + `1` emissive | merge to at most those two |
| Front-entry socket | local `x = -2.8` | pin must not move without layout review |

Evidence paths:

- Factory: `scripts/assets/fenbridge_town/buildings_service.js` (`buildCrookedReedInn`)
- Shared roof recipe: `scripts/assets/fenbridge_town/shared.js` (`addBentConceptRoof`)
- Studio previews: `tmp/fenbridge_town_preview/crooked_reed_inn/optimized/`
- Turnaround reference: `docs/design/fenbridge-rebuild/references/crooked-reed-inn-turnaround.png`
- Intake: `docs/design/fenbridge-rebuild/img2threejs/crooked-reed-inn/`
- Surface atlas source: `docs/design/fenbridge-rebuild/materials/fenbridge-surface-atlas-source.png`

The inn is the first asset whose factory was rebuilt detail-first from the
admitted turnaround crops (front, side, rear, hero) rather than from the earlier
generic timber-shell kit alone. Remaining buildings should follow the same
depth, not copy the inn's footprint.

## What "ship quality" means (checklist)

Every quality rebuild must satisfy all of the following before it is called done.

### 1. Exterior-only shell

- No walk-in interiors, no furniture behind doors, no hidden backface rooms.
- Closed wall mass is a thin exterior shell (solid box + plank faces), not a room volume.
- Open service structures (tannery awning, provision counter, porch, cistern canopy)
  are exterior scenery only.

### 2. Continuous seated roofs (not floating planes)

- Roof eave Y seats on a wall plate / timber top rail.
- Prefer `addBentConceptRoof` (or a sibling continuous-slope helper) over stacked
  floating boxes when the concept shows a continuous shingle surface.
- Gable ends need closed triangles **plus** bargeboards and horizontal battens so
  side views are not a blank teal triangle.
- Shingle courses sit **on** the continuous slope with a small lift only.
- Ridge beams follow the bent ridge profile.
- Eave fascia boards lock the roof edge to the wall.

### 3. Open readable service aprons

- Gameplay front-entry socket stays clear. No full-height diagonals, X-bracing, or
  plank cages that block the door bay from the player approach.
- Porch / apron posts stay sparse: enough structure to read as a frame, not a wood wall.
- Service counters (provision, teller, herb, tannery station) keep a clear player side
  and NPC side.
- Steps and approach stones align to the socket, not to an arbitrary facade center.

### 4. Concept identity inventory (detail-first)

Before rewriting a factory, re-open the asset's turnaround and inventory:

1. Silhouette and proportions (height of stilts, roof bend, chimney side, balcony).
2. Material families (teal shingle, dark timber, moss stone, iron, brass, rope).
3. Focal service cues from `FENBRIDGE_TOWN_CONTRACTS[id].serviceCues`.
4. Exterior clutter clusters (barrels, crates, nets, lanterns) that belong to the
   concept, kept at corners and off the approach lane.
5. Omit: readable text, franchise symbols, interiors, characters, tiny produce.

Use the existing `img2threejs` package under
`docs/design/fenbridge-rebuild/img2threejs/<asset>/` as intake evidence. Do not
regenerate intake unless the reference changes.

### 5. Surface and materials

- Semantic vertex colors from `FENBRIDGE_PALETTE` remain the authority without maps.
- Shared `512 x 512` WebP triad multiplies those colors at runtime:
  - `public/textures/fenbridge_surface_atlas.webp`
  - `public/textures/fenbridge_surface_normal.webp`
  - `public/textures/fenbridge_surface_roughness.webp`
- Do not embed raster textures in GLBs.
- Atlas source art is AI-authored and hand-composited into the cell grid. Prefer
  richer surface source over inventing more flat geometry when something looks plastic.
- Low tier may drop normal/roughness and emissive accents; silhouette and collision
  stay identical.

### 6. Performance contracts

- Stay under the per-asset `triangleCeiling` and `byteCeiling` in
  `scripts/assets/fenbridge_town/model.js`.
- Wave ceilings (unique `55k` tris, placement-weighted `62k` tris, `2.5 MiB` GLBs,
  `448 KiB` support maps, `3.0 MiB` total media) are hard. Raising a single building
  budget is allowed when concept fidelity requires it; raise the **contract and the
  master-plan row in the same change**, and re-check wave totals.
- One hero building near `8k` tris is acceptable (inn precedent). Do not push every
  building to that band. Prefer denser shared helpers and selective clutter.
- Merge shipping geometry to at most one opaque and one emissive primitive.
- Desktop Ultra draw budget for the visible town remains at most `22` color draws and
  `10` shadow casters; mobile Low keeps silhouette parity without alternate GLBs.

### 7. Gameplay non-regression

Preserve unless the task explicitly changes them:

- Front-entry socket positions (inn: `[-2.8, 0, 4]`).
- Provision / teller / tannery / archive service sockets.
- `station_fenbridge_tannery`, mailbox, bank chest, muster orders, NPC standing points.
- Collision-bearing silhouettes across graphics tiers.
- Layout ids and native sizes in `src/sim/fenbridge_layout.ts`.

### 8. Export and proof loop

```bash
# Single-asset studio previews (fast iteration; does not rewrite public GLB)
node scripts/assets/fenbridge_town/export_fenbridge_town.mjs --preview-only --asset <id>

# Full rebuild of shipping GLB + support maps (required before pins update)
node scripts/assets/fenbridge_town/export_fenbridge_town.mjs --no-preview
# or scoped full export if supported by the current export flags

# Open previews in Finder
open tmp/fenbridge_town_preview/<id>/optimized/

# Pin + contract tests
npx vitest run tests/fenbridge_town_assets.test.ts
npx vitest run tests/fenbridge_layout_suite.test.ts tests/fenbridge_town_renderer.test.ts
```

Important: `--preview-only` does **not** stage `public/models`. Always run a full
export (without `--preview-only`) before updating SHA / triangle / byte pins in
`tests/fenbridge_town_assets.test.ts`.

Required visual proof per asset:

1. Front, rear, left, right, hero, front-3q, rear-3q, grazing studio frames.
2. Player-scale and collider-overlay audit frames.
3. Side gables must not look like flat teal triangles.
4. Front approach must show a clear door path (compare inn porch lessons).
5. Roof must seat on the wall plate (no floating lid).
6. Dormers / balconies / chimneys must read as open or articulated, not sealed boxes.

## Shared recipes that earned the inn bar

Prefer these helpers over bespoke one-offs. Extend them when a second building needs
the same pattern (rule of three still applies for brand-new helpers).

| Recipe | Where | Use for |
| --- | --- | --- |
| `addBentConceptRoof` | `shared.js` | Continuous bent teal roof, gable close, bargeboards, battens, shingle courses, ridge, fascia |
| `addRaisedPilingDeck` | `shared.js` | Marsh stilts + open undercroft + deck planks |
| `addVerticalPlankFace` | `shared.js` | Exterior plank rhythm on a closed shell face |
| `addRopeRail` | `shared.js` | Low porch / apron rope rails without blocking the approach |
| `addBarrel` / `addCrate` / `addLantern` | `shared.js` | Exterior clutter and warm/fenlight accents |
| `addDormer` | `buildings_service.js` | Open framed dormer with glowing window (not a dark box) |
| `addDoor` / `addWindow` / `addExteriorWindow` | service / shared | Readable openings with sills and door planks |
| Semantic buckets | `FENBRIDGE_BUCKET_KEYS` | stone, timber, roof, cloth, metal, parchment, organic, warm, fenlight |

Inn-specific lessons to reuse, not copy blindly:

1. **Sparse porch posts, clear bays.** Five posts beat a wood cage. Short knee braces
   only; no full-height diagonals.
2. **Wall plate under the roof.** A timber plate at `wallTop` kills floating roofs.
3. **Door planks, not a dark hole.** Vertical leaf boards + brass handle read as a door
   at gameplay distance.
4. **Clutter at corners only.** Barrels, crates, nets, rear crane stay off the entry
   socket path.
5. **Chimney courses with slight taper and cap lip.** Reads against sky and eave.
6. **Lanterns on extended arms** when the concept hangs light clear of the door bay.
7. **In-game 3Q often reads better than pure orthographic studio.** Still fix side
   gables and orthographic failures; do not ship "looks fine only at 3Q".

## Hard "do not" list (learned on inn + tannery)

- Do not block the front porch with planks, X-bracing, or dense diagonal lattice.
- Do not ship a roof as two independent pitch boxes that leave a gap or float.
- Do not leave gable ends as featureless triangles.
- Do not model a dormer as a solid dark cube on the roof.
- Do not invent interiors "for completeness".
- Do not hand-edit optimized GLBs or support WebPs; regenerate from factories and
  `build_support_maps.mjs`.
- Do not lower quality to hit the old plan targets when concept fidelity needs more
  tris. Raise the **local ceiling** with evidence, keep the wave budget honest.
- Do not change socket X/Z for service buildings without re-running layout suite
  tests and checking NPC / station distances.
- Do not append large new logic into `renderer.ts` or `sim.ts`. Stay in the Fenbridge
  factory modules, layout contract, and `src/render/fenbridge_town.ts` adapter.
- Do not run posts, beams, or braces **through** vats, counters, doors, or service
  props (tannery: mid-bay post through vat water). Keep structural grids clear of
  prop volumes.
- Do not leave multi-strip roof pieces floating above their headers. Lean-to and
  wing roofs must seat on the timber frame with a locked eave board.
- Do not stop after one rewrite. Multi-round polish is part of the quality bar.

## Rebuild status and recommended order

Status meanings:

- **quality-bar**: full rewrite plus multi-round polish, human-reviewed against
  concept, pins green, no known floating pieces or gameplay-apron collisions.
- **first-pass**: shipping GLB exists from the kit factory; needs a quality rebuild.
- **props**: smaller modules; still need identity polish but less structural rewrite.

| Asset id | Role | Status | Notes |
| --- | --- | --- | --- |
| `crooked_reed_inn` | Provision + rest landmark | **quality-bar (approved)** | Human-approved; continuous bent roof |
| `hesk_tannery` | Profession station + Hesk | **quality-bar (approved)** | Human-approved; `12` yd craft bay |
| `warden_gatehouse` | South-gate first impression | **quality-bar (approved)** | Human-approved; pointed roof + antlers |
| `lantern_chapel` | Graveyard + archive | **quality-bar (approved)** | Process reference: gable + bell + niche |
| `moonwort_apothecary` | Yara service | **multi-round shipped** | Bent roof, herb counter, potions |
| `gilded_strongbox` | Bank + Petra chest apron | **multi-round shipped** | Teller bars, vault door, sign |
| `scout_lodge` | Maren + north route | **multi-round shipped** | Lookout tower, map table, spears |
| `mirelight_cistern` | Civic center landmark | **multi-round shipped** | Pavilion, brazier, fenlights |
| `provision_stall` | Market prop | **multi-round shipped** | Teal canopy, counter goods |
| `gate_arch` | Four open gates | **multi-round shipped** | Open lane, horn, lanterns |
| `palisade_wing` | Instanced wall | **multi-round shipped** | Stakes, rails, rope X |
| `boardwalk` | Wet-margin dresser | **multi-round shipped** | Seated planks |
| `muster_board` | Quest notice | **multi-round shipped** | Sealed blank notices |
| `muster_order` | Quest object x2 | **multi-round shipped** | Wax-sealed packet |

**Full town quality rebuild complete (2026-08-04).** Wave ceilings: unique `72k`,
weighted `88k`. Studio previews under `tmp/fenbridge_town_preview/*/optimized/`.
Human review of the newly shipped assets is the remaining acceptance step.

Recommended order is complete. Optional follow-up: re-apply chapel gable lessons
to any older building that still shows orthographic flat ends after human review.

## Multi-round polish (required, not optional)

**Lantern Chapel is the current quality reference for process.** It looked correct
on first human review because the factory followed ridge orientation + gable
fill + stick-kill rules below, then many export-and-look rounds. Inn and tannery
remain approved landmarks; chapel is the process ceiling to match on every remaining
asset. Prefer **10 to 15 focused rounds** for buildings; props may ship in 8 to 12.

Do not call an asset done after a single rewrite pass.

### Proven round cadence (buildings)

1. **Proportions + footing:** stone/moss base, buttresses or stilts, contract
   native bounds, sockets noted in the header.
2. **Shell + plate:** closed exterior mass, plank faces, corner posts, iron straps,
   wall plate the roof seats on.
3. **Roof orientation (load-bearing):** decide from the concept front whether the
   player sees a **timber gable** or a **shingle slope**. Ridge along Z when front
   is a pointed wood gable (chapel, gatehouse). Ridge along X / bent roof when
   front is a porch under a long eaves (inn, tannery). Wrong axis = flat teal face.
4. **Roof courses + gable skins:** `addShingledRoof` or `addBentConceptRoof` for
   slopes; **solid timber fill at the roof end plane** (not at the wall plane) so
   front/rear never read as smooth teal triangles.
5. **Identity silhouette:** bell, horns, chimney, balcony, awning, tower, etc.
6. **Openings:** doors with leaf boards, windows with mullions, clear approach.
7. **Service apron / niche:** archive, herb, teller, station; keep socket clear.
8. **Lanterns + vertical accents:** arms, grave lamps, posts, chains.
9. **Micro hardware:** iron studs, straps, rope, moss pads.
10. **Clutter:** barrels/crates only off the approach lane.
11. **Eave locks + rain streaks:** seat roof to plate; damp hierarchy on walls.
12. **Stick kill:** remove long rotated diagonals that silhouette as free X-sticks
    above the ridge. Prefer short stepped barge segments on the gable face only.
13. **Orthographic pass:** fix pure front/rear/side/left failures, not only hero 3Q.
14. **Density pass:** more courses, planks, or hardware only while under ceiling.
15. **Ship pass:** full export (not `--preview-only`), pin update, Finder review.

Props collapse 1 to 5 into fewer rounds but still require orientation, seat, and
stick-kill checks.

### Hard lessons (chapel / gatehouse)

- Place gable timber at **roofHalfD**, not wall frontZ. Overhang otherwise shows
  a flat teal tip in front orthographic.
- Do not densify roofs with free-standing course boards that stand off the pitch
  as fans (gatehouse regression). Use the shared course helpers.
- `addShingledRoof` course centers must sit on the slope with `t` from eave to ridge
  (`along * (1 - t)`). Inverted placement floats shelves.
- Multi-export visual review is mandatory: front, rear, left, right, hero, front-3q
  against zone crops and the master concept.
- Raise **local** triangle/byte ceilings with evidence; keep wave totals honest.

Performance stays honest: denser when it sells identity; fewer wider pieces when
that reads as well as many thin ones.

## Per-asset rebuild recipe (repeatable)

1. Open turnaround + zone crops + `serviceCues` only. Do **not** use the old
   factory or old previews as the target look.
2. Delete the asset's previous factory body and any first-pass-only helpers it owned.
3. Write a short identity inventory in a **new** factory header comment (see inn).
4. Author exterior systems from scratch in order: foundation / stilts, shell +
   plank faces, wall plate, continuous roof, chimney / identity extras, openings,
   service apron, clutter, lanterns.
5. Run **multi-round polish** (section above). Preview-only each round; judge all
   eight studio views plus player-scale against the concept.
6. Fix orthographic failures (sides, rear, grazing) even if 3Q looks fine.
7. Full export without `--preview-only` so `public/models` is fully replaced.
8. Update `EXPECTED_ARTIFACTS` pins and totals in `tests/fenbridge_town_assets.test.ts`.
9. Run layout + assets + renderer tests; adjust local ceilings in `model.js` and
   `master-plan.md` only if the wave still fits.
10. Mark the row in this status table **quality-bar** only after human review.
11. Open optimized previews in Finder for human review before calling it done.

## Worktree and pipeline anchors

- Worktree for this effort: keep task work isolated (current: `wocc-fenbridge-rebuild`).
- Factories: `scripts/assets/fenbridge_town/{shared,buildings_service,buildings_civic,props,model}.js`
- Export: `scripts/assets/fenbridge_town/export_fenbridge_town.mjs`
- Support maps: `scripts/assets/fenbridge_town/build_support_maps.mjs` + `support_maps.mjs`
- Optimizer spec: `scripts/assets/specs/fenbridge_town.json`
- Runtime adapter: `src/render/fenbridge_town.ts` + `src/render/fenbridge_surface_mapping.ts`
- Layout contract: `src/sim/fenbridge_layout.ts`
- Workflow skills: `.claude/skills/image-to-glb/SKILL.md`, `img2threejs` skill, repo
  runbook `docs/image-to-glb-asset-workflow.md`

## Session handoff notes (2026-08-04)

- **All 14 Fenbridge town assets have multi-round factories** (no remaining
  `buildUnapprovedPlaceholder` stubs). Concept art under `references/` and
  `img2threejs/` remains the visual authority.
- **Process reference:** Lantern Chapel (first asset that human-reviewed clean on
  first look). Ridge orientation + timber gable at roof end plane + stick-kill are
  documented above.
- **Human-approved:** inn, tannery, gatehouse, chapel.
- **Shipped for review:** apothecary, strongbox, scout lodge, cistern, provision
  stall, gate arch, palisade, boardwalk, muster board, muster order.
- Wave: unique `50,696` / weighted `67,151` tris (ceilings `72k` / `88k`).
- Previews: `tmp/fenbridge_town_preview/<id>/optimized/`.
- Remaining: human review of newly shipped assets; optional density polish on
  strongbox/cistern/stall if review asks for more concept match.
