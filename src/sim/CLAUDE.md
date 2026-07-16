<!-- src/sim only (excluding content/ and professions/, each with its own
     CLAUDE.md). The one-sim-three-hosts architecture, the determinism/dependency
     invariants, and build/test commands live in the root + src CLAUDE.md, don't
     repeat them here. This file is the practical map of the deterministic core. -->

# src/sim - the deterministic game core

The host-agnostic source of truth: tick loop, combat, abilities/auras, mob AI +
aggro/leash, parties, duels, arena, trade, market, dungeon instances, terrain,
and the RL observation surface. Same code runs offline / on the server / headless.

## Shape of the core: a thin coordinator plus system modules behind one seam
Each self-contained game SYSTEM lives in its own sibling module, and `sim.ts` is a
thin **coordinator**: it owns the world clock, the tick-phase order, the per-player and
per-entity loops, the shared entry points, the `IWorld` facade, and persistence, and it
calls out to the system modules. Those modules never reach into `Sim` internals; they
talk only to the **`SimContext` seam** (`sim_context.ts`).

- **State stays on `Sim`.** The modules hold FUNCTIONS, not state. Entities, the spatial
  grids, `delayedEvents`, `groundAoEs`, arena/duel/trade/delve/market/loot collections,
  and the pet stash are all still `Sim` fields, exposed to the modules as LIVE views on
  `SimContext` (multi-`Sim` isolation + the server's public seam depend on this).
- **`Sim` keeps thin same-named delegates** wherever a foreign caller (the `IWorld`
  surface, `server/`, `headless/`, tests) resolves a method on the `Sim` facade. The
  delegate forwards into the owning module via `this.ctx`.
- Relocations are MOVES, not rewrites: behavior stays byte-identical, proven by the
  golden-trace + rng-draw-order parity gate (`tests/parity`).

## Key files
- **`sim.ts`**: the **coordinator** (`class Sim`). `tick()` is a registry of system
  calls (see the coordinator map below). Also holds the `IWorld` facade delegates, the
  back-compat accessors, the inventory hub (`addItem`/`removeItem`/`countItem`),
  persistence (`serializeCharacter`/`addPlayer`), the shared combat entry points, and
  `buildSimContext()` (binds every `SimContext` callback). Large by design.
- **`sim_context.ts`**: **the seam.** `SimContext` = live primitive views (`rng`/`time`/
  `entities`/`players`/grids/the shared collections) + the cross-system callbacks. The
  file's comments are the authoritative callback registry (signature + which slice owns
  each). Append-only: add callbacks, never rename or repurpose one.
- **`types.ts`**: ALL shared types AND the global tuning constants + classic-era formulas (`TICK_RATE`, `DT`, `GCD`, ranges, `XP_TABLE`, hit/armor/rage math, post-cap `virtualLevel`/prestige). Plus the `SimEvent` union and the `Entity` shape.
- `data.ts`: merges `content/*` into the flat tables (`ABILITIES`, `MOBS`, `NPCS`, `QUESTS`, `ITEMS`, `CAMPS`, `DUNGEONS`) and owns world-layout consts (`WORLD_SIZE`, `instanceOrigin`, `arenaOrigin`, `zoneAt`, `dungeonAt`).
- `entity.ts`: `createPlayer/createMob/createNpc/createGroundObject` + `recalcPlayerStats` (the ONE place derived stats are computed from class/level/gear/auras/talent `mods`).
- `player_motion.ts`: the pure player-movement kernel (`stepPlayerMotion`: turn integration, wish vector, slope gates, swept static collision, the vertical pass) plus `moveSpeedMult`/`jumpMult`/`isSwimming` and the locomotion-feel constants. `Sim.updatePlayerMovement` wraps it behind `PlayerMotionDeps` (fiesta speed, delve-aware `resolveMove`, cast/damage callbacks); the online display-only self extrapolator (`src/render/self_motion.ts`) binds pure/no-op deps so BOTH hosts run the same math, pinned by `tests/player_motion.test.ts` (client-dep-shape vs live-Sim parity, bit for bit). Changing movement here means keeping that parity test green.
- `entity_roster.ts`: roster ops the coordinator drives: `addEntity`/`dropEntity`/`rebucket`, despawn decay, the delayed-event drain, and the ground-AoE tick. Keeps only the delve release arm (`releaseSpiritInDelve`); the general death/release system is `spirit.ts` (see the module table).
- `rng.ts`: `class Rng` (mulberry32) + stateless `hash2/noise2/fbm2` for terrain.
- `world.ts`: `groundHeight`/`terrainHeight` (pure fn of x,z,seed), `WATER_LEVEL`, `generateDecorations`. **Renderer samples the same fns**: keep them identical. The voxel layer below derives from them too.
- `voxel.ts` + `voxel_mesh.ts`: the true-3D voxel density field layered over the `world.ts` heightfield, plus its chunked mesher. Tunnels/overhangs come ONLY from hand-authored capsules in `content/tunnels.ts` subtracted from solid terrain; away from a tunnel the field's surface must stay byte-identical to `terrainHeight`, so a heightfield edit is also a voxel edit. Engine-only so far (proven by tests, not yet wired into the renderer; `colliders.ts`/`pathfind.ts` are still heightfield-only).
- `colliders.ts`: `resolvePosition` (static collision + slide); reads `PROPS` and the dungeon/arena layouts.
- `dungeon_layout.ts`: plain-number interior layouts; single source for BOTH render geometry and `colliders.ts` interior sets.
- `pathfind.ts`: local A* (`findPath`); the player-tuned wrapper `findPlayerPath` (body radius, climb, swim) is what warrior Charge calls via `findChargePath`.
- `threat.ts`: classic-era hate-table math (`addThreat`, `threatModifier`, taunt, stealth detection). Already pure; modules import it directly.
- `spatial.ts`: `SpatialGrid` entity hash for radius queries; re-bucketed at end of tick. Pure; imported directly.
- `format_money.ts`: the sim's plain-English money formatter (`"3g 5s"` fragments for loot/quest/vendor/market emit text). A leaf module so `sim.ts`, `market.ts`, and `loot/loot_roll.ts` share it without a value-cycle. NOT the i18n `formatMoney` (see Player-facing text).
- `obs.ts`: RL surface: `ACTIONS`/`applyAction`/`encodeObs`/`obsSize`. Consumed by `headless/` + `python/` (see those dirs).

## System modules behind SimContext (who owns what)
Each module owns the FUNCTIONS for one system; the backing STATE stays on `Sim` as live
`ctx` views, and `Sim` keeps thin delegates where a foreign caller resolves the method.

| Module | Owns |
|--------|------|
| `combat/damage.ts` | `dealDamage`, `handleDeath`, `grantXp` (+ lifetime-XP; milestone unlocks absorbed into `deeds.ts`) |
| `combat/heal.ts` | `applyHeal`, healing threat/taken-mult, hex/crit-vuln mults, heal-absorb |
| `combat/auras.ts` + `combat/cc.ts` | per-tick auras/regen/timers, NPC aura cleanse; CC predicates (stun/root/silence/disarm/lockout/blind/tongues) |
| `combat/casting_lifecycle.ts` | `updateCasting`, `castAbility(BySlot)`, `cancelCast`, `pushbackCast`, GCD/cost/cooldown |
| `combat/effect_dispatch.ts` | `runEffects` (the per-effect switch) |
| `combat/auto_attack.ts` | start/stop/update auto-attack, `meleeSwing`, `rangedSwing` |
| `combat/equip_procs.ts` + `combat/set_procs.ts` | legendary weapon on-action procs; item-set bonus procs |
| `combat/empower_next.ts` + `combat/thorns_charge.ts` | next-cast empower/free aura consumption; charge-limited thorns |
| `projectile_travel.ts` | in-flight homing projectiles: `pendingProjectiles` + the prologue `advancePendingProjectiles` phase |
| `progression/xp.ts` | `prestige`, rested-XP, `isResting` |
| `progression/talents.ts` | `applyTalents`/`spendTalent`/`setSpec`/`respec`/loadouts/`recomputeTalents` |
| `mob/targeting.ts` | `updateMobTarget`, `retargetMob`, highest-threat target, trivial-target check |
| `mob/combat_profile.ts` | mob combat profile selection, effective melee reach, and the general chase/attack profile runner |
| `mob/locomotion.ts` | `updateMob` dispatcher, `resetEvadingMob`, flee recovery, spawn-block; `onBossDeath` points-at `encounters/nythraxis` |
| `mob/mob_swing.ts` | the mob on-hit affix cascade (`runMobSwingAffixes`); the base hit-table shell stays on `Sim` |
| `mob/lifecycle.ts` | `respawnMob`, despawn summoned adds, frenzy packmates, death-throes, corpse detonate |
| `mob/social_aggro.ts` + `mob/yells.ts` | flee-for-help rally pull; boss bark broadcast (`MobTemplate.yells`) |
| `encounters/nythraxis.ts` | the whole Nythraxis raid encounter (per-tick driver, reset/wipe/init, dialogue scheduler, adds + boss mechanics, the Aldric transition + wardstones, the relic/grave-vision quest chain, the encounter CC-immunity predicates) |
| `world_boss.ts` | hourly world bosses: spawn/scale/announce, contributor tracking, personal loot (`rollWorldBossLoot`), per-boss loot lockouts |
| `spirit.ts` | death/release/resurrection: graveyards + spirit healers, the ghost run, `releasePlayerSpirit`/`resurrectAtCorpse`/`resurrectAtSpiritHealer` (sickness rules live in the `resurrection.ts` leaf) |
| `pet/pet_ai.ts` | `updatePet`, follow, ranged attack, target pick |
| `pet/pet_commands.ts` | the pet command surface + `petOf`/`summonPet`/tame/despawn/`syncPetLevel`/`serializePet`/`restorePet` and the delve pet-park round-trip (`stowPetForDelve`/`restorePetFromDelveStash`) |
| `items.ts` | equip/use/discard + vendor buy/sell/buyback command bodies (W2 move out of `sim.ts`) |
| `interaction.ts` | `lootCorpse`/`pickUpObject`/`interact` + corpse harvest and party auto-loot (W3) |
| `bags.ts` | pooled bag capacity: the backpack plus equipped bag items raise one flat slot budget |
| `quests/quest_credit.ts` | kill/collect quest credit + turn-in readiness |
| `quests/quest_commands.ts` | accept/abandon/turn-in verbs + `queueQuestLetter` (W4; dev arm in `quests/dev_quest_commands.ts`) |
| `instances/dungeons.ts` | door triggers, enter/leave, instance slots, raid lockouts + raid gates |
| `instances/difficulty.ts` + `instances/heroic_vendor.ts` | heroic dungeons: tuning + `dungeonDifficulty`/`setDungeonDifficulty`, `awardHeroicMarks` and kill lockouts; the Heroic Quartermaster marks vendor |
| `delves/runs.ts` | delve run lifecycle (`updateDelveRuns`, modules, rewards, shop) |
| `delves/lockpick_controller.ts` | the lockpick session machine |
| `delves/companion.ts` | `updateDelveCompanion` |
| `delves/drowned_litany_boss.ts` / `_rite.ts` / `_rooms.ts` | The Drowned Litany delve: room puzzles, the Sister Nhalia boss, the Rite finale (difficulty knobs in `delves/rite_tuning.ts`, shared with the HUD popup) |
| `social/party.ts` | the party/raid machine + `partyOf` |
| `social/duel.ts` + `social/arena.ts` | duels + ranked arena (Elo, matchmaking) |
| `social/fiesta.ts` + `social/fiesta_bots.ts` | fiesta match logic + offline bots |
| `social/vale_cup.ts` + `social/vale_cup_bots.ts` | Vale Cup boarball: brackets, the one match slot, the `vcup*` seam arms (pure ball math in the `vale_cup_ball.ts`/`vale_cup_layout.ts` leaves); its tick phase draws ZERO shared rng |
| `social/yumi.ts` | Protect Yumi 3v3/5v5 maze mode (layout leaf `yumi_maze_layout.ts`) |
| `social/ready_check.ts` | `/ready`: the `readyChecks` primitive + the `updateReadyChecks` phase |
| `social/trade.ts` + `social/chat.ts` | player trade; the `chat()` router, emotes, whispers, channel membership (readout formatters in `social/chat_readouts.ts`). `Sim` keeps only a thin `chat()` delegate for the `IWorld` facade; new slash commands land in `social/chat.ts`, never on `Sim` |
| `targeting.ts` | player target selection + raid markers |
| `market.ts` | the World Market (`Market` class) |
| `mail/post_office.ts` | player mail (send/take/read/delete, the mailbox anchor gate) |
| `bank.ts` | the personal pooled bank (The Gilded Strongbox): capacity math + the container-agnostic `moveBetweenContainers`, `bankDeposit`/`bankWithdraw`/`bankBuySlots`, `bankInfoFor` (boundary-clones), `sanitizeBankState` (the one load path), `nearBanker`; state on `PlayerMeta.bank`, the `bankerIds` anchor list on `Sim`; draws NO rng |
| `loot/loot_roll.ts` + `loot/loot_ffa.ts` | loot rolls, corpse loot, party-loot strategy, `rollLoot`; the tap-lock FFA timeout |
| `deeds.ts` | the Book of Deeds evaluator (`updateDeeds`): runs at the very end of the tick tail (grant evaluation over dirty players only via `markDeedsDirty`, plus a 1 Hz proximity sweep for visit marks), draws NO rng, grants into `PlayerMeta.deedsEarned` + maintains `deedStats`/`renown`, emits id-based `deedUnlocked` (retro on join); plus the bespoke `manual`-deed grant sites and the session-only `DeedRuntime` encounter tracking. Authoring contract: `docs/design/deeds.md` |
| `professions/` | gathering/crafting/enchanting/salvage/archetypes; governed by its own `CLAUDE.md` (hooks `drainGatheringGrants` into the per-player tick) |

Enumerate the live set: `grep -rl sim_context src/sim --include='*.ts'`; every hit must be
a row here or a Key files entry (`sim.ts`, `sim_context.ts`, `entity_roster.ts`).

### Pure leaves (no `SimContext`; a Vitest imports them directly)
`threat.ts`/`spatial.ts`/`format_money.ts` above are the pattern; reuse or imitate one of
these before inlining pure logic in a system module: `spell_scaling.ts` (spell/attack
power coefficients), `stun_dr.ts` (CC diminishing-return categories), `item_level.ts`/
`item_budget.ts`/`item_level_req.ts` (drop power math), `equipment_rules.ts` (equip
legality), `cooldown_persist.ts` (cooldown save/load), `tab_target.ts`/`assist.ts`/
`dead_target.ts` (target cycling, /assist, dead-target selectability), `flee_speed.ts`,
`mob/scan_counters.ts` (the per-tick mob scan-visit tally the server reads post-tick),
`lockpick.ts` (the minigame core behind `delves/lockpick_controller.ts`), `map_doc.ts`
(the custom-map document/validator), `geometry2d.ts`, `market_query.ts`,
`vendor_stack.ts`, `loot_master.ts`, `aura_classify.ts` (buff-vs-debuff, shared with the
HUD), `resurrection.ts` (sickness rules shared by every death site), and the combat
leaves `spell_resist.ts`/`ranged_shot.ts`/`aura_stacking.ts`/`aura_cancel.ts`/
`exclusive_aura.ts`/`form_swing.ts`, and `jail.ts` (moderation-jail cage layout, gate
teleport, visitor spot; the jail SYSTEM logic stays on `Sim`). A leaf is any `src/sim`
file with no `sim_context` import.

## The SimContext seam (final shape)
`sim_context.ts` defines `SimContext` = `SimContextPrimitives` (live getters onto the
running `Sim`) + `SimContextCallbacks` (cross-system functions). `Sim.buildSimContext()`
binds every member. The seam carries two kinds of callback:

- **Owned by a module** (the binding points at the module; `Sim` keeps a thin delegate for
  foreign callers): e.g. `dealDamage`/`handleDeath`/`grantXp` (damage), `runEffects`
  (effect dispatch), `updateMob`/`onBossDeath` (locomotion), `updateNythraxisEncounter`
  (encounter), `rollLoot` (loot), `updateDelveCompanion` (companion), etc.
- **Still on `Sim` / shared** (exposed through the seam but the body stays on `Sim`):
  the shared combat/movement entry points below, plus core helpers like `resolve`,
  `playerMods`, `enterCombat`, `isHostileTo`/`isFriendlyTo`, `addItem`/`removeItem`/
  `countItem` (inventory hub), and `isControlAura` (the general CC predicate).

**Shared entry points: never owned by one slice, never deleted** (called from multiple
foreign hot paths, reachable via `SimContext`):
- `mobSwing`: base mob hit-table shell on `Sim`; callers in mob combat, profiled mob
  combat, the melee pet attack, and the delve companion attack.
- `updateRangedPetAttack`: mob ranged path + hunter pet ranged.
- `pulseGroundAoE`: the per-tick ground-AoE pulse AND the effect-dispatch on-cast path
  (two callers; the dispatch caller is the easy-to-miss one).
- `applyTaunt`: player ability/effect, pet, and pet-attack paths.
- `meleeSwing`: body lives in `combat/auto_attack.ts`; `Sim` keeps the thin delegate
  because both the auto-attack driver and the `castAbility` weaponStrike path use it.
- `moveToward` / `fleeMoveSpeed`: shared movement entries used by mob/pet/companion/NPC.

If you ever find a `SimContext` member with zero consumers, that is dead scaffolding:
remove the declaration AND its binding in the same change, then re-run the parity gate.

## Determinism as it bites here
- Randomness: `this.rng` only; `time`/`tickCount` are sim-clock fields advanced by `tick()`, use them, not wall-clock. The banned-API list is enforced mechanically by `tests/architecture.test.ts`.
- Fixed step: everything scales by `DT` (=1/20). There is no variable delta. The seed is fixed once in the `Sim` ctor.
- Order matters: one shared `mulberry32` stream feeds every draw site. Changing the
  tick-phase order, an entity-iteration order, or an early-bail that can draw rng shifts
  the global draw order and forks the world. Don't reorder `tick()` or a loop casually;
  the parity gate's draw-order log catches it.

## sim.ts coordinator map (what `tick()` does, in order)
`tick()` reads as a linear registry of system calls routed through `this.ctx`, in phase
GROUPS: advance the clock; the prologue (respawns, world bosses, ground AoEs, despawn
decay, in-flight projectiles); the per-player loop (movement/doors/casting/auto-attack/
regen for live players, the ghost-run arm for released spirits, timers + auras for dead
players too, intentionally); the per-entity loop (mob update + auras, friendly-NPC aura
cleanse, object respawn); the `engagedPids` combat-flag pass (reads pet AND mob state
after both update: this STAYS in the coordinator, never moves into a slice); the
end-of-tick system block in fixed order (duels through the delayed-event drain, then the
deeds evaluator `updateDeeds`: zero rng, after the drain so it sees same-tick results); grid
re-bucketing LAST, then drain + return the `SimEvent[]`. The authoritative phase list is
`tick()` itself: most phases carry a self-naming `lap?('...')` marker (a few adjacent
calls share one, e.g. trades + ready checks), so read those,
not a doc copy. Phase ORDER is rng-draw-order load-bearing (see Determinism); a
zero-rng phase (Vale Cup) may append, anything else must not reorder.

Beyond `tick()`, `sim.ts` legitimately keeps: the `IWorld` facade delegates, the
back-compat accessors (`player`/`inventory`/`xp`/`equipment`/`questLog`/`talents`/... that
delegate to the primary player; per-player state lives in `PlayerMeta`, not the `Entity`),
a thin `chat()` delegate (the router body lives in `social/chat.ts`), the inventory hub,
persistence (`serializeCharacter`/`addPlayer`), the shared entry points above, and
`buildSimContext()`. A NEW self-contained system belongs in its own sibling module behind
`SimContext`, not as another method cluster on `Sim`.

## Tuning constants: change numbers THERE, not inline
- Global gameplay/formulas: top of **`types.ts`** (`MELEE_RANGE`, `MELEE_ARC`, `LEASH_DISTANCE`, `GCD`, `XP_TABLE`, rage/hit/armor fns, ...).
- Sim-internal knobs live as a named `const` next to their owning module (`GRAVITY` in `player_motion.ts`, `PARTY_*` in `social/party.ts`, `MARKET_*` in `market.ts`, ...); a few remain atop `sim.ts` (`CHARGE_*`, `PET_*`, `ARENA_LADDER_SIZE`). Edit the named const, don't hardcode magic numbers in methods.

## Talking to the outside
- Output is the **`SimEvent`** union (`types.ts`). Code calls `this.emit(ev)` (or `ctx.emit` from a module); `tick()` returns the drained `SimEvent[]`. An event with `pid` is personal (delivered only to that player's owner); without `pid` it's world-visible.
- Stepping: callers run `sim.tick()` per frame (`server/game.ts`; `headless/env_server.ts` loops it `frameSkip` times). The sim never self-schedules.

## Player-facing text is English here (localized at the client)
- The sim carries **no `t()`/DOM/i18n imports**. Player-visible strings are emitted as
  English literals/templates on `SimEvent`s via `this.emit`, `this.error(pid, text)`
  (`type:'error'` toast), `this.notice(pid, text)` (`type:'log'` line), and
  `stopFollow(p, msg)` (routes `msg` through `this.error`). A module emits the same way
  through `ctx.emit`/`ctx.error`/`ctx.notice`. Translation happens only at the client
  boundary, in `src/ui/sim_i18n.ts` (`localizeSimText`): an `EXACT` map of placeholder-free
  strings plus ordered `RULES` regexes that re-render each emit through `t()`/`tSim()`.
- **Money is built English here, re-localized client-side.** The sim has its OWN
  `formatMoney` in **`format_money.ts`** (NOT the `src/ui/i18n.ts` one) that yields plain
  `"3g 5s"` fragments inside loot/quest/vendor/market emit text; this is intentional (the
  sim stays language-agnostic). The client re-renders those amounts locale-aware in hud's
  `localizeLootText` arm: `parseSimMoney` reverses the `"Ng Ns Nc"` fragment back to copper,
  then the i18n `formatMoney` formats it. Don't reach for the i18n `formatMoney`/`formatNumber`
  here, and don't hand-format with a separator a locale would change.
- **Dev-channel text stays English.** The sim's only non-player text is a couple of
  `console.warn` diagnostics (no user-surfaced `throw`s); they are never matched. If a
  string would ever feed both a diagnostic log and a player-visible `SimEvent`, split it
  so only the player arm (`error`/`notice`) is registered in `sim_i18n.ts`.
- **Changing or adding a player string is a two-file change:** edit the literal at its
  emit site (in `sim.ts` OR the owning module) AND add/update the matching `EXACT` value or
  `RULE` (plus its `BASE_DICT` / EXTRA-table key) in `sim_i18n.ts`, in the same change.
  Broad multi-capture `RULES` (e.g. `unleashes`) stay LAST, after the specific
  `{name} {verb}!` rules.
- The **S3 drift guard** (`tests/localization_fixes.test.ts`) parses the sim files at test
  time and fails CI on any emit no client matcher recognizes. It only sees string
  **literals** at the emit site: variable-routed emits (e.g. `helpLines()` looped through
  `error(id, line)`) and `?? 'English'` fallbacks are invisible. Strings that ship English
  on purpose (the v0.7 slash-command readouts) are tracked in the status registry
  (`blockedSource` / `ALLOW_V07_SLASH`); prefer a literal at the emit site so the guard
  keeps working.

## Adding a mechanic here
1. Add state to `Entity` (`types.ts`) and/or `PlayerMeta`; init it in `entity.ts` `baseEntity` / `createPlayer`. State stays on `Sim`/`Entity`, not in a module global.
2. Decide where the BEHAVIOR lives:
   - Extending an existing system -> its module (e.g. a new ability effect -> `combat/effect_dispatch.ts`).
   - A NEW self-contained system -> a NEW sibling module that talks only to `SimContext`. Add the callbacks it needs to `sim_context.ts` (append-only) and bind them in `buildSimContext()`; keep a thin `Sim` delegate if a foreign caller resolves the method on the facade.
   - Pure presentation/domain logic (geometry, formatting, id/state resolution) -> a small host-agnostic leaf module a Vitest imports directly (like `threat.ts`/`spatial.ts`/`format_money.ts`).
3. New randomness through `this.rng`/`ctx.rng`; new output via `emit` (add a `SimEvent` variant if needed). Keep new `tick()` work in the right phase; don't reorder existing phases.
4. If render/UI must see it or trigger it: **add the member to the matching `IWorld` facet (`src/world_api/<domain>.ts`), implement in BOTH `Sim` and `ClientWorld` (`src/net/online.ts`), and update the `IWORLD_MEMBERS` pin (`tests/world_api_parity.test.ts`)**: presentation never reaches into `Sim` directly.
5. Add/adjust a Vitest (`tests/`), ideally a determinism/replay assertion; a new mechanic with rng draws wants a `tests/parity` scenario. If the mechanic is conquerable content (a dungeon, delve, raid, world boss, zone, or rare), author its Book of Deeds records in the SAME change (recipe in `docs/design/deeds.md`).
6. Fix bugs test-first: reproduce with a failing Vitest against the owning module (or the `Sim` facade; extract the unit under test into its own leaf if it is buried), then the smallest change that turns it green. A fix touching rng draw sites re-runs `tests/parity`.

## Never here
- **Never derive player stats outside `recalcPlayerStats`**, and don't walk the talent tree per-tick: talents are precomputed into the flat `TalentModifiers` at allocation/respec time.
