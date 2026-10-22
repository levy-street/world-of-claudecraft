# Reviewed Studio layout import

The import applies spatial edits to current gameplay definitions. It does not
replace the built-in world with the offline map's old NPC or camp records.

## Current migration status

The reviewed Eastbrook/Mirefen migration is activated in this worktree through
`src/sim/world_layout/active.ts`. Normal client/server/headless boot consumes the
same compiled layout. Online layout epoch 46 rejects clients with older geography.
Local activation is not a deployment; release QA remains in progress.

The source map's obsolete Highwatch manor placement has been removed, as requested.
The candidate review binds 45 canonical buildings, 76 NPC position or
facing changes, 37 camp split/move groups, two ground-object position changes and
38 gameplay-object moves, 13 road edits and 44 new paths. Five other ground-object differences were missing
reserved entity IDs, which the import preserves from current game content.

The reconciliation decisions are recorded in
`data/world_layout/eastbrook_and_mirefen.review.json` and reported by the audit:

- Every source placement now has an explicit reconciliation decision. The compiler
  compares actual render/collision projections against a fresh current-world
  snapshot, consuming each baseline occurrence once. A bound building's old slot
  cannot also preserve a copy at that location. Historical absence is never
  treated as an automatic deletion of newer content.
- Original combine-stage UIDs bind the quay cottage, warden gatehouse and watch
  house; their copied houses remain separate additions. Exact first-combined
  matches followed by persistent UIDs also bind the moved painted-town buildings.
- Crafting stations follow their moved masters with current relative offsets.
  Reviewed graveyard moves retain stable service IDs and newer sites. Terrain
  stamps retain final source order, including repeated dabs, after current terrain
  records. Grass clearings and biome paint import through validated shared data.
  The current Mirefen tavern and its cast are retained.
- Candidate acceptance exercised real walking, service actions, bank operations,
  farming/gathering commands, ferry client/server wire behavior, dungeon entry/exit
  and resurrection. Repeated offline/server startup agrees. Rendered town views
  exposed and verified the Highwatch landing correction described below.

Jamie confirmed the five specialist healing-dummy removals and eight mob-count
changes in Skynet message `9fb219df-ed1a-419f-a887-9200c01f35a4` on 2026-10-22.
The candidate contains 314 camps and 710 mobs, versus 218 camps and 714 mobs.
Splitting/reordering camps and changing population can alter shared random draws
and entity allocation. This is an explicit gameplay migration; retain `offStream`
behavior and validate affected seeded scenarios rather than claiming old spawn
goldens are unchanged. Fisher Nell, Maudie and four patrons stay in current content.

Roads are matched by exact source geometry, never by the current array index.
The candidate contains 147 roads (103 current plus 44 additions). Two stale road
edits are explicitly excluded: the current Bridgemere causeway and Moonrest
Moonspring road were rerouted around newer painted inns. Preserve those current
routes. Rendered town approaches and the entrance walking regression retain access.

## Commands

### Source provenance update (Jamie, 22 October)

Jamie reports that no untouched original survives. Recovered from Git history:

- `6f5fea2931d:data/maps/world_of_claudecraft.map.json`: earliest surviving edited
  world save, 9,379 placements, 2,144 terrain stamps and 260 grass clearings.
- `3aa88a5a077:data/maps/mirefen_changes.map.json`: separate Mirefen document,
  2,929 placements, 1,317 terrain stamps and 231 camps.
- `9f3d98d7dfc:public/maps/default-world.wocmap.zip`: candidate authoring baseline,
  suggested by Jamie from timing/overlap; **not a proven original**.

Local copies are under `tmp/map-provenance/`. The combine commit confirms the
whole woc-map world plus 1,191 Mirefen stamps, seven moved Fenbridge buildings/props
and ten moved NPCs. The requested world-source and intermediate files were
delivered on the file-only branch `share/map-audit-sources` at
`f24b9bd906e7629ca2a0837f0c782d9f1c4dd65a`; both were downloaded and independently
hash-verified. Do not merge that branch into game code.

| Source file | SHA-256 |
| --- | --- |
| `woc-map_c5427ab37cc.map.json` | `167b46b95c8797bca65df100955d5b6a209263fae56c0bc264c794bafa242d51` |
| `eastbrook-and-mirefen-changes_20261020T0115Z.map.json` | `0b753e684eee666c1bab9239970446521d0f10429409d7a1dda9052502bd382b` |

Content-multiset comparison confirms every intermediate terrain stamp and grass
clearing survives in the final map. The final stamp order differs; do not rebuild
it by assuming append-only history. Intermediate placements contain duplicate
UIDs, and intermediate terrain/grass records include missing IDs. Those facts do
not prove any unmatched placement was added or deliberately deleted.

**Correction:** missing vendor items do not establish a pre-September authoring
base. `sanitizeNpc` passes inventories through `strArray`, which truncates at 64.
Both warfare vendors in the earlier save contain 15 Vanguard items. Preserve the
current inventories as planned, and track the silent truncation as a separate
Studio defect. Quest ID lists share that cap. `MAX_ROADS` is 256 in this checkout
and at `6f5fea2931d`, despite the reply's reported 64-road limit.

Source: Skynet message `05a0b00f-6d07-4482-82a0-292ccc9c0929`, checked against local
Git objects and `src/sim/map_doc.ts`. No original baseline is proven by this evidence.

### Running the compiler

```sh
node scripts/export_world_layout.mjs --audit
node scripts/export_world_layout.mjs --write
node scripts/export_world_layout.mjs --check
```

Optional third/fourth arguments select another map and review JSON. Audit writes
`tmp/world-layout-export.json` and does not activate anything. `--write` refuses
unresolved changes, missing assets, stale source hashes, unresolved identities and
unsupported transforms. Only a fully reconciled export replaces `active.ts`.
`--check` compares the deterministic output with that module. No command commits,
publishes or deploys.

The review pins the exact source SHA-256 and the current game's base revision
(not the lost original Studio authoring revision). Camp indices are valid only for
those exact map bytes. An edited/reordered source requires a new review. A source
record omitted from the import must either match current spatial data or have an
explicit preservation reason; unsupported layers and unbound assets cannot vanish
silently. Population differences require exact before/after counts and a reason.

The compiler bundles the current canonical world with the active layout replaced
by an empty layout **at build time**. Re-export therefore never applies the previous
camp/building transformation a second time. Server simulation has no editor or
filesystem dependency and no mutable export-time global switch.

## Runtime contract

- Canonical town factories apply building transforms before deriving dependent
  props, sockets and bounds. Walls, walk-in decks, model placement and camera rooms
  all honor the same fixed ground seat when a Studio building is detached.
- `data.ts` exports the same adjusted NPC/camp/object tables that `BUILTIN_WORLD`
  contains. It never replaces an NPC's role flags, inventories, quests or other
  gameplay fields from Studio data. Absent records preserve newer content.
- Camp groups name exact canonical source identities. Merging sources with different
  behavior (including different `offStream` flags) fails. Original behavior is copied
  to each split camp. Ground-object reserved IDs remain owned by canonical content.
- Existing object-move resolvers handle beds, gather nodes, dummies and dungeon doors;
  their IDs and removal semantics stay unchanged.
- Road composition retains later additions and untouched road references, rejects
  missing/ambiguous canonical geometry, and requires explicit decisions for every
  source road edit/addition. Source map indices are only references into the
  SHA-pinned input, not runtime road identities.
- Collision Master adoption on existing noncolliding scenery uses
  `sceneryCollisions`, consumed by the shared collision, ramp and ladder paths.
  Original renderers retain their models, avoiding a second visible copy. The
  compiler requires an exact current baseline and rejects spatial/visual changes.
- Procedural scenery replacements carry the generator's stable exclusion key and
  an explicit source binding. Other generated scenery remains active. Additional
  models are validated and projected through the same asset path as Studio.
- Keep the live day/night and biome lighting. The source's `sunIntensity: 6`
  brightness profile is not a time setting; importing it would replace the live
  lighting rig without established authoring intent.
- Civic props retain their native identity and derived service sockets. The weekly
  vault uses one fixed seat for its terrain pad, model, collision and camera bounds.
  Its export requires a detached fixed ground seat: a terrain-relative vault would
  otherwise feed its own pad height back into its model offset and is rejected.

Focused regression coverage is in `tests/world_layout*.test.ts`. The runtime test
injects a moved Fenbridge bank through the real factory/data path and compares its
physical walls and floor against a detached placed asset, alongside its model and
camera seat. Compiler fixtures explicitly start from the canonical, unmodified
world; the real-source candidate suite exercises the activated layout separately.

## Foundation verification history (before activation)

- `pnpm exec vitest run tests/world_layout.test.ts tests/world_layout_export.test.ts
  tests/world_layout_runtime.test.ts tests/world_layout_roads.test.ts --maxWorkers=2`
  covers composition, import refusal, current feature retention, fixed building
  seats, and road identity. The final exporter-only rerun also covers JSON property
  ordering and ambiguous ground-object item IDs.
- Relevant existing suites: `town_walk_in`, `placed_town_interiors`, `moved_objects`,
  `off_stream_rng` and `architecture`. One architecture disk scan timed out during
  concurrent typechecking; its isolated rerun passed.
- `pnpm exec tsc --noEmit --pretty false` and `pnpm run build:server` pass.
- Explicit Biome checks cover changed/new TypeScript and script files. The
  `ci:changed` command selected zero files on this uncommitted branch, so its result
  is not counted as lint evidence.
- A complete serialized built-in world/building comparison matches the pre-change
  snapshot. Two real CLI audits produce identical report bytes. An attempted
  unresolved `--write` exits nonzero and leaves `active.ts` byte-identical.
- `GATE_SELECT_BASE=origin/feature/v045-integration GATE_MAX_WORKERS=2 node
  scripts/gate_select.mjs` stops in audio preflight: the installed
  `ffprobe-static/bin/darwin/arm64/ffprobe` is actually x86_64 and fails to execute
  with system error -86. The full Gate is therefore **not passed**. No client build,
  visual/online acceptance, merge or deployment is claimed.


## Current reconciliation checkpoint

The final candidate has zero unbound placements. It contains 127 exact
canonical prop replacements, 274 procedural-decoration replacements, 110 collision
adoptions, and 685 imported models including retained siblings. Five civic bindings
include the weekly vault, the two Eastbrook stalls, the Fenbridge cistern and the
Fenbridge provision stall. Counts come from
`tmp/world-layout-export.json`; regenerate the audit after editing the review.

Whole-prop replacement keeps unedited children and the original index-based model
variants. Untouched stone-fence sections remain native fence runs, preserving jump
crossing. Campfire/forge sound anchors follow their main models. Six dock planks
carry transformed analytic walk surfaces: body-height reach, underside ceilings,
collision-off behavior and wood footsteps are covered by regression tests.

Sixteen authored streetlamp moves and four explicit deletions use the native lamp
plan, retaining fixture lighting, solid posts, yaw and fixed ground seats. Other
current road lamps remain generated; the authored posts reserve only their actual
clearance footprints. Unsupported fixture scaling, tilt or visual overrides fail
export. Jamie's source/history evidence in Skynet message
`ee061de5-8644-4f63-a50a-7f2d5e21458e` supports preserving later UID-linked edits
while keeping current generated positions for ambiguous early rows. This is
provenance evidence, not independent confirmation of every author's intention.

The focused run below passes 18 files / 138 tests, and `pnpm exec tsc --noEmit`
passes. It includes a real repeated-export test with an installed nonempty layout,
so exporting does not compound the prior migration. The separate real-source candidate
test also passes (one test), bringing the focused total to 139 tests.

```sh
pnpm exec vitest run tests/world_layout*.test.ts tests/world_layout_base.test.mjs tests/streetlamps.test.ts tests/streetlamp_colliders.test.ts tests/monolith_budget.test.ts --maxWorkers=2
```

The final scenery decisions preserve newer Gullhaven, Wickharbor and Hedgewick
fence changes documented in commits `f0179acbb2c`, `ea169ee399f` and `961ac715590`.
Three early tree moves bind unique historical/current model, yaw and scale matches;
the exact current generator occurrences are replaced, avoiding duplicate trees.

`data/world_layout/eastbrook_and_mirefen.corrections.json` records six subsequent
integration corrections with before/after values: three NPC stands, the Highwatch
alchemist and its station, one herb node and the copied Gibbetmere house. A complete
candidate probe of 409 NPC/service/entrance/gather locations detected six regressions
before those corrections and none afterward. It checks anchor collision and nearby
standing positions, not whole-route reachability or visual fit. The real-source
regression in `tests/world_layout_candidate.test.mjs` protects those corrections and
checks retention of current NPC gameplay fields and static services.

The candidate also boots the real `Sim` in offline and server-style (`noPlayer`)
configurations: all 1,054 non-player entities have identical template, position,
facing, level and off-stream flags. Offline allocates a local player before the
final practice/service spawns, so those sequential IDs differ by one as expected;
reserved IDs stay fixed. Repeated server-style startup is identical including IDs.
All 710 expected camp mobs spawn, all positions are finite, and the five removed
specialist healing dummies stay absent. This verifies seeded startup, not live
WebSocket client synchronization or a long-running migration scenario.

These startup checks were completed before activation. The activation acceptance
and remaining full-gate work are recorded in the final section below.

## Entrance walking correction (23 October)

The initial 409-anchor probe passed, but a real `Sim` walker found 11 entrances
with raised lips or a steep approach. The same probe passed all 38 canonical
walk-in buildings. Eight buildings retain the native buried-footing/terrain
attachment correction. Jamie subsequently confirmed authored lifts for Eastbrook
bank (-0.5), Icemantle trade hall (-1) and Eldershine market (-0.5). Those three
retain their authored lifts, with local doorway terrain approaches. Horizontal
building positions, yaw and scale stay authored. The Highwatch route starts in
the square at (-34.5, 686), passes its front standing point and enters the building.
The three raised-building walks start outside the entire doorway terrain stamp.

The source contains 7,766 terrain stamps (7,761 authored plus five integration
corrections). The ledger contains 20 correction records: six initial clearance
changes, eight native-seat restorations, Eldershine terrain attachment and five
terrain stamps. Its batch history preserves the superseded three-height decision.
The candidate regression pins the three source and compiled lifts and walks all
38 entrances. Restoring the three lifts without terrain approaches reproduced
exactly three blocked entrances; the local approaches restore walking access.

Five initial candidate screenshots were inspected, with no page errors; refreshed
views of nine corrected locations were also inspected with no page errors. Native
interior fading initially obscured some exterior views; aiming outside the
building showed the restored facades. The Highwatch station inspection found a
steep ramp edge, corrected by broadening its level landing. Visual capture holds JPEGs
in memory until its task-owned browser profile is closed and removed, avoiding the
earlier disk-space failure. Images and capture metadata are in `tmp/layout-preview/`.

`ONLINE_WORLD_LAYOUT_VERSION` and the paired Node auth discriminator/type
declaration/tests now use epoch 46. Older compiled clients are rejected before
admission to the migrated server. The startup seed probe was repeated against the corrected source and still
passes: 1,054 non-player entities, 710 camp mobs, matching offline/server spawn
content and repeatable server IDs. In-process client/server wire suites cover
farming commands and ferry synchronization. The exporter activates local data;
it never deploys the map.

Jamie supplied source-height history in Skynet message
`358e973a-da23-41ca-8bb0-69c523cd8378`. The local Studio move code confirms that
default dragging freezes a ground seat and snap-to-ground clears vertical lift.
This explains the failure mechanism but does not prove author intent. Jamie then
confirmed the three rounded lifts in Skynet message
`1b33f2ac-34ed-4498-af02-560cc1b0e915`, superseding their native-footing correction.
He also confirmed the other eight native seats, lighting, collision, lamp and
clearance decisions. No author-intent questions remain.

## Local activation acceptance (23 October)

The final source SHA-256 is
`e16c7eb5de9ea6274fc7bbeb7de2ad3138632f93c8a6b8fb380ee6c18e3e12ee`.
The correction ledger records the broader, level Highwatch approach that replaces
the narrow ramp. It supports the adjacent alchemist without moving the authored
horizontal layout. The five integration terrain stamps remain after all authored stamps.

`tests/world_layout_candidate.test.mjs` compiles the real source against a fresh
canonical baseline, verifies every source binding, preserves NPC gameplay fields,
walks every native walk-in entrance, crafts at every moved station, releases and
resurrects at every overworld graveyard, and enters/exits the moved Dawnhold door.
Its service probe lives in `tests/helpers/world_layout_service_probe.ts`.

Candidate runs of the existing bank, crafting, farming, gathering, spirit, portal
and ferry suites validate the shared runtime and client/server command path. Farm
and gathering fixtures now resolve the runtime positions; station runtime tests
read adjusted stations while default-content pins still read the canonical table.
Four consent/charge tests pin common rarity explicitly, so intentional camp spawn
changes cannot silently change their expected inventory counts. The same fixture
changes pass against the pre-activation world too.

Repeated startup retains 1,054 non-player entities and 710 camp mobs. Offline and
server content match; the local player shifts later sequential IDs by one, while
reserved IDs remain unchanged. This does not assert old full-world parity goldens
are unchanged: the approved spawn migration intentionally changes their inputs.

The activated export emits large terrain arrays in typed chunks to stay below
TypeScript's union-inference limit. The candidate regression loads that emitted
module and compares the entire layout with the compiler result, including stamp
order. This changes serialization structure only, not map data.

### Confirmed-height follow-up

Jamie-confirmed heights are installed in source, review and active runtime at the
SHA above. `pnpm exec vitest run tests/world_layout_candidate.test.mjs --maxWorkers=1`
passes with exact source/compiled lift pins and all 38 walking routes. The three
raised-building routes begin outside the terrain stamps. Export audit/write/check,
TypeScript, scoped Biome, all 409 access probes and repeated offline/server startup
pass again. Biome reports warnings for generated numeric literals, with no errors.
`pnpm exec vitest run tests/parity/parity_*.test.ts --maxWorkers=2` passes all 168
checks against the existing migrated goldens; no further golden regeneration was
needed. Logs are `tmp/layout-confirmed-*` and
`tmp/layout-authored-approaches-final.log`.

The broader checks below were run for the initial activation. This follow-up only
changes three building lifts and adds three terrain stamps; the source comparison
verified every other map value unchanged. The complete gate remains pending; the initial pre-publication result is recorded below.

### Validation checkpoint

| Check | Result |
| --- | --- |
| `node scripts/export_world_layout.mjs --check` | Pass; deterministic active export |
| `pnpm exec tsc --noEmit` | Pass with active layout |
| Focused export, environment, baseline, candidate and architecture suites | 5 files, 146 tests pass |
| Candidate suite after adding emitted-module equality | 1 test passes; includes 38 walks, six crafting stations, 20 graveyards and Dawnhold entry/exit |
| Epoch/auth/wire suites | 4 files, 114 tests pass, including rejection of epoch 45 |
| Explicit Biome check over task sources | 100 files pass |
| `pnpm run build:bundle` and `pnpm run build:server` | Both pass; run before the serialization-only chunking change |
| `pnpm run security:gate` | Pass; zero high findings after repository priors |
| `UPDATE_PARITY=1 pnpm exec vitest run tests/parity/parity_*.test.ts --maxWorkers=2` | 7 files, 168 checks pass; 84 golden files updated deliberately |
| Localization, guide, world API and monolith guards | 690 pass, three skip; one guide index-freshness failure described below |

The selective gate was attempted with
`WOC_FFPROBE_PATH=/opt/homebrew/bin/ffprobe node scripts/gate_select.mjs`.
It regenerated five correct guide references (Gizzel at Highwatch, Ottilie at
Fenbridge), then stopped because those updates were uncommitted at that checkpoint. The guide test
independently confirms regenerated bytes match the working file and fails only
its index-cleanliness assertion. No staging was performed to bypass that check.
This is not a complete green gate or merge-readiness claim. Remaining broad gate
steps, including browser, admin/bot and SFX checks, are not claimed as passed.

Epoch 46 deliberately changes map geometry, camp population and constructor RNG
draw order. The initial parity run reported 85 parity-test failures and 11
coverage failures. All 11 coverage failures now pass: scenarios use runtime gather
and farm positions, visit the moved farmer for husk conversion, honor the civic
canopy seat, and settle a teleported pet owner's collision before channeling.
Bounded seed probes preserve the actual craft proc, Perfecting failure, heroic
money, rift pattern and master-loot tie-break arms. Farming uses five additional
real plant/harvest cycles to reach the same rare-harvest roll. No trace fields,
precision, RNG observer or gameplay rules were weakened. Golden regeneration is
a deliberate migration artifact and should be reviewed/committed separately from
the implementation. The regeneration run passed all 168 checks, including repeated
scenario determinism. It changed all 84 scenario golden files. No trace-harness code changed.

Review images: [Highwatch approach](../screenshots/world-map-integration/highwatch-bank-after.jpg)
and [Fenbridge](../screenshots/world-map-integration/fenbridge-after.jpg).
This checkpoint preceded publication. The implementation and parity migration are
published as separate commits for review; no merge or deployment is included.

Confirmed-height render evidence (runtime lifts and all 7,766 stamps verified;
no page errors; tutorial overlay dismissed):
[Eastbrook bank](../screenshots/world-map-integration/eastbrook-bank-authored-height-after.jpg),
[Icemantle trade hall](../screenshots/world-map-integration/icemantle-hall-authored-height-after.jpg),
[Eldershine market](../screenshots/world-map-integration/eldershine-market-authored-height-after.jpg).
The first follow-up boot timed out; subsequent diagnostic and clean capture runs
completed. These are local offline captures, not a live-server deployment check.

The final source retains the existing compact repository format (one placement,
terrain stamp or grass clearing per line). A deep equality check proved that
restoring formatting changed no map values. The generated runtime is identical
apart from its source-hash comment; deterministic export was rechecked.

The comparisons below use an isolated before preview with the same authored
heights, omitting only the three doorway terrain fixes. This reproduces the
blocked-entrance state without modifying the validated active map.

| Entrance | Before terrain correction | After terrain correction |
| --- | --- | --- |
| Eastbrook bank | [Before](../screenshots/world-map-integration/eastbrook-bank-authored-height-before.jpg) | [After](../screenshots/world-map-integration/eastbrook-bank-authored-height-after.jpg) |
| Icemantle trade hall | [Before](../screenshots/world-map-integration/icemantle-hall-authored-height-before.jpg) | [After](../screenshots/world-map-integration/icemantle-hall-authored-height-after.jpg) |
| Eldershine market | [Before](../screenshots/world-map-integration/eldershine-market-authored-height-before.jpg) | [After](../screenshots/world-map-integration/eldershine-market-authored-height-after.jpg) |
