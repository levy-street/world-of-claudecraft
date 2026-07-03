// SimContext: the shared seam every extracted game-system module talks to instead
// of reaching into the 17.5k-line `Sim` monolith.
//
// Session S0b DEFINES this seam and threads it through the tick path; it MOVES NO
// behavior. Every callback below ROUTES to a method that still lives on `Sim`
// (the "points-at = Sim" column of 02-WORKING-MEMORY.md's callback registry). As a
// later slice extracts an owner, it reimplements that callback inside its own module
// WITHOUT renaming it here, so consumers never change. Treat the surface as
// APPEND-ONLY: add callbacks, never repurpose or rename one.
//
// This module is `src/sim`-pure: it imports only sibling sim types (no render/ui/
// game/net/DOM/Three, no `Math.random`/`Date.now`), so it runs unchanged in Node,
// the browser, and the headless RL env (enforced by tests/architecture.test.ts).

import type { TalentModifiers } from './content/talents';
import type { DelayedEvent, GroundAoE } from './entity_roster';
import type { PendingLootRoll } from './loot/loot_roll';
import type { MarketListing } from './market';
import type { PendingProjectile } from './projectile_travel';
import type { Rng } from './rng';
import type {
  ArenaMatch,
  ArenaQueueUnit,
  DuelState,
  FiestaState,
  InstanceSlot,
  ItemUseResult,
  JoinableChannel,
  Party,
  PendingMobRespawn,
  PetState,
  PlayerMeta,
  ResolvedAbility,
  TradeSession,
} from './sim';
import type { SpatialGrid } from './spatial';
import type {
  AbilityDef,
  Aura,
  CrowdControlDrCategory,
  DelveRun,
  Entity,
  ErrorReason,
  PlayerClass,
  QuestProgress,
  SimConfig,
  SimEvent,
  SkinCatalog,
  Vec3,
} from './types';

// Live primitive views onto the running Sim. These are GETTERS, not snapshots:
// `time`/`tickCount` advance every tick, and the `rng`/`entities` identities are
// shared so a consumer observes the same mutable world the Sim does (the engine
// mutates entities in place under the refactor's immutability waiver).
export interface SimContextPrimitives {
  readonly rng: Rng;
  readonly time: number;
  readonly tickCount: number;
  readonly entities: Map<number, Entity>;
  // Live player roster (keyed by entity id). Stays a Sim field; exposed here so the
  // moved party machine (A1) resolves member names/metas through the seam.
  readonly players: Map<number, PlayerMeta>;
  // The local / RL player id (single-player + renderer contexts). Reassigned on the
  // first join and on the primary's departure, so it is a LIVE getter, not a snapshot.
  // Stays a Sim field; the moved raid-marker `markerFor` (T1) reads it through the seam.
  readonly primaryId: number;
  // Social-invite maps owned by the trade (G2) and duel (A2) slices. The party
  // machine (A1) reads them for hasPendingSocialInvite's cross-system pending check
  // and lazily expires entries in place, so these are LIVE views: the backing fields
  // stay on Sim (mutated in place), like E1's delayedEvents/groundAoEs.
  readonly tradeInvites: Map<number, { fromPid: number; expires: number }>;
  readonly duelInvites: Map<number, { fromPid: number; expires: number }>;
  // The monotonically increasing entity-id counter (I1). Read-write so spawners (I1's
  // claimInstance) allocate ids exactly as `this.nextId++` did on Sim.
  nextId: number;
  // Spatial indexes kept roster-exact alongside `entities` (E1). Stay public on Sim
  // too (server/game.ts queries them); exposed here as live views for the roster ops.
  readonly grid: SpatialGrid;
  readonly playerGrid: SpatialGrid;
  // Sim-owned tick-prologue collections (E1). The drains (drainDelayedEvents /
  // tickGroundAoEs) live in entity_roster; the SCHEDULING push sites stay on Sim
  // (N1/M3 delayed events, C1/C4b ground AoEs), so the fields stay on Sim and are
  // reached here as live views. `delayedEvents` is read-write (the drain reassigns
  // the pending list); `groundAoEs` is mutated in place (splice), so read-only.
  delayedEvents: DelayedEvent[];
  // In-flight projectiles (projectile_travel.ts): launched by the ranged combat
  // paths, stepped toward their live targets in the tick prologue and resolved on the
  // tick they arrive. Read-write (the advance reassigns the pending list), like
  // delayedEvents.
  pendingProjectiles: PendingProjectile[];
  readonly groundAoEs: GroundAoE[];
  // dungeon-door registry (I1) appended to on dungeon_door spawn; null until built.
  // Read-write: I1's updateDoorTriggers lazily assigns the array on first build.
  dungeonDoorIds: number[] | null;
  // The dungeon-instance slot pool (I1), seeded in the Sim ctor. The dungeons module
  // reads/finds/iterates it and mutates slot fields in place; the array identity
  // stays Sim-owned (like delayedEvents/groundAoEs), so this is a live read-only view.
  readonly instances: InstanceSlot[];
  // live arena bouts keyed by every participant pid (A2); release-spirit early-bails
  // when the dead player is mid-bout.
  readonly arenaMatches: Map<number, ArenaMatch>;
  // C1 damage-core live views. The shared `players` map (declared above) plus `duels`
  // (shared duel keyed by both pids) back the damage/death/xp paths; `cfg` supplies
  // respawn tuning on mob death (M2 also reads cfg.seed for mob terrain height).
  // Backing fields stay on Sim. `duels` is also read per-attack by isHostileTo/
  // dealDamage (PvP hostility), so it stays Sim-owned (A2).
  readonly duels: Map<number, DuelState>;
  // `world` stays optional (custom play-test map, else undefined); the rest defaulted.
  readonly cfg: Required<Omit<SimConfig, 'noPlayer' | 'world'>> & Pick<SimConfig, 'world'>;
  // A2 duel + arena state. Live views: the backing fields stay on Sim (mutated in
  // place / reassigned), like E1's delayedEvents. The three queues are REASSIGNED by
  // the matchmaker's filter, so they are read-write; the maps/set and the match-id
  // counter are mutated/incremented in place.
  readonly trades: Map<number, TradeSession>;
  arenaQueue1v1: number[];
  arenaQueue2v2: ArenaQueueUnit[];
  arenaQueueFiesta: ArenaQueueUnit[];
  readonly arenaBusySlots: Set<number>;
  nextArenaMatchId: number;
  // I2a delve runs: the live run pool (seeded in the Sim ctor, never reassigned) and
  // the transient pet stash both stay Sim-owned (the disconnect path + serializePet
  // poke them); exposed here as live views the run module reads/mutates in place.
  // (P1b also consumes delvePetStash; it is the same I2a-declared field, not re-added.
  // P1b's nextId dedupes with I1's declaration above.)
  readonly delveRuns: DelveRun[];
  readonly delvePetStash: Map<number, PetState>;
  // Host-supplied UTC day string ('' = unknown) gating the delve daily reset.
  readonly utcDay: string;
  // Wild-respawn queue (P1b: completeTame pushes the tamed beast's respawn). Live view;
  // the backing array stays on Sim, mutated in place (push), so read-only ref.
  readonly pendingMobRespawns: PendingMobRespawn[];
  // G2 social plumbing: the chat + party-invite state stays Sim-owned (the leave/
  // removePlayer cleanup, the joint invite-expiry sweep, and the chat() router all
  // reach it on Sim) and is exposed here as live views, mutated in place (set/get/
  // delete), never reassigned, so all read-only. `partyInvites` belongs to the party
  // slice (A1); trade only sweeps it inside the shared updateTradesAndInvites loop, so
  // it routes through ctx until that slice puts it on the seam. (trades/tradeInvites/
  // duelInvites are already declared above; deduped.)
  readonly partyInvites: Map<number, { fromPid: number; expires: number }>;
  readonly chatTokens: Map<number, { tokens: number; at: number }>;
  readonly channelSubs: Map<number, Set<JoinableChannel>>;
  // L1 loot-distribution state. The pending need-greed rolls map is mutated in
  // place (.set/.delete), so its identity is stable -> read-only view. The roll-id
  // counter is bumped via `ctx.nextLootRollId++` in startNeedGreedRoll, so it is a
  // read-write primitive (get + set). Backing fields stay on Sim.
  readonly pendingLootRolls: Map<number, PendingLootRoll>;
  nextLootRollId: number;
  // W5 chat router/readouts. `devCommands` gates the /dev chat cheats (the router's
  // `if (ctx.devCommands)` guard, exactly the Sim field). `marketListings` is the live
  // World Market book the /listings readout filters to the player's own listings; the
  // backing field stays Sim-owned (the Market instance owns it), exposed here as a live
  // read-only view (never reassigned by the readout).
  readonly devCommands: boolean;
  readonly marketListings: MarketListing[];
}

// Cross-system callbacks. Each signature mirrors the still-on-`Sim` method it
// currently delegates to, EXACTLY (arg order + types preserved), so a delegation is
// a faithful move-not-rewrite. Grouped by the slice that will eventually own them.
export interface SimContextCallbacks {
  // Event sink (core). Routes to `Sim.emit`.
  emit(ev: SimEvent): void;
  // Personal error toast/event to a player (core). Routes to `Sim.error`, which
  // emits `{ type: 'error', text, pid, reason? }`.
  error(pid: number, text: string, reason?: ErrorReason): void;

  // I1 dungeon instancing. `lockoutNowMs` is the shared raid-lockout clock (stays on
  // Sim; N1 also writes lockouts through it). instanceKeyFor/instanceOriginOf/
  // enterDungeon/leaveDungeon are exposed so foreign spawn/interaction/party code
  // (N1, the delve slice, quest spawns, the interaction dispatchers) reaches them
  // through the seam; implemented in instances/dungeons, Sim keeps thin delegates so
  // existing `this.enterDungeon` etc. call sites resolve unchanged.
  lockoutNowMs(): number;
  // The next raid-reset instant (epoch ms) for a given lockout "now". The host owns
  // the boundary (the authoritative server uses its realm-local 3 AM daily reset), so
  // the sim core never reads a time zone; offline/headless fall back to a flat 24h day.
  raidResetMs(nowMs: number): number;
  instanceKeyFor(pid: number): string;
  instanceOriginOf(inst: InstanceSlot): { x: number; z: number };
  enterDungeon(dungeonId: string, pid?: number): void;
  leaveDungeon(pid?: number): void;

  // C1 damage/death hub + the casting/leash/arena/duel/fiesta/loot teardown it
  // drives mid-tick. `dealDamage` is the post-mitigation entry (crit/dodge/miss and
  // armor are resolved upstream in meleeSwing/rangedSwing).
  dealDamage(
    source: Entity | null,
    target: Entity,
    amount: number,
    crit: boolean,
    school: string,
    ability: string | null,
    kind: 'hit' | 'miss' | 'dodge',
    noRage?: boolean,
    threatOpts?: { flat?: number; mult?: number },
    direct?: boolean,
  ): void;
  handleDeath(entity: Entity, killer: Entity | null): void;
  cancelCast(entity: Entity): void;
  pushbackCast(entity: Entity): void;
  refreshMobLeashFromAction(source: Entity | null, target: Entity): void;
  retargetMob(mob: Entity): void;
  // M1: Nythraxis boss-add target helpers that retargetMob consults (the extracted
  // mob/targeting module reaches them through the seam). Owned by the later
  // Nythraxis slice (N1); stay on Sim for now (findNythraxisBossForAdd bookkeeping).
  nythraxisAddFallbackTarget(add: Entity): Entity | null;
  scheduleNythraxisAddDespawnIfBossReset(add: Entity): boolean;
  isArenaCrossTeam(match: ArenaMatch, attackerPid: number, targetPid: number): boolean;
  arenaTeamOf(match: ArenaMatch, pid: number): 'A' | 'B' | null;
  endArenaMatch(
    match: ArenaMatch,
    winnerTeam: 'A' | 'B' | null,
    reason: 'defeat' | 'timeout' | 'forfeit',
  ): void;
  endDuel(duel: DuelState, winnerPid: number | null): void;
  // A2 duel/arena slice (social/duel.ts + social/arena.ts). isArenaCrossTeam,
  // arenaTeamOf, endArenaMatch, endDuel (above) now point at the moved modules via
  // Sim's thin delegates. The block below is what the moved code CONSUMES that stays
  // on Sim (clearAurasFromSource has non-duel callers; entityInDungeon /
  // hasPendingSocialInvite are core; the five fiesta* hooks are A3-owned), plus the
  // arena bodies EXPOSED for the Fiesta slice (A3): readyArenaFighter / resetForArena
  // / isArenaTeamWiped / arenaIsDown / arenaAllPids (arenaTeamOf already above).
  clearAurasFromSource(target: Entity, sourceId: number): void;
  entityInDungeon(e: Entity, dungeonId: string): boolean;
  hasPendingSocialInvite(targetPid: number): boolean;
  createFiestaState(): FiestaState;
  fiestaStandardize(meta: PlayerMeta, e: Entity): void;
  updateFiestaActive(match: ArenaMatch): void;
  fiestaRestoreChar(meta: PlayerMeta, e: Entity): void;
  clearFiestaAugments(meta: PlayerMeta, e: Entity): void;
  readyArenaFighter(e: Entity, opts: { clearPrep: boolean }): void;
  resetForArena(e: Entity): void;
  isArenaTeamWiped(match: ArenaMatch, team: 'A' | 'B'): boolean;
  arenaIsDown(match: ArenaMatch, pid: number): boolean;
  arenaAllPids(match: ArenaMatch): number[];
  fiestaTakedown(match: ArenaMatch, killerPid: number, victim: Entity): void;
  fiestaDown(match: ArenaMatch, victim: Entity, killerPid: number | null): void;
  rollLoot(mob: Entity, meta: PlayerMeta, eligible?: PlayerMeta[]): void;
  // World-boss personal loot: an independent roll of the boss's loot table per
  // contributor (gated once-per-day per boss). Owned by world_boss.ts.
  rollWorldBossLoot(mob: Entity, contributors: PlayerMeta[]): void;

  // C2/C3/C4b heal, aura, knockback, and crowd-control surface.
  applyHeal(source: Entity, target: Entity, amount: number, ability: string): void;
  // Spell crit chance from intellect. STAYS on Sim (shared: the casting/ability
  // paths read it too); exposed here so the extracted heal core can draw its crit.
  spellCrit(p: Entity): number;
  applyAura(target: Entity, aura: Aura): void;
  // General control-aura predicate (stun/root/incapacitate/polymorph). STAYS on Sim
  // (the applyAura CC-immunity path reads it too); exposed so the extracted Nythraxis
  // encounter's isNythraxisControlAura (which adds 'slow') can consult it via the seam.
  isControlAura(kind: Aura['kind']): boolean;
  applyRootAura(
    source: Entity,
    target: Entity,
    name: string,
    id: string,
    duration: number,
    school: Aura['school'],
  ): void;
  applyKnockback(source: Entity, target: Entity, distance: number): number;
  diminishedCrowdControlDuration(
    source: Entity,
    target: Entity,
    category: CrowdControlDrCategory,
    duration: number,
  ): number | null;
  hostilesInRadius(source: Entity, pos: Vec3, radius: number): Entity[];
  breakStealth(entity: Entity): void;

  // Shared entry point (stays on Sim, exposed here): taunt forces a mob's target.
  applyTaunt(target: Entity, mob: Entity): void;

  // P1 pet lifecycle.
  summonPet(owner: Entity, templateId: string): void;
  petOf(ownerPid: number, includeDead?: boolean): Entity | null;
  completeTame(player: Entity, target: Entity): void;

  // P1b pet commands also consume error / playerGcdFor / healingThreat / countItem,
  // all declared elsewhere on the seam (A1/G1a, C4a, C2/C3, Q1) - deduped, not re-added.
  // They add two NEW shared helpers that STAY on Sim: spendResource (healPet's Demon-Heal
  // mana spend; C4a exports it as a sibling fn, not yet a ctx callback) and removeItem
  // (feedPet consumes the inventory hub; L2 dedupes when it adds the identical decl).
  spendResource(p: Entity, cost: number): void;
  removeItem(itemId: string, count: number, pid?: number): void;
  // Fungible-only removal (#1165), skips instanced slots; market.ts escrows with this.
  removeFungibleItem(itemId: string, count: number, pid?: number): void;

  // A1/T1 raid markers + party; Q1 quest-credit trio (kill/collect/turn-in credit,
  // foreign-called from handleDeath + the inventory hub + the interaction/crypt
  // dispatchers), reading inventory via countItem (stays on Sim / L2 inventory hub).
  // clearEntityMarker (death/despawn hooks) + dropPartyMarkers (the A1 disband path)
  // now point at the T1 marker store (src/sim/targeting.ts) via Sim's late-bound
  // delegate; partyOf stays on Sim (A1's thin delegate -> social/party).
  clearEntityMarker(entityId: number): void;
  partyOf(pid: number): Party | null;
  // Invite a player to the actor's party by pid (delegates to the PartyMachine);
  // used by the chat "/invite <name>" command in social/chat.ts.
  partyInvite(targetPid: number, pid?: number): void;
  removeFromParty(pid: number, verb: string): void;
  // Drop a disbanded party's whole raid-marker set (points at T1's targeting store).
  dropPartyMarkers(partyId: number): void;
  onMobKilledForQuests(mob: Entity, meta: PlayerMeta): void;
  onInventoryChangedForQuests(meta: PlayerMeta): void;
  checkQuestReady(qp: QuestProgress, meta: PlayerMeta): void;
  countItem(itemId: string, pid?: number): number;
  // Fungible-only count (excludes per-instance slots, #1165); market.ts uses this
  // instead of countItem so an instanced copy is never listed as a plain stack member.
  countFungibleItem(itemId: string, pid?: number): number;
  completeQuestForDev(questId: string, pid?: number): boolean;
  completeCurrentQuestsForDev(pid?: number): number;

  // T1 player target selection consumes isHostileTo/isFriendlyTo/pvpController/stopFollow;
  // all already on the seam (C4a added the first two + stopFollow, C1 added pvpController)
  // and STAY on Sim, so they are not re-declared here.

  // E1 entity roster: the moved roster ops, exposed so the foreign callers across
  // not-yet-extracted slices reach them through the seam. Implemented in
  // entity_roster; Sim retains thin delegating methods so existing `this.addEntity`
  // / test `sim.addEntity` call sites resolve unchanged.
  addEntity(e: Entity): void;
  dropEntity(id: number): void;
  rebucket(e: Entity): void;

  // E1 forward references the moved code consumes; all still on Sim. `resolve`,
  // `groundPos`, `playerMods` are core; `delveRunForPlayer`/`delveModuleEntry`/
  // `failDelveRun` are delve-slice internals release-spirit calls; `pulseGroundAoE`
  // is the shared ground-AoE entry point the drain pulses.
  resolve(pid?: number): { meta: PlayerMeta; e: Entity } | null;
  groundPos(x: number, z: number): Vec3;
  playerMods(meta: PlayerMeta): TalentModifiers;
  delveRunForPlayer(pid: number): DelveRun | null;
  delveModuleEntry(run: DelveRun): Vec3;
  failDelveRun(run: DelveRun): void;
  pulseGroundAoE(
    effect: GroundAoE,
    threatOpts?: { flat?: number; mult?: number },
    direct?: boolean,
  ): void;

  // C1 damage core: the post-mitigation damage/death/xp hub the extracted module
  // (src/sim/combat/damage.ts) owns plus the helpers it consumes (all still on Sim
  // except dealDamage/handleDeath/grantXp, which delegate to the module). enterCombat
  // is a shared combat-entry helper that STAYS on Sim, exposed here for the hub.
  grantXp(amount: number, meta: PlayerMeta, opts?: { fromKill?: boolean }): void;
  enterCombat(a: Entity, b: Entity): void;
  hexOutputMult(source: Entity | null): number;
  critVulnBonus(target: Entity): number;
  pvpController(e: Entity | null): Entity | null;
  threatMod(source: Entity, school: string): number;
  // isArenaTeamWiped / arenaIsDown declared in the A2 duel/arena block above (C1's
  // dealDamage death path consumes them via ctx; A2 owns them -> social/arena).
  clearNonPlayerStatAuras(target: Entity): void;

  // C3 per-tick aura/regen runner (src/sim/combat/auras.ts) consumes these.
  // healingTakenMult (the incoming-heal mult applied to eat/drink + HoT ticks) and
  // healingThreat (effective-healing threat fan-out off a HoT tick) delegate to
  // combat/heal.ts (C2). applyNonPlayerStatAura folds a mob/npc stat aura in/out on
  // expiry; it STAYS on Sim (shared with the applyAura path).
  healingTakenMult(target: Entity): number;
  healingThreat(source: Entity, target: Entity, healed: number): void;
  applyNonPlayerStatAura(target: Entity, aura: Aura, direction: 1 | -1): void;
  delveRunForMob(mobId: number): DelveRun | null;
  onDelveBossDefeated(run: DelveRun): void;
  grantNythraxisLockout(boss: Entity): void;
  frenzyPackmates(dead: Entity): void;
  armDeathThroes(dead: Entity): void;
  // C1's grantXp level-up path AND G1a's talent application (progression/talents.ts)
  // both consume refreshKnownAbilities: the talent path always passes announce=false
  // (a silent re-resolve, no learnAbility spam); the level-up path passes announce=true.
  // G1a's talent module also consumes the core `error` sink (declared above). The talent
  // PUBLIC API (applyTalents/spendTalent/setSpec/respec/saveLoadout/switchLoadout/
  // deleteLoadout/talentPoints) is NOT on this seam: Sim keeps thin wrapper methods that
  // delegate into the module (server/HUD/tests call the `Sim` facade directly).
  refreshKnownAbilities(meta: PlayerMeta, announce: boolean): void;
  syncPetLevel(owner: Entity): void;
  // M2 mob locomotion: the updateMob dispatcher reaches every boss/pet/Nythraxis/
  // corpse branch and movement helper it dispatches to through these. All still live
  // on Sim (or a shared module); the eventual owners flip points-at, never rename.
  // --- shared movement/combat entry points (STAY on Sim, exposed here) ---
  moveToward(e: Entity, dest: Vec3, speed: number, ignoreObstacles?: boolean): boolean;
  mobSwing(mob: Entity, target: Entity): void;
  updateRangedPetAttack(
    pet: Entity,
    target: Entity,
    spell: {
      name: string;
      school: 'physical' | 'fire' | 'frost' | 'arcane' | 'shadow' | 'holy' | 'nature';
      min: number;
      max: number;
      range: number;
      every: number;
    },
  ): void;
  fleeMoveSpeed(e: Entity): number;
  // --- mob-AI helpers the dispatcher consults ---
  usesProfiledMobCombat(mob: Entity): boolean;
  updateProfiledMobCombat(mob: Entity): void;
  tryMobMeleeSwingInRange(mob: Entity, target: Entity): boolean;
  maybeFlee(mob: Entity, target: Entity): boolean;
  aggroMob(mob: Entity, target: Entity, social: boolean): void;
  isStunned(e: Entity): boolean;
  isRooted(e: Entity): boolean;
  moveSpeedMult(e: Entity): number;
  swingIntervalMult(e: Entity): number;
  mobEffectiveMeleeRange(mob: Entity): number;
  mobCanSwim(template: { family?: string; canSwim?: boolean } | undefined): boolean;
  resolveMovePoint(nx: number, nz: number, r: number, e: Entity): { x: number; z: number };
  // --- pet / delve-companion / boss-mechanic branches (owners: P1 / delve / M3-N1) ---
  updatePet(pet: Entity): void;
  isDelveCompanionMob(mob: Entity): boolean;
  updateDelveCompanion(companion: Entity): void;
  updateBossMechanics(mob: Entity): void;
  updateNythraxisEncounter(boss: Entity): void;
  resetNythraxisEncounter(boss: Entity): void;
  despawnSummonedAdds(boss: Entity): void;
  updateFearMovement(e: Entity): boolean;
  delveDetectMult(player: Entity): number;
  // --- corpse lifecycle (mob/lifecycle.ts, M4; despawnPet is P1's pet slice) ---
  detonateCorpse(dead: Entity): void;
  despawnPet(pet: Entity): void;
  respawnMob(mob: Entity): void;
  // M2 evade reset (mob/locomotion.ts via Sim's thin delegate). Exposed so the
  // extracted Nythraxis wipe (wipeNythraxisEncounter) can send the boss home; the
  // delegate re-enters resetNythraxisEncounter for the boss, the documented mutual
  // recursion (terminated by the boss.nythraxis = undefined clear on the first pass).
  resetEvadingMob(mob: Entity): void;
  // frenzyPackmates / armDeathThroes flipped points-at to mob/lifecycle (M4); the M4
  // respawnMob body also consumes despawnPersistentPet (I2a) + clearNonPlayerStatAuras
  // (C1), which stay on Sim. All four are declared once elsewhere in this interface.
  // --- boss-death dialogue hook (N1 owns the body; left here by M2) ---
  onBossDeath(mob: Entity): void;

  // M3 mob on-hit affix cascade (mob/mob_swing): two stat helpers the cascade
  // reaches back for. Both STAY on Sim. `effectiveArmor` is the cleave-splash armor
  // read; `recalcPlayer` rebakes a player victim's derived stats after Devour Magic
  // strips a beneficial aura (wraps the Sim players-map lookup + recalcPlayerStats so
  // the module never touches the map directly).
  effectiveArmor(e: Entity): number;
  recalcPlayer(target: Entity): void;
  // I2a delve run lifecycle (delves/runs.ts). The reach-in callbacks delveRunForMob/
  // onDelveBossDefeated/delveDetectMult are declared above (C1/M2 stubs; I2a flips
  // points-at to delves/runs via the Sim delegate); startDelveRaiseDeadChannel is the
  // one NEW reach-in. The rest still live on their owning slice (points-at Sim): the
  // shared helpers (partyMembersForKey/addItem/spawnBossAdds; grantXp is the C1 decl
  // above), the gate predicates (tradeFor/duelFor), the P1 pet seam (serializePet/
  // restorePet/despawnPersistentPet/isPetClass; despawnPet is the M2 decl above), the
  // I2b lockpick controller (abandonLockpick/tickLockpickTimeout), and the I2c companion
  // AI (spawnDelveCompanion/despawnDelveCompanion/maybeCompanionBark).
  partyMembersForKey(key: string): number[];
  addItem(itemId: string, count: number, pid?: number): void;
  // L2 World Market escrow (marketList) also consumes removeItem; it is declared once
  // above (P1b inventory-hub helper, points-at Sim) - deduped, not re-added here.
  spawnBossAdds(boss: Entity, mobId: string, count: number): void;
  tradeFor(pid: number): TradeSession | null;
  duelFor(pid: number): DuelState | null;
  serializePet(ownerPid: number): PetState | null;
  restorePet(owner: Entity, state: PetState): void;
  despawnPersistentPet(pet: Entity): void;
  isPetClass(cls: PlayerClass): boolean;
  spawnDelveCompanion(run: DelveRun, pid: number, companionId: string): void;
  despawnDelveCompanion(run: DelveRun): void;
  maybeCompanionBark(run: DelveRun, pid: number, barkId: string): void;
  abandonLockpick(run: DelveRun): void;
  tickLockpickTimeout(run: DelveRun): void;
  startDelveRaiseDeadChannel(run: DelveRun, boss: Entity, mobId: string, count: number): boolean;

  // C4a casting lifecycle (src/sim/combat/casting_lifecycle.ts) consumes these; all
  // still on Sim. `runEffects` is the C4b boundary (the moved applyAbility +
  // applyChannelTick reach the actual ability resolution only through here).
  // `cancelCast`/`pushbackCast` (declared above, S0b) flip points-at to this slice.
  // (error + addItem are already declared above; not redeclared here.)
  resolvedAbility(abilityId: string, pid?: number): ResolvedAbility | null;
  playerGcdFor(cls: PlayerClass): number;
  isFriendlyTo(caster: Entity, target: Entity): boolean;
  isHostileTo(attacker: Entity, target: Entity): boolean;
  lineOfSightBlocked(source: Entity, target: Entity, ability: AbilityDef): boolean;
  stopFollow(p: Entity, msg?: string): void;
  tameError(p: Entity, target: Entity): string | null;
  standUp(p: Entity): void;
  breakGhostWolf(e: Entity): void;
  startAutoAttack(pid?: number): void;
  revivePet(pid?: number): void;
  completeFishing(p: Entity, meta: PlayerMeta): void;
  applyDemonHealTick(owner: Entity): void;

  // C4b effect dispatch (src/sim/combat/effect_dispatch.ts) consumes these; all stay
  // on Sim. `awardCombo` is the combo-point award the weaponStrike/directDamage/
  // incapacitate cases gate on the `comboAwarded` latch; `meleeSwing` is the shared
  // physical-swing entry (also a C4a weaponStrike path); `effectiveAttackPower` is the
  // attack-power stat read the damage formulas use (`effectiveArmor` is the M3 decl
  // above, shared, not re-declared here); `hasLineOfSight` gates the AoE cases;
  // `findChargePath` builds the warrior/druid charge route.
  // `runEffects` itself is the C4b boundary: it flips points-at to effect_dispatch
  // (the moved switch), reached only via the cast lifecycle's applyAbility/applyChannelTick.
  awardCombo(p: Entity, target: Entity, points: number): void;
  meleeSwing(
    attacker: Entity,
    target: Entity,
    bonus: number,
    abilityName: string | null,
    opts: {
      cannotBeDodged?: boolean;
      weaponMult?: number;
      threatFlat?: number;
      threatMult?: number;
    },
  ): boolean;
  effectiveAttackPower(e: Entity): number;
  hasLineOfSight(source: Entity, target: Entity): boolean;
  findChargePath(p: Entity, target: Entity): Vec3[];
  runEffects(p: Entity, meta: PlayerMeta, target: Entity | null, res: ResolvedAbility): void;

  // P1a pet AI (src/sim/pet/pet_ai): the moved updatePet/petRangedAttack/petPickTarget
  // reach back for these. All STAY on Sim. `syncPetAspect` is pet-management (the P1b
  // pet-command slice owns it eventually). effectiveAttackPower (C4b decl above, scales
  // the imp bolt) and isHostileTo (C4a decl above, ~20 Sim callers) are already declared,
  // not re-declared here.
  syncPetAspect(pet: Entity, owner: Entity): void;

  // I2c delve companion AI (delves/companion.ts): updateDelveCompanion flips points-at to
  // delves/companion (the binding flips in sim.ts; the decl is M2's, declared above). The
  // shared helpers it consumes (mobSwing/moveToward/isHostileTo/isRooted/moveSpeedMult/
  // swingIntervalMult) are already declared above (M2/C4a), not re-declared here.
  // C5 player auto-attack (src/sim/combat/auto_attack.ts) consumes aggroMob (the shared
  // mob-aggro entry startAutoAttack uses to pull an idle target into combat) and
  // swingIntervalMult (the haste read the driver applies to the next swing timer); both
  // are M2's decls above, points-at Sim. Not re-declared here (dedupe).

  // G2 social plumbing. `setPlayerLevel` backs the /dev level cheat (handleDevChat in
  // social/chat.ts); `notice` is the positive chat-log line the /join /leave handler
  // emits. Both stay on Sim. (hasPendingSocialInvite is already declared above; isRooted/
  // moveSpeedMult/swingIntervalMult are M2 decls above -> all deduped.)
  setPlayerLevel(level: number, pid?: number): void;
  notice(pid: number, text: string, color?: string): void;
  // Dev-only test-dummy spawner backing "/dev bot <name>" (handleDevChat, gated by
  // devCommands). Adds a stationary whisperable player near the primary; returns the
  // new pid, or -1 if the name is blank or already taken. Stays on Sim.
  spawnDevBot(name: string): number;

  // L2 inventory/vendor (src/sim/items.ts): the four helpers the moved useItem
  // dispatches to that STAY on Sim (their owning facets are decided later). W2 owns
  // these declarations; each is a thin late-bound delegate to the still-on-Sim method.
  // startFishing's body stays on Sim (fishing facet TBD); unlockMechChromaFromItem /
  // openSkinSelect are cosmetics internals (facet W7); isSwimming is a shared terrain
  // predicate. unlockMechChromaFromItem's return value flows out through useItem to the
  // server `use` case (result?.type === 'mechChroma').
  startFishing(p: Entity, meta: PlayerMeta): void;
  unlockMechChromaFromItem(
    meta: PlayerMeta,
    itemId: string,
    chromaId: string,
  ): ItemUseResult | undefined;
  openSkinSelect(meta: PlayerMeta, catalog: SkinCatalog, itemId: string): void;
  isSwimming(e: Entity): boolean;

  // W3 interaction (src/sim/interaction.ts): the moved `interact` dispatcher fans into
  // the quest-NPC surface that STAYS on Sim (W4 owns talkToNpc / interactNpcForQuests /
  // isQuestInteractionEntity). These two callbacks are thin late-bound delegates to the
  // still-on-Sim methods; W4 later re-points them into the quests module WITHOUT renaming
  // (append-only). talkToNpc MUST stay a resolvable Sim delegate (external test call sites).
  talkToNpc(npcId: number, pid?: number): void;
  isQuestInteractionEntity(e: Entity): boolean;

  // W5 chat router/readouts (src/sim/social/chat.ts + chat_readouts.ts): the three
  // reach-backs the moved code CONSUMES that stay on Sim / a sibling machine.
  // `targetEntity` is the T1 player target-selection entry the /assist branch calls
  // (thin Sim delegate -> targeting.ts); `partyCapacity` is the party-machine read the
  // partyReadout shows the roster cap against; `marketListingBelongsTo` is the Market
  // ownership test the /listings readout filters with. All append-only, late-bound to Sim.
  targetEntity(id: number | null, pid?: number): void;
  partyCapacity(party: Party | null): number;
  marketListingBelongsTo(listing: MarketListing, meta: PlayerMeta): boolean;
  // B1 bags (src/sim/bags.ts): the capacity pre-check every blocking command
  // path calls before granting (buy/loot/pickup/fish/conjure/collect/trade/
  // turn-in). Stays on Sim next to the addItem/removeItem/countItem hub.
  canAddItem(itemId: string, count: number, pid?: number): boolean;

  // Ravenpost mail (mail/post_office.ts): the quest turn-in core
  // (quests/quest_commands.ts) queues the giver's authored thank-you letter
  // through this; the binding points at the PostOffice instance on Sim.
  queueQuestLetter(questId: string, pid: number): void;
}

// The seam consumed by extracted modules.
export interface SimContext extends SimContextPrimitives, SimContextCallbacks {}

// What `Sim` supplies to build a SimContext. Structurally identical to SimContext
// today, but kept as its own name to make the data flow explicit (Sim -> host ->
// context) and to let the consumed seam narrow independently of the provider later.
export interface SimContextHost extends SimContextPrimitives, SimContextCallbacks {}

// Assemble the immutable SimContext from its host. The primitives stay LIVE (each
// access reads through to the host, so `time`/`tickCount` reflect the current tick
// and `rng`/`entities` are the shared instances); the callbacks pass through
// unchanged (the host already binds them to the Sim). Pure: this constructs no
// state, draws no rng, and reads no clock, so installing the seam cannot perturb
// determinism.
export function createSimContext(host: SimContextHost): SimContext {
  return {
    get rng() {
      return host.rng;
    },
    get time() {
      return host.time;
    },
    get tickCount() {
      return host.tickCount;
    },
    get entities() {
      return host.entities;
    },
    get players() {
      return host.players;
    },
    get primaryId() {
      return host.primaryId;
    },
    get tradeInvites() {
      return host.tradeInvites;
    },
    get duelInvites() {
      return host.duelInvites;
    },
    get nextId() {
      return host.nextId;
    },
    set nextId(v) {
      host.nextId = v;
    },
    get grid() {
      return host.grid;
    },
    get playerGrid() {
      return host.playerGrid;
    },
    get delayedEvents() {
      return host.delayedEvents;
    },
    set delayedEvents(v) {
      host.delayedEvents = v;
    },
    get pendingProjectiles() {
      return host.pendingProjectiles;
    },
    set pendingProjectiles(v) {
      host.pendingProjectiles = v;
    },
    get groundAoEs() {
      return host.groundAoEs;
    },
    get dungeonDoorIds() {
      return host.dungeonDoorIds;
    },
    set dungeonDoorIds(v) {
      host.dungeonDoorIds = v;
    },
    get instances() {
      return host.instances;
    },
    get arenaMatches() {
      return host.arenaMatches;
    },
    get duels() {
      return host.duels;
    },
    get cfg() {
      return host.cfg;
    },
    get trades() {
      return host.trades;
    },
    get arenaQueue1v1() {
      return host.arenaQueue1v1;
    },
    set arenaQueue1v1(v) {
      host.arenaQueue1v1 = v;
    },
    get arenaQueue2v2() {
      return host.arenaQueue2v2;
    },
    set arenaQueue2v2(v) {
      host.arenaQueue2v2 = v;
    },
    get arenaQueueFiesta() {
      return host.arenaQueueFiesta;
    },
    set arenaQueueFiesta(v) {
      host.arenaQueueFiesta = v;
    },
    get arenaBusySlots() {
      return host.arenaBusySlots;
    },
    get nextArenaMatchId() {
      return host.nextArenaMatchId;
    },
    set nextArenaMatchId(v) {
      host.nextArenaMatchId = v;
    },
    get delveRuns() {
      return host.delveRuns;
    },
    get delvePetStash() {
      return host.delvePetStash;
    },
    get utcDay() {
      return host.utcDay;
    },
    get pendingMobRespawns() {
      return host.pendingMobRespawns;
    },
    get partyInvites() {
      return host.partyInvites;
    },
    get chatTokens() {
      return host.chatTokens;
    },
    get channelSubs() {
      return host.channelSubs;
    },
    get pendingLootRolls() {
      return host.pendingLootRolls;
    },
    get nextLootRollId() {
      return host.nextLootRollId;
    },
    set nextLootRollId(v) {
      host.nextLootRollId = v;
    },
    get devCommands() {
      return host.devCommands;
    },
    get marketListings() {
      return host.marketListings;
    },
    emit: host.emit,
    error: host.error,
    lockoutNowMs: host.lockoutNowMs,
    raidResetMs: host.raidResetMs,
    instanceKeyFor: host.instanceKeyFor,
    instanceOriginOf: host.instanceOriginOf,
    enterDungeon: host.enterDungeon,
    leaveDungeon: host.leaveDungeon,
    dealDamage: host.dealDamage,
    handleDeath: host.handleDeath,
    cancelCast: host.cancelCast,
    pushbackCast: host.pushbackCast,
    refreshMobLeashFromAction: host.refreshMobLeashFromAction,
    retargetMob: host.retargetMob,
    nythraxisAddFallbackTarget: host.nythraxisAddFallbackTarget,
    scheduleNythraxisAddDespawnIfBossReset: host.scheduleNythraxisAddDespawnIfBossReset,
    isArenaCrossTeam: host.isArenaCrossTeam,
    arenaTeamOf: host.arenaTeamOf,
    endArenaMatch: host.endArenaMatch,
    endDuel: host.endDuel,
    clearAurasFromSource: host.clearAurasFromSource,
    entityInDungeon: host.entityInDungeon,
    hasPendingSocialInvite: host.hasPendingSocialInvite,
    createFiestaState: host.createFiestaState,
    fiestaStandardize: host.fiestaStandardize,
    updateFiestaActive: host.updateFiestaActive,
    fiestaRestoreChar: host.fiestaRestoreChar,
    clearFiestaAugments: host.clearFiestaAugments,
    readyArenaFighter: host.readyArenaFighter,
    resetForArena: host.resetForArena,
    isArenaTeamWiped: host.isArenaTeamWiped,
    arenaIsDown: host.arenaIsDown,
    arenaAllPids: host.arenaAllPids,
    fiestaTakedown: host.fiestaTakedown,
    fiestaDown: host.fiestaDown,
    rollLoot: host.rollLoot,
    rollWorldBossLoot: host.rollWorldBossLoot,
    applyHeal: host.applyHeal,
    spellCrit: host.spellCrit,
    applyAura: host.applyAura,
    isControlAura: host.isControlAura,
    applyRootAura: host.applyRootAura,
    applyKnockback: host.applyKnockback,
    diminishedCrowdControlDuration: host.diminishedCrowdControlDuration,
    hostilesInRadius: host.hostilesInRadius,
    breakStealth: host.breakStealth,
    applyTaunt: host.applyTaunt,
    summonPet: host.summonPet,
    petOf: host.petOf,
    completeTame: host.completeTame,
    // P1b new shared-helper passthroughs (error/playerGcdFor/healingThreat/countItem
    // already passed through elsewhere - deduped, not re-added).
    spendResource: host.spendResource,
    removeItem: host.removeItem,
    removeFungibleItem: host.removeFungibleItem,
    clearEntityMarker: host.clearEntityMarker,
    partyOf: host.partyOf,
    partyInvite: host.partyInvite,
    removeFromParty: host.removeFromParty,
    dropPartyMarkers: host.dropPartyMarkers,
    onMobKilledForQuests: host.onMobKilledForQuests,
    onInventoryChangedForQuests: host.onInventoryChangedForQuests,
    checkQuestReady: host.checkQuestReady,
    countItem: host.countItem,
    countFungibleItem: host.countFungibleItem,
    completeQuestForDev: host.completeQuestForDev,
    completeCurrentQuestsForDev: host.completeCurrentQuestsForDev,
    addEntity: host.addEntity,
    dropEntity: host.dropEntity,
    rebucket: host.rebucket,
    resolve: host.resolve,
    groundPos: host.groundPos,
    playerMods: host.playerMods,
    delveRunForPlayer: host.delveRunForPlayer,
    delveModuleEntry: host.delveModuleEntry,
    failDelveRun: host.failDelveRun,
    pulseGroundAoE: host.pulseGroundAoE,
    grantXp: host.grantXp,
    enterCombat: host.enterCombat,
    hexOutputMult: host.hexOutputMult,
    critVulnBonus: host.critVulnBonus,
    pvpController: host.pvpController,
    threatMod: host.threatMod,
    clearNonPlayerStatAuras: host.clearNonPlayerStatAuras,
    healingTakenMult: host.healingTakenMult,
    healingThreat: host.healingThreat,
    applyNonPlayerStatAura: host.applyNonPlayerStatAura,
    delveRunForMob: host.delveRunForMob,
    onDelveBossDefeated: host.onDelveBossDefeated,
    grantNythraxisLockout: host.grantNythraxisLockout,
    frenzyPackmates: host.frenzyPackmates,
    armDeathThroes: host.armDeathThroes,
    refreshKnownAbilities: host.refreshKnownAbilities,
    syncPetLevel: host.syncPetLevel,
    // M2 mob locomotion seam.
    moveToward: host.moveToward,
    mobSwing: host.mobSwing,
    updateRangedPetAttack: host.updateRangedPetAttack,
    fleeMoveSpeed: host.fleeMoveSpeed,
    usesProfiledMobCombat: host.usesProfiledMobCombat,
    updateProfiledMobCombat: host.updateProfiledMobCombat,
    tryMobMeleeSwingInRange: host.tryMobMeleeSwingInRange,
    maybeFlee: host.maybeFlee,
    aggroMob: host.aggroMob,
    isStunned: host.isStunned,
    isRooted: host.isRooted,
    moveSpeedMult: host.moveSpeedMult,
    swingIntervalMult: host.swingIntervalMult,
    mobEffectiveMeleeRange: host.mobEffectiveMeleeRange,
    mobCanSwim: host.mobCanSwim,
    resolveMovePoint: host.resolveMovePoint,
    updatePet: host.updatePet,
    isDelveCompanionMob: host.isDelveCompanionMob,
    updateDelveCompanion: host.updateDelveCompanion,
    updateBossMechanics: host.updateBossMechanics,
    updateNythraxisEncounter: host.updateNythraxisEncounter,
    resetNythraxisEncounter: host.resetNythraxisEncounter,
    despawnSummonedAdds: host.despawnSummonedAdds,
    updateFearMovement: host.updateFearMovement,
    delveDetectMult: host.delveDetectMult,
    detonateCorpse: host.detonateCorpse,
    despawnPet: host.despawnPet,
    respawnMob: host.respawnMob,
    resetEvadingMob: host.resetEvadingMob,
    onBossDeath: host.onBossDeath,
    // M3 mob-swing affix cascade seam.
    effectiveArmor: host.effectiveArmor,
    recalcPlayer: host.recalcPlayer,
    // I2a delve run lifecycle bindings. grantXp/despawnPet/delveRunForMob/
    // onDelveBossDefeated/delveDetectMult are bound above (C1/M2/C3); deduped here.
    partyMembersForKey: host.partyMembersForKey,
    addItem: host.addItem,
    // removeItem passed through above (P1b inventory-hub helper) - deduped, not re-added.
    spawnBossAdds: host.spawnBossAdds,
    tradeFor: host.tradeFor,
    duelFor: host.duelFor,
    serializePet: host.serializePet,
    restorePet: host.restorePet,
    despawnPersistentPet: host.despawnPersistentPet,
    isPetClass: host.isPetClass,
    spawnDelveCompanion: host.spawnDelveCompanion,
    despawnDelveCompanion: host.despawnDelveCompanion,
    maybeCompanionBark: host.maybeCompanionBark,
    abandonLockpick: host.abandonLockpick,
    tickLockpickTimeout: host.tickLockpickTimeout,
    startDelveRaiseDeadChannel: host.startDelveRaiseDeadChannel,
    resolvedAbility: host.resolvedAbility,
    playerGcdFor: host.playerGcdFor,
    isFriendlyTo: host.isFriendlyTo,
    isHostileTo: host.isHostileTo,
    lineOfSightBlocked: host.lineOfSightBlocked,
    stopFollow: host.stopFollow,
    tameError: host.tameError,
    standUp: host.standUp,
    breakGhostWolf: host.breakGhostWolf,
    startAutoAttack: host.startAutoAttack,
    revivePet: host.revivePet,
    completeFishing: host.completeFishing,
    applyDemonHealTick: host.applyDemonHealTick,
    awardCombo: host.awardCombo,
    meleeSwing: host.meleeSwing,
    effectiveAttackPower: host.effectiveAttackPower,
    hasLineOfSight: host.hasLineOfSight,
    findChargePath: host.findChargePath,
    runEffects: host.runEffects,
    // P1a pet-AI seam (effectiveAttackPower/isHostileTo already bound above; deduped).
    // C5 auto-attack consumes aggroMob/swingIntervalMult, already passed through above (M2; deduped).
    syncPetAspect: host.syncPetAspect,
    // G2 social plumbing passthroughs (hasPendingSocialInvite already bound above; deduped).
    setPlayerLevel: host.setPlayerLevel,
    notice: host.notice,
    spawnDevBot: host.spawnDevBot,
    // L2 inventory/vendor (W2): the four still-on-Sim helpers the moved useItem dispatches to.
    startFishing: host.startFishing,
    unlockMechChromaFromItem: host.unlockMechChromaFromItem,
    openSkinSelect: host.openSkinSelect,
    isSwimming: host.isSwimming,
    // W3 interaction: the two still-on-Sim quest-NPC delegates the moved interact dispatches to.
    talkToNpc: host.talkToNpc,
    isQuestInteractionEntity: host.isQuestInteractionEntity,
    // W5 chat router/readouts reach-backs (targetEntity/partyCapacity/marketListingBelongsTo).
    targetEntity: host.targetEntity,
    partyCapacity: host.partyCapacity,
    marketListingBelongsTo: host.marketListingBelongsTo,
    // B1 bags capacity pre-check (addItem/removeItem/countItem bound above; deduped).
    canAddItem: host.canAddItem,
    // Ravenpost mail: the quest turn-in letter hook (points at the PostOffice on Sim).
    queueQuestLetter: host.queueQuestLetter,
  };
}
