// Boss corpse hold: a slain instance boss keeps its lootable corpse standing
// for BOSS_CORPSE_HOLD_SECONDS instead of the CORPSE_DURATION window trash gets.
//
// Why: corpseTimer is the LOOT WINDOW, not only a decay clock. Once it reaches
// zero the corpse reads as decayed (respawn_policy.ts corpseHasDecayed):
// lootCorpse refuses it, expireDecayedCorpseInteractions (mob/locomotion.ts)
// clears lootable, server/game.ts flags it `cd` on the wire, and
// entity_view_policy_core.ts drops its view on every client. An INSTANCE mob
// never respawns in place (the respawn gate in mob/locomotion.ts skips it), so
// before the decay signal existed its corpse stayed lootable for as long as
// the instance stood; with it, a rift or dungeon boss went unlootable AND
// invisible 60s after the kill while its loot was still sitting on the entity
// (a first-clear ring personal to one member, a rolled epic nobody had taken
// yet). A raid-sized party finishing adds, resolving need/greed rolls, or
// resurrecting the member who died to the boss routinely takes longer than
// that, and that member then found no body to loot.
//
// The hold applies to a camp-placed `boss` template inside an instance (rift
// floors, dungeons, raids, delves: spawnPos beyond DUNGEON_X_THRESHOLD, the
// same predicate the respawn gate uses), and to a named mid-boss that opts in
// with MobTemplate.bossCorpseHold: the Hollow Crypt's wing bosses carry boss
// loot without the `boss` flag, and Sexton Marrow's corpse went unlootable a
// minute after a kill that leaves his Restless Bones standing. An authored fixed schedule
// (`respawnSeconds`) caps it exactly as it caps the default decay in
// handleDeath, so such a mob returns on schedule whether or not it was looted.
// Everything else keeps the classic 60s decay, deliberately:
// - trash, ordinary elites, and rares: the classic window is the design;
// - an open-world boss: it respawns IN PLACE on its zone cadence (Warlord
//   Drogmar every three minutes, most others on the trash delay), and the
//   respawn gate defers an in-place respawn while the corpse is still
//   lootable, so a hold there would let one unlooted kill block a required
//   quest kill. Script summons (the Bound Guardian rite, summonQuestMob) carry
//   no marker that separates them from a camp placement either, and a held
//   summon corpse would pile bodies at its altar. The open world is left
//   alone wholesale rather than guessed at;
// - a world boss: its corpse window is WORLD_BOSS_CORPSE_SECONDS, owned by the
//   world-boss scheduler, and that corpse also BLOCKS the next scheduled spawn
//   (updateWorldBosses only spawns into an empty slot), so lengthening it would
//   silently skip an hourly spawn after any kill in the back half of the hour;
// - a per-player summon (`runScoped` / `summonedAdd`): every summon mints a
//   fresh entity and the corpse decay is its only teardown.
// Bounds from outside the hold, so a held corpse never outlives its instance:
// the instance reapers free an empty instance on their own timeouts and drop
// every entity with it; a rift descent tears the floor down the same way; and
// the idle cull (isInertInstanceCorpse) FREEZES corpseTimer while no player is
// near, so the hold is measured in attended seconds, not wall-clock seconds.
// The loot-side clamps stay in charge of an EMPTIED corpse: pruneCorpseLoot
// collapses a boss corpse with nothing left exactly as before, so the hold
// alone never keeps an empty body standing. The one exception is opt-in and
// raid-scoped (MobTemplate.corpseStandsInInstance, the Smith's Heart bosses,
// see corpseStandsUntilTeardown below). No shipped boss carries harvest
// componentTags, so the harvest-half grace clamp (interaction.ts harvestCorpse)
// never meets a held boss.
//
// `src/sim`-pure and rng-free: no DOM/Three/render/ui/game/net imports, no
// Math.random/Date.now, no draw sites.

import { DUNGEON_X_THRESHOLD } from '../data';
import type { Entity, MobTemplate } from '../types';

/** How long a slain instance boss's lootable corpse stands (seconds). */
export const BOSS_CORPSE_HOLD_SECONDS = 30 * 60;

// ---- a body that stands until the instance goes ------------------------------------------
// A Smith's Heart boss is a set piece, not a loot bag: the Masterless Strength
// dies kneeling as a broken stone husk (render smith_heart_fx/final_death_core.ts),
// the guardians in their own death poses, and Jose's call (2026-11-20) is that
// the bodies stay in the raid after they are looted instead of popping out four
// seconds later. A template opts in with MobTemplate.corpseStandsInInstance.
// Mechanics, all on existing signals so nothing new crosses the wire:
// - pruneCorpseLoot (loot/loot_roll.ts), on emptying such a corpse, takes it
//   straight to the DECAYED state (lootable false, corpseTimer 0) instead of the
//   four-second fast arm. Decayed is the one state every consumer already reads
//   as "nothing here": lootCorpse/autoloot/buddy autoloot refuse it, the corpse
//   interaction gate refuses it (no loot cursor, no harvest), dead_target makes
//   it unselectable, the wire flags it `cd`, the coffer goes to its empty mood.
//   A hold that runs out unlooted lands in the same state through the ordinary
//   countdown, so there is one "husk" state, not two.
// - entity_view_policy_core.ts keeps the VIEW of a decayed corpse when this
//   predicate says the body stands, so it is drawn on the offline world and on
//   every online client alike (both carry templateId and pos; the online mirror
//   derives corpseTimer 0 from `cd`). Its death pose is the dead state's, which
//   nothing here touches.
// - Teardown: an instance mob never respawns or drops in place (the dead branch
//   of updateMob skips it), so the body leaves with its instance when the
//   reaper frees it. The idle cull still skips the inert corpse, so the cost is
//   the one entity the boss already was, and nothing per tick.
// Scoped to instance placements (pos past DUNGEON_X_THRESHOLD, read off the
// body's position so the server and the online mirror agree without spawnPos on
// the wire): a dev spawn in the open world keeps the classic decay. A pending
// loot roll still keeps the corpse open first (pruneCorpseLoot's roll arm runs
// before this one), and no draw site is touched.

type StandTemplate = Pick<MobTemplate, 'corpseStandsInInstance' | 'worldBoss'>;
type StandBody = Pick<Entity, 'kind' | 'pos'>;

/** Whether this dead body stays standing (looted or not) until its instance is
 *  torn down, rather than decaying out of view. */
export function corpseStandsUntilTeardown(
  template: StandTemplate | undefined,
  body: StandBody,
): boolean {
  if (body.kind !== 'mob' || !template?.corpseStandsInInstance) return false;
  if (template.worldBoss === true) return false;
  return body.pos.x > DUNGEON_X_THRESHOLD;
}

type HoldTemplate = Pick<MobTemplate, 'boss' | 'bossCorpseHold' | 'worldBoss' | 'respawnSeconds'>;
type HoldMob = Pick<Entity, 'spawnPos' | 'summonedAdd' | 'runScoped'>;

/** A `boss` template (or a mid-boss opted in with `bossCorpseHold`) the hold
 * can apply to: world bosses keep their scheduler-owned window (see the
 * header). */
export function isHeldBossTemplate(template: HoldTemplate | undefined): boolean {
  if (!template || template.worldBoss === true) return false;
  return template.boss === true || template.bossCorpseHold === true;
}

/**
 * Seconds a fresh boss corpse must stay lootable: 0 when no hold applies (a
 * non-boss, a world boss, an open-world placement, a per-player summon), else
 * the full hold, capped by an authored `respawnSeconds`.
 */
export function bossCorpseHoldSeconds(template: HoldTemplate | undefined, mob: HoldMob): number {
  if (!template || !isHeldBossTemplate(template)) return 0;
  if (mob.summonedAdd || mob.runScoped) return 0;
  if (mob.spawnPos.x <= DUNGEON_X_THRESHOLD) return 0;
  return template.respawnSeconds === undefined
    ? BOSS_CORPSE_HOLD_SECONDS
    : Math.min(BOSS_CORPSE_HOLD_SECONDS, template.respawnSeconds);
}

/**
 * Raise a slain boss's corpseTimer to its hold. Never lowers it: a longer
 * window already granted (a pending loot roll's extension) stands. Call after
 * handleDeath has assigned the corpse and respawn timers.
 */
export function applyBossCorpseHold(e: Entity, template: HoldTemplate | undefined): void {
  const hold = bossCorpseHoldSeconds(template, e);
  if (hold > e.corpseTimer) e.corpseTimer = hold;
}
