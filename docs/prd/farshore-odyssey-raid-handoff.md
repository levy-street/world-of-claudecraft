# Implementation Handoff: The Far Shore Voyage (Gullhaven sailing raid)

| | |
|---|---|
| **Status** | INCUBATION, DRAFT STAGE 4 PACKET, excluded from the active implementation-handoff queue. Do not start slices until Levy explicitly approves the reduced three-boss raid core, the first dungeon and raid pipelines are proven, and the `feature/procedural-dungeons` branch (umbrella PR #1584) lands. Large content requires PBE. |
| **Portfolio lane** | Incubation. The packet is detailed enough to execute later, but detail is not approval or dispatch priority. |
| **Dispatch gate** | Levy approves the reduced raid core after the pipeline proof, and the `feature/procedural-dungeons` branch (umbrella PR #1584) lands. The low-tide assault is a separately approved post-raid extension and cannot delay or share the initial raid dispatch. |
| **Source PRD** | `docs/prd/farshore-odyssey-raid.md` (whole document; its File plan section is the file inventory this handoff schedules) |
| **Scope** | Initial raid core only: standard click-the-moored-ship entry, THREE bosses (Vessarine, the Name-Taker, Sereva) plus the non-boss Tenfold Sail launch and the open-sail prison-hulk rescue beat, ONE raid lockout id, the Beckoning lured-state primitive, in-instance ship/sail state, the vote with an aura-only Captain mantle, heroic mode on the existing difficulty and variant machinery, loot/deeds/i18n, music/fx, and bot tuning. The weekly low-tide assault is extension X1 outside this core. NOT in scope: the pass-2 to pass-4 cuts, town-side or cross-instance state, additional wings/routes, bespoke Captain buttons, trophy moves, Farshore leveling-content changes, and any $WOC or economy hook. |
| **Verified against** | `origin/release/v0.30.0` and `origin/feature/procedural-dungeons`, 2026-07-25 (heroic anchors re-verified 2026-07-26). Revalidate every anchor against the active branch before implementation; trust symbols, not line numbers. |
| **Executor routing** | Claude uses `extract-and-test` and `qa-checklist`; Codex uses the matching `$woc-*` skills. The GLB lane uses the `image-to-glb` skill (`.claude/skills/image-to-glb/SKILL.md`) plus `docs/image-to-glb-asset-workflow.md`. Icon and kit lanes are plain authoring work with no named skill. Sim, frontend, and cross-platform reviewers follow the changed surface. No slice depends on a named model. |

## 0. Ground rules

Rules 1 to 6 of `docs/prd/FRONTIER_PHASE1_HANDOFF.md` section 0 apply verbatim (sim purity,
Rng-only randomness, i18n, strict TS, Conventional Commits, command-anchored acceptance).
Deltas for this program:

1. Base branch: until the `feature/procedural-dungeons` branch (umbrella PR #1584) merges,
   every slice stacks on `origin/feature/procedural-dungeons` (the Farshore stage lives
   there); after it merges, on the active release branch. Never fork or edit files owned
   by the dependency branch.
2. Commit scope is `feat(voyage): ...`; branches `feature/voyage-s<N>`.
3. Every NEW per-tick sim module gets its `SIM_LAP_PHASES` pin in `server/game.ts` in the
   SAME slice as its tick call (gotcha G1); every NEW read surface ships as a
   `src/world_api/` facet in BOTH worlds with its `tests/world_api_parity.test.ts` pin in
   the SAME slice (G2).
4. Agent-completable policy is a hard invariant: no mechanic may demand a reaction faster
   than its telegraphed timer, and every mechanic's state (watch assignment, Beckoned walk
   target, vote options, deck orders) must be readable through IWorld, never visuals.
5. All tuning numbers in section 1 come from the PRD and are locked for PBE; do not retune
   them mid-slice.

## 1. Shared design constants (defined once in S1, imported everywhere)

```ts
// src/sim/content/farshore_voyage.ts
export const VOYAGE_RAID_SIZE = 10;            // one crew, one ship
export const VOYAGE_MIN_LEVEL = 20;
export const VOYAGE_LOCKOUT_ID = 'voyage';     // the ONE raid lockout id on meta.raidLockouts (pass 3)
export const WATCH_SWAP_SECONDS = 35;          // Vessarine verse cadence
export const LASH_CHANNEL_SECONDS = 2;         // ally lash-to-mast channel
export const BECKON_MAX_SECONDS = 8;           // lured walk expiry ceiling
export const NET_RETURN_SECONDS = 8;           // walk back from the boarding nets
export const CAPTAIN_ROUNDS = 3;               // Name-Taker elections per fight
export const ORDER_CYCLE_SECONDS = 12;         // Sereva order cadence
export const DECK_POST_COUNT = 10;             // fixed finale stations
export const NAMED_BOAT_COUNT = 4;             // Coalfast, Tam, Edda, Bram
export const CROWN_SHATTER_HP_PCT = 0.10;      // aurora finale trigger
```

Pass-2 scope cut (maintainer direction 2026-07-26): entry is the standard click-the-moored-ship
raid gate; NO cross-instance or single-crew systems. The bell relay, Gullhaven Answers skiffs,
previous-crew Wake Ship, and all town-side live state (hung sail, blue watchfire) are CUT.

**Future flourish:** A first-server-clear plaque would be realm-global persisted state,
which conflicts with the raid's no-cross-instance-state rail. It needs its own persistence
design, including a `server/` surface and serialize/load coverage, before it can be scheduled.

Pass-3 scope cut (maintainer direction 2026-07-26): ONE raid lockout id (per-wing
`voyage:` ids collapsed); Bells STAGED at the time (pass 4 then cut it outright, block
deleted); Wreck Train reduced to the single prison-hulk rescue, one tow-cable ground
object plus a ship-record flag (`TOW_CABLE_COUNT`, medicine skiff, powder barge, and the
later low-tide cargo choice deleted from raid scope); the recorder/
replayer (`src/sim/wake_doubles.ts`) CUT for a fixed class-to-reflection template map
(`INSPECTION_SECONDS` deleted; the whole wing then died at pass 4); the Captain's bespoke
command-ability kit cut (existing aura machinery only); scar-weakened posts and wreck
damage-absorbs cut (cosmetic scars only); heroic mode ADDED as a launch requirement on
the existing machinery (now S9).

Pass-4 scope cut (maintainer direction 2026-07-26: lame bosses out, a 2-to-3 boss raid
is fine): the Teeth crag wing and the Wake Doubles wing are CUT outright, and the entire
two-route system dies with them, INCLUDING the previously staged Bells follow-up (its
constants block is deleted; the route type and the per-wing counts are gone from section
1). The raid is THREE bosses (Vessarine, the Name-Taker, Sereva) plus the non-boss
Tenfold Sail launch and the open-sail prison-hulk rescue beat, which now rides the sail
between fights instead of living in a wing: one tow-cable ground object plus a ship-record
flag. The finale has no trophy moves at all: cosmetic ship scars only, and the rescued
captives cheer from a trailing boat inside the instance.

Extension X1 is the separately approved low-tide event. It owns its event-local aid choice
and persistence, never reads a raid-run cargo field, and cannot begin until after raid PBE.
The boarding-net soaked debuff is a movement tax only, never damage.

## 2. Verified hook-point map (branch column says where the anchor was verified)

| Concern | Branch | Anchor (re-find before editing) |
|---|---|---|
| Farshore stage | procedural-dungeons | `src/sim/content/farshore.ts`: Warden Coalfast NPC, `welcomeQuestId: 'q_fs_bell_at_the_landing'`, Gullhaven prose. Read-only stage; the raid plugs in, never edits |
| Raid lockout | release/v0.30.0 | `raidLockouts: Map<string, number>` on PlayerMeta in `src/sim/sim.ts`; checked/cleared in `src/sim/instances/dungeons.ts`; `meta.raidLockouts.set(lockId, until)` precedent in `src/sim/encounters/nythraxis.ts` (pass 3: the raid uses the ONE `voyage` id, never per-wing ids) |
| Instance entry | release/v0.30.0 | `export function enterDungeon(` in `src/sim/instances/dungeons.ts`; coverage pin `tests/dungeon_entry_clearance.test.ts` |
| Content shape | release/v0.30.0 | `interface DungeonDef` and `interface MobTemplate` in `src/sim/types.ts`; precedent module `src/sim/content/temple.ts`; merged via `export const MOBS: Record<string, MobTemplate>` in `src/sim/data.ts` |
| polymorphHex fallback | release/v0.30.0 | `polymorphHex?: { chance; duration; name; school? }` on MobTemplate in `src/sim/types.ts`; applied in `src/sim/mob/mob_swing.ts`; test `tests/mob_hex.test.ts` |
| SimContext seam | release/v0.30.0 | `src/sim/sim_context.ts`: `SimContextPrimitives` (readonly `rng`), `SimContextCallbacks` (`error(pid, text, reason?)`); `ctx.spawnBossAdds` precedent `src/sim/delves/drowned_litany_boss.ts` |
| Tick phase pin | release/v0.30.0 | `export const SIM_LAP_PHASES = [` in `server/game.ts` (entries like `'worldBosses'`, `'instances'`, `'lootRolls'`) |
| Weekly scheduler | release/v0.30.0 | `src/sim/world_boss.ts`: `WORLD_BOSSES`, `WORLD_BOSS_INTERVAL_SECONDS`, `WORLD_BOSS_LOCKOUT_PREFIX` (lockout keys ride `raidLockouts`) |
| Heroic mode (pass 3) | release/v0.30.0 | Difficulty: `DungeonDifficulty` in `src/sim/types.ts`; `HEROIC_DUNGEON_TUNING` in `src/sim/content/dungeon_difficulty.ts`; `HEROIC_DUNGEON_IDS`, `mobTemplateForDungeonDifficulty`, `applyDungeonMobTuning` in `src/sim/instances/difficulty.ts`; `isDungeonDifficulty` + `sim.setDungeonDifficulty` wired via `case 'set_dungeon_difficulty'` in `server/game.ts`. Loot: `heroicVariantId()` (`heroic_<id>`) and `buildHeroicVariants()` in `src/sim/content/heroic_variants.ts` (`heroicOf` drives the tooltip [HEROIC] tag, never a name prefix); Nythraxis heroic raid precedent `NYTHRAXIS_RAID_BOSS_ID` + `NYTHRAXIS_RAID_LOOT_SOURCE_LEVEL` (27) in `src/sim/content/heroic_loot.ts` |
| IWorld facets | release/v0.30.0 | `src/world_api/` directory (per-facet interfaces; `interaction.ts` exposes `interact()`; `deeds.ts` exists); pin file `tests/world_api_parity.test.ts` (facet key-sets + `COMMAND_NAMES`/`COMMAND_FACETS`) |
| ClientWorld + wire | release/v0.30.0 | `src/net/online.ts` `applySnapshot`/`applyWire`; `function identityFields(e: Entity)` in `server/game.ts`; self-delta `maybe()` pattern (`maybe('lrollg', this.sim.lootRollGroupStatus(...))`) |
| Group vote precedent | release/v0.30.0 | `src/sim/loot/loot_roll.ts` (finite-choice group prompt, `'lootRolls'` phase, group status on the wire) |
| Interact verb | release/v0.30.0 | `export function interact(` in `src/sim/interaction.ts` (lash, deck posts, the hulk tow cable all route here) |
| Channel state | release/v0.30.0 | `channeling`/`channelTimer`/`channelTicksLeft` on the entity in `src/sim/entity.ts`; cast lifecycle in `src/sim/combat/casting_lifecycle.ts` |
| Boss barks | release/v0.30.0 | boss bark lines broadcast as `'yell'`-channel chat (`src/sim/types.ts`) |
| Sim i18n matcher | release/v0.30.0 | `const AURA_NAME_KEY` in `src/ui/sim_i18n.ts`; English item names in `src/ui/i18n.catalog/items.ts`; release overlay ownership in root `CLAUDE.md` |
| Icons | release/v0.30.0 | `export const ITEM_IMAGE_IDS` in `src/ui/icons.ts`; `public/ui/items/mapping.json` |
| Music | release/v0.30.0 | `ZONE_STREAM_URLS`/`COMBAT_STREAM_URLS` in `src/game/music_tracks.ts`, keyed by `MusicZone` from `src/game/music.ts` (`musicZoneForLocation`); consumer `src/game/instance_music.ts` |
| Parity goldens | release/v0.30.0 | `tests/parity/` per its CLAUDE.md; mint via `UPDATE_PARITY=1 npx vitest run tests/parity` in its own reviewed commit |
| Deeds | release/v0.30.0 | `export const DEEDS: Record<string, DeedDef>` in `src/sim/content/deeds.ts`; pins `tests/deeds_content.test.ts`; facet `src/world_api/deeds.ts` |

NOT verified (no precedent exists; genuinely new): a server-driven forced-walk movement
state (searched `feared`/`forcedMove`/knockback: only a `knockbackResistance` scalar and the
polymorphHex incapacitate exist); S4 owns it. The other two no-precedent items (bell-relay
store, wake recorder) were cut at pass 2 and pass 3 respectively.

## 3. Slices

Core dependency order: S1 -> S2 -> S3 -> S4 -> S5 -> S6 -> S7 -> S8 -> S9 -> S10 ->
S11. S6 (the vote) is independent once S2 lands. S9 (heroic) needs S7's encounters and
S8's items. Extension X1 begins only after the core clears PBE and receives separate Levy
approval; it is not in the core dependency chain.

PR boundaries: A = S1-S2, B = S3-S4, C = S5, D = S6, E = S7, F = S8-S9,
G = S10-S11. X1 is its own later contribution. Do not land a partial boundary. Every
boundary that introduces a boss
or event includes its Deeds rows and `tests/deeds_content.test.ts` pins (S8 holds only
cross-program meta deeds); its final slice also carries English catalog and any M16 work,
sim matcher rows, wiki regen, credits/provenance for that PR's assets, and this closeout:
`npx vitest run tests/deeds_content.test.ts tests/localization_fixes.test.ts tests/guide.test.ts && npm run wiki:content`.

### S1. Instance shell, content module, the one lockout
- Goal: a ten-player, level-20 voyage instance you can enter from Gullhaven with the single raid lockout, no mechanics yet.
- Arena model (the PRD's "one ship, one arena" section, binding for every later slice): the instance map holds THREE dressed copies of ONE deck collider layout at fixed grid locations (strait deck with sea-stack geometry, open-water deck, harbor deck with room for the NPC boats). Sailing between legs is a scripted whole-raid teleport to the next deck copy when the prior encounter ends (the standard party-move machinery), wrapped in departure/arrival beats. Nothing in sim space ever moves, nobody steers, players never leave the deck (rails plus boarding nets are the boundary). S1 stamps the three decks and the leg-transition teleports with placeholder dressing.
- Files: NEW `src/sim/content/farshore_voyage.ts` (section 1 constants, DungeonDef-style records carrying the ONE `VOYAGE_LOCKOUT_ID` on `meta.raidLockouts` (pass 3: per-wing ids collapsed), the three deck stamps and leg-transition records, the three placeholder boss MobTemplates, the on-ramp quest; `temple.ts` is the shape precedent); MODIFY `src/sim/data.ts` (merge), `src/sim/instances/dungeons.ts` only if the raid-size gate needs a new guard.
- Reused: enterDungeon flow, `raidLockouts`, dungeon clearance test harness. NEW: the content module only.
- Tests first: NEW `tests/farshore_voyage.test.ts` (entry gated at level 20, party size cap 10, the single lockout set on the final boss kill, a run inside the lockout is loot-locked per the world-boss lockout precedent); extend `tests/dungeon_entry_clearance.test.ts` coverage.
- Acceptance: `npx vitest run tests/farshore_voyage.test.ts tests/dungeon_entry_clearance.test.ts tests/architecture.test.ts && npx vitest run tests/parity` (untouched), then `npm run gate` once as the shell milestone.

### S2. Voyage ship state + Tenfold Sail (the launch, not a boss)
- Goal: one persistent per-run ship record (sail panels, cosmetic scars, hulk flag) that the launch ceremony fills and every later encounter reads.
- Files: NEW `src/sim/voyage_ship.ts` (SimContext module: `VoyageShipState { panels, scars (cosmetic only, pass 3), hulkRescued: boolean }`, panel derivation from class+weapon+color), NEW `src/render/voyage_ship.ts` (ship mesh, sail compositing, called by the renderer, never a method bank); MODIFY `src/sim/sim.ts` (thin tick call), `server/game.ts` (SIM_LAP_PHASES pin), `src/sim/content/deeds.ts` (Tenfold Sail launch rows) plus deed pins; NEW `src/world_api/voyage.ts` facet (sail/ship read state) implemented in BOTH `Sim` and `src/net/online.ts`, pin in `tests/world_api_parity.test.ts`.
- Reused: manifest read as `'yell'` barks; wire self-delta via `maybe()`. NEW: ship state module, render module, facet.
- Tests first: NEW `tests/voyage_ship.test.ts` (ten panels derive deterministically from the roster, agents and humans identically; scars persist across encounters and change no numbers; `hulkRescued` stays false until S5; no town-side or extension state exists).
- Acceptance: `npx vitest run tests/voyage_ship.test.ts tests/deeds_content.test.ts tests/world_api_parity.test.ts tests/architecture.test.ts && npx vitest run tests/parity`.

### S3. Watches, Vessarine's verse (Boss 1, navigation half)
- Goal: the raid alternates two five-player watches every 35 seconds, each seeing a disjoint information set while keeping full combat agency.
- Files: NEW `src/sim/voyage_watches.ts` (assignment, 35 s swap timer on sim time, per-watch visibility flags); MODIFY `src/world_api/voyage.ts` (own watch + fog state), both worlds, parity pin; `server/game.ts` (interest filtering honors the watch flags server-side before viewer-neutral payloads are cached; any field-level divergence uses a session-specific payload; the fogged route never ships).
- Reused: snapshot interest scoping. NEW: watch split. Fairness note: the split is a MECHANIC, not a graphics tier; it is exempt from the graphics-fairness rule because both watches get actionable, complementary state by design.
- Review cost: per-player divergent scoping is new behavior around the `identityFields`/`dynamicFields` wire, must preserve shared-cache correctness, and needs a bandwidth glance in review.
- Tests first: NEW `tests/voyage_watches.test.ts` (swap at exactly `WATCH_SWAP_SECONDS`; the two watches partition the raid 5/5; a Current Watch client snapshot omits deck-only state and vice versa; sequential snapshots swapping both directions clear previously visible watch state from ClientWorld; byte-level snapshots never contain the other watch's privileged fields; determinism across two seeded sims).
- Acceptance: `npx vitest run tests/voyage_watches.test.ts tests/snapshots.test.ts tests/bandwidth.test.ts && npx vitest run tests/parity`.

### S4. The Beckoning lured state (Boss 1, chorus half)
- Goal: the one NEW sim primitive: a state that replaces a player's movement input with a slow server-driven walk toward a point, breakable by lash interact, Siren interrupt/death, or expiry.
- Sub-decision (blocked on Levy, open question 2): if the walk module is not funded, ship the fallback in this same slice: the Beckoning applies the existing `polymorphHex`-style incapacitate (raider stands entranced, interrupt/lash counters intact, no walk). Build the module API so both resolutions sit behind one `applyBeckon(ctx, target, source)` entry; the fallback is a config flag, not a fork.
- Files: NEW `src/sim/beckoning.ts` (`BeckonState { targetPos, sourceId, expiresAt }`, walk driven in the module tick, `BECKON_MAX_SECONDS` ceiling, `LASH_CHANNEL_SECONDS` lash via `src/sim/interaction.ts`, net catch + `NET_RETURN_SECONDS` walk-back + soaked movement debuff, never damage); MODIFY `src/sim/sim.ts` (tick call), `server/game.ts` (SIM_LAP_PHASES pin), `src/sim/types.ts` (SimEvent variants `beckoned`/`beckonBroken`), `src/sim/content/deeds.ts` (Vessarine rows) plus deed pins, facet read state (Beckoned walk target visible to agents), both worlds, parity pin.
- Reused: channel machinery for the lash, interaction.ts for the interact, aura plumbing for soaked. NEW: forced-walk movement (no precedent exists, see section 2).
- Tests first: NEW `tests/beckoning.test.ts` (input ignored while Beckoned; lash channel breaks it; Siren interrupt OR death breaks it; expiry walks into the net, `NET_RETURN_SECONDS` return, no fall damage, no death; open-world entities can never be Beckoned; fallback flag degrades to incapacitate with the same counters).
- Acceptance: `npx vitest run tests/beckoning.test.ts tests/mob_hex.test.ts tests/deeds_content.test.ts && npx vitest run tests/parity`; mint the Vessarine parity scenario with `UPDATE_PARITY=1` in its own commit.

### S5. The open-sail hulk rescue beat (between fights, not a boss)
- Goal: the single prison-hulk rescue riding the sail between encounters (pass 4: the Teeth encounter and the route system are cut; the rescue survives on the open sail as one tow-cable ground object plus a ship-record flag).
- Files: MODIFY `src/sim/content/farshore_voyage.ts` (the prison hulk: ONE tow-cable ground object whose `interact()` slows ship repairs for a stretch, frees the captives, and sets the ship-record flag), `src/sim/voyage_ship.ts` (`hulkRescued` persists for the run; captives transfer to a trailing rescue boat inside the instance), `src/sim/content/deeds.ts` (rescue rows, the full-rescue gull-pet feed) plus deed pins, facet, both worlds, parity pin.
- Reused: `interact()` for the cable, ground-object patterns from temple.ts. NEW: nothing engine-side.
- Tests first: extend `tests/farshore_voyage.test.ts` (hooking the hulk slows repairs, frees captives, sets the flag, and produces the in-instance trailing boat; skipping the hulk leaves the flag false and no boat; no town-side state or low-tide field is written; all rng draws stay inside voyage code paths).
- Acceptance: `npx vitest run tests/farshore_voyage.test.ts tests/voyage_ship.test.ts tests/deeds_content.test.ts && npx vitest run tests/parity && npm run gate` (mid-program milestone).

### S6. The vote (Boss 2, the Name-Taker's Mutiny)
- Goal: three deterministic election rounds where the raid answers "WHO COMMANDS YOU?" from the ten crew names, majority becomes Captain, used names strike out. The Captain's mantle is EXISTING aura machinery only: enormous boss threat plus a defensive buff for the phase (pass 3: the bespoke command-ability kit is cut).
- Files: NEW `src/sim/voyage_vote.ts` (`CAPTAIN_ROUNDS` rounds, finite clickable option set exposed in structured state, majority tally, ties and silence resolve deterministically: lowest crew-slot index wins, abstain counts nothing, no rng); MODIFY `src/sim/sim.ts` + `server/game.ts` (tick call + SIM_LAP_PHASES pin), `src/sim/content/deeds.ts` (Mutiny rows) plus deed pins, facet (options + tally + struck names), both worlds, parity pin; UI answer strip follows the loot-roll prompt pattern (`src/sim/loot/loot_roll.ts` + its wire status is the template), pure view module per the HUD recipe.
- Reused: loot-roll group prompt shape, `/say` chat emit for the transcript, existing aura plumbing for the mantle. NEW: election module. No free-text parsing anywhere (PRD non-goal).
- Tests first: NEW `tests/voyage_vote.test.ts` (majority elects; struck names cannot repeat; three rounds elect three different captains; tie and full-silence cases resolve identically on two seeded sims; the Captain gains the threat + defensive mantle aura for the phase only, and no new ability ids exist).
- Acceptance: `npx vitest run tests/voyage_vote.test.ts tests/deeds_content.test.ts tests/world_api_parity.test.ts && npx vitest run tests/parity`.

### S7. Finale: Sereva, allied boats, deck orders (Boss 3)
- Goal: the return-leg finale: `ORDER_CYCLE_SECONDS` orders against `DECK_POST_COUNT` fixed posts, four named NPC boats (scripted in-instance set pieces), and the `CROWN_SHATTER_HP_PCT` aurora across the instance sky. Pass 3: ship scars are COSMETIC only; scar-weakened posts and wreck damage-absorbs are cut. Pass 4: no trophy moves at all; the rescued hulk captives cheer from a trailing boat (scripted set piece).
- Files: MODIFY `src/sim/content/farshore_voyage.ts` (Sereva encounter: HOLD COURSE / CUT THE COIL / OPEN THE LENS order records, failure damages a known ship section, never a reflex-kill; allied boats never provide required damage; the captives' trailing cheer boat when `hulkRescued` is set), `src/sim/voyage_ship.ts` (cosmetic scar records only), `src/sim/content/deeds.ts` (Sereva first-clear rows) plus deed pins; NEW `src/render/voyage_fx.ts` (aurora, INSTANCE-ONLY, cosmetic, passes graphics fairness).
- Reused: encounter module precedent (`src/sim/encounters/nythraxis.ts`) and boss `'yell'` barks. NEW: order/post system, fx module. CUT at pass 2: previous-crew Wake Ship, responder skiffs, hung sail, blue watchfire (single-crew assumptions).
- Tests first: extend `tests/farshore_voyage.test.ts` (HOLD COURSE, CUT THE COIL, and OPEN THE LENS each pass independently and each damage their own mapped section on failure; scars accumulate but change no combat numbers; the trailing cheer boat appears only when `hulkRescued` is set and contributes nothing mechanical; the fight is completable with the NPC boats contributing zero required damage).
- Acceptance: `npx vitest run tests/farshore_voyage.test.ts tests/deeds_content.test.ts && npx vitest run tests/parity && npm run gate` (raid-complete milestone); mint the finale parity scenario via `UPDATE_PARITY=1` in its own commit.

### S8. Loot, deeds, i18n sweep
- Goal: finish Glasswake loot, remaining meta deeds, and contributor-owned localization without repairing obligations from earlier content slices.
- Files: MODIFY `src/sim/content/farshore_voyage.ts` (rift-glass gear, one weapon per armor class off Sereva, gull shoulder pet for full hulk-rescue runs; numbers follow the existing level-20 stat budget rules exactly, compute the budget first), `src/sim/content/deeds.ts` (append remaining cross-program meta rows), `src/ui/sim_i18n.ts` (PR G loot/meta matcher rows only; earlier boss and quest rows already landed at their boundaries), `src/ui/i18n.catalog/items.ts` for English item names (G3), regenerated `src/ui/i18n.resolved.generated/*`, `src/ui/icons.ts` ITEM_IMAGE_IDS + `public/ui/items/mapping.json` through plain icon authoring work, guide regen.
- Tests first: extend `tests/deeds_content.test.ts` pins plus `tests/item_level.test.ts` and `tests/item_level_req.test.ts` budget checks before authoring items.
- Acceptance: `npx vitest run tests/deeds_content.test.ts tests/i18n_completeness.test.ts tests/localization_fixes.test.ts tests/guide.test.ts && npm run wiki:content && npm run gate`.

### S9. Heroic mode (pass 3: launch requirement, existing machinery only)
- Goal: heroic difficulty rides the shipped machinery end to end: the heroic flag per the dungeon_difficulty pattern, boss stats tuned by the standing heroic multipliers, loot through the heroic RAID variant tier. No heroic-only mechanics in v1: heroic is numbers and loot, per the shipped convention. Exact ilvls follow the PRD's tier-position decision.
- Files: MODIFY `src/sim/content/dungeon_difficulty.ts` (voyage rows in `HEROIC_DUNGEON_TUNING`), `src/sim/content/heroic_variants.ts` (voyage bosses join the raid-tier list so `buildHeroicVariants` derives `heroic_<id>` items via `heroicVariantId`, the `NYTHRAXIS_RAID_BOSS_ID`/`NYTHRAXIS_RAID_LOOT_SOURCE_LEVEL` precedent in `src/sim/content/heroic_loot.ts`), `src/sim/content/farshore_voyage.ts` (heroic flag on the instance records only).
- Reused: `DungeonDifficulty` + `isDungeonDifficulty`/`setDungeonDifficulty` (already wired in `server/game.ts`), `mobTemplateForDungeonDifficulty`/`applyDungeonMobTuning`/`HEROIC_DUNGEON_IDS` in `src/sim/instances/difficulty.ts`. NEW: nothing; content rows only.
- Tests first: extend `tests/farshore_voyage.test.ts` (heroic entry tunes boss stats by the standing multipliers; heroic Sereva drops the `heroic_` raid-tier variants; normal drops unchanged; the heroic run shares the same single `VOYAGE_LOCKOUT_ID`); extend the item budget pins in `tests/item_level.test.ts` and `tests/item_level_req.test.ts` if they cover variants.
- Acceptance: `npx vitest run tests/farshore_voyage.test.ts tests/deeds_content.test.ts && npx vitest run tests/parity`.

### S10. Music and models
- Goal: per-boss music (plus the sail theme) and the ship/naga/prop asset kit.
- Files: MODIFY `src/game/music.ts` (new `MusicZone` cues for the sail and each boss), `src/game/music_tracks.ts` (`ZONE_STREAM_URLS` rows), `src/game/instance_music.ts` (routing); NEW `public/audio/music/` tracks, `public/models/` GLBs via the `image-to-glb` skill (`.claude/skills/image-to-glb/SKILL.md`) plus `docs/image-to-glb-asset-workflow.md` (Glasswake visual signature: cobalt rift-glass crown plus red sailcloth streamer on every unit), `CREDITS.md`. Remaining kit work is plain authoring with no named skill.
- Tests first: extend `tests/music.test.ts`, `tests/music_tracks.test.ts`, and `tests/instance_music.test.ts` with the exact voyage zone and boss routing rows; the media manifest regenerates via the build (never hand-edit it).
- Acceptance: `npx vitest run tests/music.test.ts tests/music_tracks.test.ts tests/instance_music.test.ts && npm run build`; in-game listen on `npm run dev` (headless screenshot workflow for the PR evidence).

### S11. Bot-raid tuning pass
- Goal: prove agent-completability end to end (normal and heroic) and tune timers only where a scripted crew fails.
- Files: NEW `scripts/voyage_bot_raid.mjs` (drives 10 clients through a full clear on a dev server with `ALLOW_DEV_COMMANDS=1`, dev only, never production); tuning edits confined to `src/sim/content/farshore_voyage.ts` constants.
- Tests first: the script IS the test; every encounter must clear with agents alone reading only IWorld state on the section 1 timers.
- Acceptance: `node scripts/voyage_bot_raid.mjs`; full scripted clear recorded; `npm run gate` final milestone; then the PBE handoff per the rollout section of the PRD.

## Extension X1. Low-tide assault, separate approval after raid PBE

- Goal: a weekly level 3 to 7 Ferrywalk defense with villager rescues and event-local aid
  choices. It is not part of the initial raid contribution and never reads raid-run state.
- Gate: the raid core has shipped through PBE, Levy separately approves this extension,
  and the extension re-verifies the Farshore zone anchors against the active release branch.
- Files: NEW `src/sim/lowtide_assault.ts` (weekly cadence on the world-boss scheduler
  pattern, phalanx spawns, one Siren per phalanx Beckons Gullhaven villagers only, never
  players, rescue channel, event-local timber/oil/medicine aid choices); MODIFY
  `src/sim/sim.ts` + `server/game.ts` (one tick call and lap pin), deeds plus pins, one event
  read facet, both worlds, and the parity pin.
- Reused: world-boss scheduler and S4's Beckon module villager arm. NEW: the event module.
- Tests first: NEW `tests/lowtide_assault.test.ts` (event never scales past the 3 to 7 band;
  villagers are Beckoned, players never are; each event-local aid choice changes the
  defense; no raid lockout or voyage state is read; the event runs with zero raiders).
- Acceptance: `npx vitest run tests/lowtide_assault.test.ts tests/deeds_content.test.ts tests/architecture.test.ts && npx vitest run tests/parity && npm run gate`.

## 4. Gotchas (read before every slice)

- **G1, SIM_LAP_PHASES is a pinned list.** Every per-tick module added here (`voyage_ship`,
  `voyage_watches`, `beckoning`, `voyage_vote`; exactly these four in the raid core, the
  pass-4 wing cuts add none) needs its phase entry in `server/game.ts` in the same slice
  as its tick call or the profiler pin test reds; base lap names stay first. X1 adds
  `lowtide_assault` only in its separately approved contribution.
- **G2, every read surface is a three-part change.** New facet in `src/world_api/`,
  implementation in BOTH `Sim` and `ClientWorld` (`src/net/online.ts`), and the pins in
  `tests/world_api_parity.test.ts`. Missing any leg fails the pin or ships a behavior fork.
- **G3, i18n ownership is split.** Contributor slices add English item-name rows and five
  non-Latin fills for M16 prose. Maintainers fill remaining locale overlays before release.
  Never put copied English in an overlay.
- **G4, parity goldens.** One `ctx.rng` draw on a shared code path shifts draw order and
  reds every golden. All voyage draws stay inside voyage-only code paths; each new
  scenario's golden is minted with `UPDATE_PARITY=1` in its own reviewed commit; never
  regenerate an existing golden to hide a diff.
- **G5, deterministic draw-order discipline inside the raid too.** The vote must resolve
  without rng (the lowest-slot tie-break) or two hosts diverge; where an encounter does
  draw (loot), draw in one fixed module order per tick.
- **G6, the stage is read-only.** `src/sim/content/farshore.ts` and the rift siege quests
  belong to the `feature/procedural-dungeons` branch (umbrella PR #1584); the raid adds
  siblings, never edits.
- **G7, worktree discipline.** The shared checkout carries uncommitted WIP; build each slice
  in a fresh worktree off the base branch (`feature/voyage-s<N>`) and re-merge it as it moves.

## 5. Dispatch note

Do not dispatch any slice while the Status row says INCUBATION. When unblocked, hand each owner
the slice block, section 0 rules, section 1 constants, its hook-map rows, the gotchas, and
the acceptance commands. Require fails-before/passes-after evidence for every test written
first, exact command output, and a `qa-checklist` pass. S1, S5, S7, S8, and S11 end with `npm run gate`.
