# Implementation Handoff: The Hullworks (five-player smuggler-shipyard dungeon)

| | |
|---|---|
| **Status** | BLOCKED. Do not start slices until: (1) the Levy conversation on the PRD has happened (contribution process: features need a conversation first, then a PBE round); (2) the Galecrest zone PR #2321 (`feature/procedural-dungeons`) has merged, this dungeon stacks on its zone file; (3) the open question is resolved: level band 13 to 15 inside a level 20 zone (sheltered entrance pocket) OR re-band to 20. All numbers below assume 13 to 15; a re-band changes boss levels, loot ilvls, and the entrance pocket rule but no file structure. Pass 2 applied 2026-07-27 (maintainer direction: do not copy Deadmines, too long): cut from five bosses plus an optional wing to THREE (Charwick, the Hulljack, Redwake); Overseer Brack and Quartermaster Sallow cut outright along with the optional Sawpits wing; the Deadmines-style cannon-door breach replaced by the Sluiceworks flood beat, which the wrecker fiction actually earns (they drowned a hundred ships to build this one, and you drown it back); `cart_lanes.ts` and `wreck_train.ts` cut with their systems. |
| **Portfolio lane** | Proposed first approval candidate and first dungeon build. This is not Levy approval. |
| **Dispatch gate** | Levy selects the band and this portfolio slot, PR #2321 lands, and the PBE commitment is recorded. The pass-2 schedule cut is already applied; the protected spine is the worksite, the Charwick and Hulljack lineage, the Sluiceworks flood, and the Redwake deck finale. |
| **Source PRD** | `docs/prd/hullworks-dungeon.md` (honor its File plan; this doc slices it) |
| **Scope** | The full dungeon: instance shell, three bosses, the Sluiceworks flood beat, loot, heroic at launch on the existing machinery, deeds, quests, music, i18n, bot clear. Run length 20 to 30 minutes at level (tuning). PRD PR A = S1 to S4 (shell + bosses 1 to 2 lineage), PR B = S5 to S7 (flood + Redwake + heroic + loot). |
| **Verified against** | 2026-07-25: `origin/release/v0.30.0` (all engine anchors) and `origin/feature/procedural-dungeons` (galecrest anchors); pass-2 re-slice 2026-07-27 against the pass-2 PRD (engine anchors unchanged). Re-find every symbol before editing; trust symbols, not line numbers. |
| **Executor routing** | Claude uses `extract-and-test`, `build-dungeon-kit`, and `qa-checklist`; Codex uses `$woc-extract-and-test`, `$woc-build-dungeon-kit`, and `$woc-qa`. Sim diffs also get architecture review. |

---

## 0. Ground rules (deltas on FRONTIER_PHASE1_HANDOFF.md section 0, which applies verbatim)

1. All of Frontier handoff section 0: sim purity, `Rng` only, i18n classification,
   strict TS, no em/en dashes or emojis, Conventional Commits (`feat(hullworks): ...`),
   acceptance commands over "looks done".
2. Agent-completability is an acceptance criterion, not a style note: every interact is
   a channel with a cast bar, every hazard has a full telegraph, no sub-second windows.
3. Content is data-as-code in `src/sim/content/hullworks.ts`; behavior is modules behind
   `SimContext` (`src/sim/sim_context.ts`). `sim.ts` gains only tick-call lines. The
   Sluiceworks beat needs NO module: ground-object channels plus a door flag.
4. Contributor slices add English ITEM name rows. Maintainers fill remaining locale
   overlays before release. M16 quest prose needs the five non-Latin fills in the PR.
   Boss/mechanic/aura names need `src/ui/sim_i18n.ts` matcher entries plus
   `AURA_NAME_KEY`; NO test catches misses there, use the closeout checklists (S4, S7).
5. Deeds are append-only: `DEED_ORDER` derives from `Object.keys(DEEDS)`
   (`src/sim/content/deeds.ts:2228`), so new deeds go at the END of the record and ids
   never change once shipped (`docs/design/deeds.md` authoring contract).
6. The galecrest.ts edit stays additive and minimal: one POI, one NPC quest hook, one
   camp-exclusion comment. It is a #2321 branch file; coordinate the base.

## 1. Shared design constants (defined once in S1, imported everywhere)

```ts
// src/sim/content/hullworks.ts
export const HULLWORKS_ID = 'hullworks';
// S1 assigns the numeric DungeonDef index after auditing the active merged
// registry, landed dependencies, and accepted batch handoffs. It must be unique.
export const HULLWORKS_MIN_LEVEL = 13; // OPEN QUESTION; see header
// Boss levels (tuning): Charwick 16, Hulljack 17, Redwake 18.
// Entrance (tuning): work-lift head beside the Windway road, Galecrest coast south of
// Wickharbor; propose doorPos near { x: 260, z: 452 } (Windway POI is 200,440; hub 420,360).
// Place against real terrain and keep a 40 yd pocket clear of level-20 camps.
```

Timers (tuning, all generous by design): fuse crawl 10 s keg to keg, cut channel 1.5 s;
Hulljack berserk 10 s, remount gap 6 s, three pilots; sluice wheel open is a
wardstone-style channel (length tuning), one scripted crew response wave per wheel;
Redwake phases 100/70/30, Broadside cone 90 deg. Instance x-band: origin derives from
`index` like every dungeon (temple.ts:805 comment shows the formula, 900 + index*600).

## 2. Verified hook-point map (re-find before editing)

| Concern | Anchor |
|---|---|
| DUNGEON_DEFS registry | `src/sim/content/dungeons.ts:787`; merged at `src/sim/data.ts:432` (`DUNGEONS = { ...DUNGEON_DEFS, ...TEMPLE_DUNGEON_DEFS }`); Hullworks merges as a third spread or joins DUNGEON_DEFS |
| DungeonDef shape | `src/sim/types.ts:2409`: id, index (unique x-band), doorPos, overworldDoor, entry, exitOffset, spawns, objects, `interior: 'crypt'|'sanctum'|'temple'|'nythraxis'`, suggestedPlayers, enterText/leaveText. A new interior key needs renderer + collider builders; S1 starts on `'crypt'` |
| Keystone-style sealed doors | `nythraxis_crypt` def `dungeons.ts:829-864`: `objects` entry `{ templateId: 'dungeon_door', dungeonId: '<next-room-id>' }`; interact routes at `src/sim/interaction.ts:574` and `:646` to `ctx.enterDungeon`; door registry `src/sim/entity_roster.ts:125`, `src/sim/sim_context.ts:115`, spawn wiring `src/sim/instances/dungeons.ts:199`. Kill-boss-unseals = gate `ctx.enterDungeon` on the boss-kill flag, error otherwise (mirror the `crypt_keystone` gate, `src/sim/encounters/nythraxis.ts:1386`); the S5 lock gate gates on the both-wheels flood flag the same way |
| Ground-object interact channel (sluice wheels, fuse cut) | `tryStartNythraxisWardChannel(ctx, obj, p)` called from both interaction.ts arms (before `pickUpObject`); implementation + channel/interrupt state in `src/sim/encounters/nythraxis.ts` (~1009 `lightNythraxisWardstones`, ~1121 channel mechanics). Copy the shape, not the file |
| Boss-kit fields | `MobTemplate` at `src/sim/types.ts:1136` (`aoePulse`), examples `dungeons.ts:138` (aoePulse), `:184` (mortalStrike), `:294-295` (aoePulse + summonAdds), `:24` (charge/stun). NEW mechanics do NOT extend the kit; they live in the S3 to S6 modules keyed off template ids |
| Entry clearance | every def comments `entry` clear of first-pack aggro; pinned by `tests/dungeon_entry_clearance.test.ts` |
| Module tick pins | `src/sim/sim.ts` ~4505: `lap?.('<phase>')` after each phase; `server/game.ts:334` `SIM_LAP_PHASES` pins the exact emission list (append new names AFTER existing so old names stay byte-identical) |
| Zone file (branch #2321) | `src/sim/content/galecrest.ts` (584 lines): `GALECREST_ZONE.pois` ~:42, `GALECREST_NPCS` :199 (Harbormaster Odile :213), `GALECREST_QUESTS` :255, `GALECREST_QUEST_ORDER` :437, `GALECREST_OBJECTS` :505, `GALECREST_CAMPS` :496; merged at `src/sim/data.ts:110-119` on that branch. Zone is `levelRange: [20, 20]` |
| Deeds | `DEEDS` record `src/sim/content/deeds.ts:24`, per-boss first-kill rows follow existing dungeon rows; stat triggers via `src/sim/deeds.ts` counters (`groundObjectsLooted` pattern, `types.ts:4530`) |
| Music | `src/game/music_tracks.ts:24-26` (`dungeon_<id>` key convention) + `src/game/instance_music.ts` (`instanceMusicDecision`, `InstanceMusicController`) |
| Parity goldens | `tests/parity/scenarios.ts`; `UPDATE_PARITY=1 npx vitest run tests/parity` records; never regenerate to hide a diff |
| Bot clear harness | `scripts/crypt_raid.mjs` is the template (puppeteer, needs `npm run dev` + `npm run server` + `ALLOW_DEV_COMMANDS=1`) |
| Renderer set piece | new `src/render/hullworks_set.ts` called by the renderer (never a method bank on `renderer.ts`); interior builder keys resolve in the renderer + `src/sim/colliders.ts` interior paths (grep `interior ===`) |

## 3. Slices

Order: S1 -> S2 -> S3 -> S4 -> S5 -> S6 -> S7 (the S3 and S4 module work is
independent and can run parallel, but S4 closes PR A so it lands last in it).
PRD PR A ships S1 to S4; PR B ships S5 to S7. PBE round before any release merge.
S4 and S7 are their PR-boundary closeouts. Each includes that PR's Deeds and
pins, English catalog and any M16 work, sim matcher rows, wiki regeneration,
credits/provenance, and
`npx vitest run tests/deeds_content.test.ts tests/localization_fixes.test.ts tests/guide.test.ts && npm run wiki:content`.

### S1. Instance shell, Liftworks, entrance POI, entry clearance
- Goal: an enterable, exitable, empty-but-real dungeon: `hullworks` def (index
  resolved from the active merged registry in this slice,
  `interior: 'crypt'` as placeholder), internal-room def for the launched galleon deck
  (`hullworks_deck`, `overworldDoor: false`, nythraxis_boss_arena pattern), sealed
  `dungeon_door` objects between the boss rooms and at the lock gate to the deck (the
  S5 flood flag unseals that one), doorPos in Galecrest.
- Files: NEW `src/sim/content/hullworks.ts`; MODIFIED `src/sim/data.ts` (merge),
  `src/sim/content/galecrest.ts` (ONLY: one poi `{ label: 'The Hullworks Lift', id: 'hullworks_lift' }`,
  entrance-pocket comment on `GALECREST_CAMPS`), `tests/dungeon_entry_clearance.test.ts` pin.
- Tests FIRST: `tests/hullworks.test.ts`: def registered in `DUNGEONS`, index unique
  across dungeons+temple, enter at level 13 works, level 12 refused, entry point outside
  aggro radius of the first Liftworks spawn, sealed doors refuse before their flags
  (boss-kill doors and the lock gate).
- Acceptance: `npx vitest run tests/hullworks.test.ts tests/dungeon_entry_clearance.test.ts tests/dungeons.test.ts tests/architecture.test.ts && npx vitest run tests/parity` (untouched).

### S2. Work-crew packs + crews-stop-work readability
- Goal: all trash as legible WORK CREWS (sawyers, rat-catchers, powder line) in
  `DUNGEON_MOBS`-style templates inside hullworks.ts; killing a crew stops its work
  loop. Readability is sim-cheap: crews carry a `working` aura/emote state the renderer
  reads; on last-crew-death emit the existing ambience-quiet path (per-room ambience,
  no new event type if an aura drop suffices).
- Files: hullworks.ts (mob templates + spawn list, elite, level 14 to 16, hp/dmg per the
  neighboring Sunken Bastion rows scaled by the engine curves, no invented balance).
- Tests FIRST: extend tests/hullworks.test.ts: pack composition, elite flags, level
  bands, XP/loot rows present, crew-death clears the working state deterministically.
- Acceptance: `npx vitest run tests/hullworks.test.ts && npx vitest run tests/parity`.

### S3. fuse_lines module + Charwick the Fusemonger
- Goal: NEW `src/sim/fuse_lines.ts`: crawling fuses toward keg clusters, cuttable.
  State sketch:
  ```ts
  interface FuseLine { id: string; targetClusterId: string; startedAt: number;
    travelTime: number; cut: boolean; }
  // progress = (ctx.time - startedAt) / travelTime; at >= 1 and !cut: detonate the
  // cluster as a groundAoE. cutFuse: a 1.5 s interact channel on the fuse ground
  // object (tryStartNythraxisWardChannel pattern in interaction.ts), sets cut.
  ```
  Kegs and fuse heads are `objects` rows; Charwick lights one fuse (rng cluster pick via
  `ctx.rng`, drawn only inside the encounter), three at once below 30 pct. Flashpan is
  an existing cone debuff row.
- Files: NEW `src/sim/fuse_lines.ts` + `tests/fuse_lines.test.ts`; hullworks.ts;
  interaction.ts (one `tryStartFuseCut(ctx, obj, p)` call beside the ward-channel call);
  sim.ts tick line + SIM_LAP_PHASES append (`'fuseLines'` AFTER existing names);
  `src/sim/content/deeds.ts` (Charwick first-kill and Dry Powder rows) plus deed
  catalog pins.
- Tests FIRST: uncut fuse detonates exactly at travelTime; cut fuse never does; channel
  interrupted by damage does not cut; sub-30-pct lights exactly three; rng draws only
  during the encounter (parity safety).
- Acceptance: `npx vitest run tests/fuse_lines.test.ts tests/deeds_content.test.ts tests/architecture.test.ts && npx vitest run tests/parity`.

### S4. rig_pilot module + the Hulljack (PR A closeout)
- Goal: NEW `src/sim/rig_pilot.ts`: pilot/berserk/remount state machine. Rig and pilot
  are separate entities; pilot is the priority target. States: `piloted -> berserk(10s,
  random slow cleaves via ctx.rng) -> remount-run(6s burn window) -> piloted`, three
  pilots total, then a fixed overload (three telegraphed aoePulse rings) and inert.
  Grapple Claw: tank grab + 8 yd drag on existing knockback plumbing, breaks on stun or
  pilot death.
- Files: NEW `src/sim/rig_pilot.ts` + `tests/rig_pilot.test.ts`; hullworks.ts (rig +
  enginewright templates, queue positions); sim.ts tick line + SIM_LAP_PHASES append
  (`'rigPilot'`); `src/sim/content/deeds.ts` (Hulljack first-kill row) plus deed
  catalog pins.
- Tests FIRST: full state-machine walk (3 pilots then overload then inert); berserk
  never targets (no threat writes); burn window is exactly the remount gap; drag breaks
  on stun OR pilot death; deterministic under fixed seed.
- Acceptance: `npx vitest run tests/rig_pilot.test.ts tests/deeds_content.test.ts && npx vitest run tests/parity`.

### S5. The Sluiceworks flood beat (no module: ground-object channels plus a door flag)
- Goal: the drydock's two sea-lock wheels are ground objects on opposite galleries;
  opening each is a wardstone-style channel (ward-channel pattern, the same verb
  machinery as the S3 fuse cut) while the party holds ONE scripted crew response wave
  per wheel (fixed composition, no rng). Both wheels open: the lock gates part, the sea
  comes in, and the half-built galleon lurches off her blocks and launches a season
  early; the lock-gate `dungeon_door` to the deck unseals on the flood flag, and the
  signature inrush audio sting event emits (`SimEvent` union in `src/sim/types.ts:1393`
  area; the client plays the SFX). The party rides the rising water up to her deck: a
  scripted lift, render dressing on the fixed arena; sim space never moves.
- Files: hullworks.ts (wheel + lock-gate objects, response waves, flood flag),
  fuse/interaction glue reused from S3 (one wheel-channel call beside the ward-channel
  call), types.ts (one event variant), client SFX hook in the existing event handler
  path; NEW `src/render/hullworks_set.ts` (flood + scripted-lift dressing);
  `src/sim/content/deeds.ts` (She Never Sailed row: both wheels opened without a party
  death during the flood beat) plus deed catalog pins.
- Tests FIRST: deck door sealed before both wheels open, unsealed after; an opened
  wheel refuses re-opening; each wheel spawns its response wave exactly once per
  lockout; channel interruptible by damage; the beat draws no rng; She Never Sailed
  triggers only when both wheels open with zero party deaths during the beat.
- Acceptance: `npx vitest run tests/hullworks.test.ts tests/deeds_content.test.ts && npx vitest run tests/parity`.

### S6. Captain Ede Redwake, three phases (rising water as a cut-safe render slice)
- Goal: encounter module `src/sim/encounters/redwake.ts` (nythraxis.ts is the template):
  P1 Riposte stance windows (visible stance aura; frontal attacks during it reflect a
  cleave, positional check); P2 ALL HANDS waves (FIXED composition of surviving site
  crew types; the cleared-wing scaling died with the wings at pass 2) plus Broadside
  cone; P3 the flood you started reaches the gun deck: Waking-Fury-style soft-enrage
  ramp (tuning) as the ship settles lower, death line emits the sequel-hook text via a
  stable key. The RISING WATER is renderer-only: `src/render/hullworks_set.ts` raises
  the water dressing on the P3 event; sim space never moves (arena is the deck
  throughout). It is severable: if cut (open question 3), only the render slice drops.
- Files: NEW `src/sim/encounters/redwake.ts` + `tests/redwake.test.ts`; MODIFY
  `src/render/hullworks_set.ts` (P3 rising water); hullworks.ts (Redwake template +
  loot hook); NEW parity scenario `hullworks_redwake` in `tests/parity/scenarios.ts`
  (five seeded players, full three-phase kill) recorded with `UPDATE_PARITY=1` (new
  golden only; existing goldens must stay byte-identical).
  MODIFY `src/sim/content/deeds.ts` (Redwake first-kill and title rows) plus
  deed catalog pins.
- Tests FIRST: riposte reflects frontal attacks during stance, does NOT reflect
  rear attacks during stance, and does NOT reflect frontal attacks outside stance; phase
  thresholds exact; P2 wave composition is the fixed authored list (no wing-state
  reads); ramp makes an infinite turtle impossible; death emits the hook line event.
- Acceptance: `npx vitest run tests/redwake.test.ts tests/deeds_content.test.ts && npx vitest run tests/parity && npm run build`.

### S7. Loot (incl. the hat), heroic, i18n sweep, music, bot clear (PR B closeout)
- Loot: rares off bosses 1 and 2, one epic per class-armor lane off Redwake plus the
  boarding axe; every stat sum obeys `tests/item_level` budgets (compute the budget
  FIRST, exact numbers are authored here, tuning until then); "Redwake's Plumed Hat"
  cosmetic epic, low drop rate (tuning, Levy question 4). Icons via `gen-icon-art`
  (`src/ui/icons.ts` + `public/ui/items/mapping.json`); GLB props via `gen-3d-asset`;
  `CREDITS.md`.
- Heroic (RESOLVED 2026-07-26, maintainer direction): heroic mode ships at launch
  on the existing machinery only: the heroic difficulty flag, standing
  multipliers, and the automatic five-man heroic swap doing the loot (these
  13-to-15 drops are below the swap's upgrade floor, so heroic variants generate
  for free). No heroic-only mechanics, nothing bespoke to author.
- Deeds: earlier slices already carry the three first-kill rows, Dry Powder, She
  Never Sailed, and the Redwake title row. Nothing appends here (the Full Manifest
  meta row died with the five-boss scope at pass 2).
- Quest note: Odile's lead-in and its M16 work already landed in PR A's S4 closeout.
- i18n sweep checklist (nothing else catches these): English item-name rows;
  Redwake, the Sluiceworks, and PR B mechanic/aura names in the `sim_i18n.ts` matcher
  DICTs + `AURA_NAME_KEY` (Charwick and Hulljack rows landed in PR A's S4 closeout);
  enter/leave texts; death line; regenerated `i18n.resolved.generated/` committed.
- Music: `dungeon_hullworks` key in `music_tracks.ts` + track file (work-shanty over the
  Galecrest chord spine, site noise baked in); sluice inrush sting SFX from S5.
- Bot clear: `scripts/hullworks_raid.mjs` from the `crypt_raid.mjs` template; a full
  five-bot clear at level is the tuning acceptance (Slag Run rule: if bots cannot clear
  it, the tuning is wrong). Guide regen: `npm run wiki:content` + `guide.*` keys.
- Acceptance: `npx vitest run tests/item_level.test.ts tests/deeds_content.test.ts tests/localization_fixes.test.ts tests/i18n_completeness.test.ts tests/guide.test.ts && node scripts/hullworks_raid.mjs && npm run gate`; bot clear video/screenshots per the PR template.

## 4. Gotchas (read before every slice)

- **G1, SIM_LAP_PHASES pins the sim's emission list.** Every module that gains a
  `lap?.('name')` in sim.ts MUST append the same name to `server/game.ts:334`, AFTER the
  existing names (the base list stays byte-identical). Two pins land here: `fuseLines`
  (S3) and `rigPilot` (S4). The Sluiceworks beat has no module and no pin.
- **G2, the zone file is not yours.** galecrest.ts lives on the #2321 branch and its
  author may still be moving it. Every edit is additive (new poi row, new quest rows,
  comments); never re-shape existing exports. If #2321 has not merged when S1 starts,
  stop and re-check the base with the operator.
- **G3, parity.** New `ctx.rng` draws must live strictly inside Hullworks code paths
  (encounter state, instance band). One new golden (`hullworks_redwake`, S6) is added;
  if any EXISTING golden reds, the fix is the code, never `UPDATE_PARITY=1` on it.
- **G4, i18n ownership is split.** The closeout slices (S4, S7) add English item-name
  rows and any M16 five-locale prose fills. Maintainers fill remaining overlays before
  release. Aura/mechanic names have NO guard test; the closeout checklists are the
  only net.
- **G5, deeds are forever.** Ids and `DEED_ORDER` position are persisted identity;
  append at the end, never rename, never reorder.
- **G6, level-band risk.** Until Levy answers open question 1, do not author loot or XP
  rows (they are the band-sensitive parts); S1 to S6 mechanics survive a re-band.
- **G7, interior key.** S1 ships on `interior: 'crypt'`; a bespoke shipyard interior is
  a render/collider pair keyed off a new union member, land it with the S5 to S6
  set-piece work or not at all. Do not block the sim slices on art.

## 5. Fails-before evidence (contribution process)

Each slice's tests are written FIRST and shown failing on the pre-slice tree (the
sealed-door test fails before S1 wires the flag, the fuse test fails before S3 exists);
put the fails-before / passes-after output in each PR body per Levy's quality bar.
