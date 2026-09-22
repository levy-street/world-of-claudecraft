// World bosses: server-wide elites that rise on a fixed cadence, announce
// themselves, and reward every player who damaged them with PERSONAL loot, gated
// by a real raid lockout per boss (consumed by LOOTING, reset on the shared
// raid-reset boundary).
//
// This module owns the world-boss DATA (the spawn registry) and the pure pieces of
// the system: the per-player loot-lockout gate (a `meta.raidLockouts` entry, one
// source of truth with the raid-lockout UI), the contributor set derived from a
// boss's hate table, and the personal-loot roller. The SCHEDULER state and the
// spawn primitive live on `Sim` (it needs createMob/addEntity/groundPos), which
// drives this module each tick; the loot roller is reached through the SimContext
// seam (ctx.rollWorldBossLoot), exactly like ctx.rollLoot.
//
// Determinism (this is sim-core): no Math.random/Date.now, randomness is ctx.rng
// only, and the lockout boundary is the host lockout clock plus raid-reset instant
// (ctx.lockoutNowMs() / ctx.raidResetMs(), the same pair the dungeon raid lockouts
// use; the host wall clock on the server, the sim clock offline). The
// personal-loot roller draws rng in a FIXED order (contributors sorted by entityId,
// loot entries in array order). Quality follows all contributors' authored draws,
// preserving this kill's ordinary selections before advancing the shared stream.

import { MOBS } from './data';
import { crossedDawn } from './day_night';
import { rollEnemyLootQuality } from './loot/enemy_quality';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { Entity, LootEntry, LootSlot } from './types';

// Sim-time cadence: a fresh boss rises this many seconds after the previous one
// was scheduled. On the live server the sim runs at wall-clock speed (20 Hz), so
// this is "every hour". Lives here with the system that uses it.
export const WORLD_BOSS_INTERVAL_SECONDS = 1 * 3600;

// How long a slain world boss's lootable corpse lingers before it is removed. Much
// longer than a normal corpse (and than the raid needs to clear trash) so every
// contributor has time to walk over and loot their personal drops, INCLUDING those
// who died to the boss and have to run back from the graveyard and resurrect first
// (a ghost cannot loot). Well inside the spawn cadence, so corpse windows never
// overlap. The scheduler drops the entity once this elapses.
export const WORLD_BOSS_CORPSE_SECONDS = 900;

export interface WorldBossDef {
  // MobTemplate id (must have `worldBoss: true`).
  templateId: string;
  // Fixed overworld spawn point (y is grounded at spawn time).
  pos: { x: number; z: number };
  // Seconds of sim time between scheduled spawns.
  intervalSeconds: number;
  // Retail-style HP scaling. The boss spawns at `base` HP and gains `perPlayer` more
  // for each participant beyond the first (counted from its hate table), capped at
  // `max`. It only ever scales UP within a spawn, so a raid that grows keeps the
  // bigger pool even as members die; a fresh spawn resets to `base`.
  hpScale: { base: number; perPlayer: number; max: number };
}

// The world bosses of the live world. One per entry; the scheduler tracks each
// independently. Thunzharr rises at Stormcrag in Thornpeak Heights; Balgath rises beside
// the Starfall Crater in Mirefen Marsh, and only by day (MobTemplate.slumber).
export const WORLD_BOSSES: readonly WorldBossDef[] = [
  {
    templateId: 'thunzharr_waking_peak',
    pos: { x: 110, z: 760 },
    intervalSeconds: WORLD_BOSS_INTERVAL_SECONDS,
    // 40k solo, +5k per extra participant, up to 1M. The per-player step is deliberately
    // gentle: scaleWorldBossHp adds each joiner's delta to CURRENT hp too (real health,
    // not a heal), so a steep step made the bar visibly refill as a raid trickled in and
    // read as "he takes no damage". 5k/head keeps the fight scaling without stalling it.
    hpScale: { base: 40_000, perPlayer: 5_000, max: 1_000_000 },
  },
  {
    templateId: 'balgath_cyclops',
    // APPENDED, never inserted ahead of Thunzharr: the scheduler keys its per-boss timers
    // by INDEX into this array (`worldBossNextAt`), so reordering silently re-points every
    // live timer and every test that forces a spawn by index.
    //
    // Beside the Starfall Crater, east Mirefen: 40 yards south-west of the centre of the
    // bowl Brother Aldric's fallen star dug (MIREFEN_IMPACT_CRATER in world.ts), just off
    // its rim band, and where he sleeps. Picked by measurement rather than by eye: dry
    // ground, under two yards of relief across a
    // 13-unit arena, 45+ yards clear of the Widow Thicket spider camps (MAX_AGGRO_RADIUS
    // is 20, so a level-eight fighting spiders at the camp's edge cannot pull him), and
    // outside the crater's bowl and rim band so his raid-floor pad never flattens the
    // fixture. He is a daytime boss (MobTemplate.slumber): at dusk he walks back here
    // and lies down beside the star, at dawn he rises from it.
    pos: { x: 128, z: 262 },
    intervalSeconds: WORLD_BOSS_INTERVAL_SECONDS,
    // Deliberately a smaller pool and a gentler step than Thunzharr's. Mirefen is the zone
    // players quit in, so this boss has to be killable by whoever actually turns up rather
    // than by a formed raid: a gathered group gets there, and a bigger crowd still scales
    // without the bar visibly refilling as they trickle in (scaleWorldBossHp adds each
    // joiner's delta to CURRENT hp, not just to max).
    hpScale: { base: 24_000, perPlayer: 3_500, max: 600_000 },
  },
];

/** The scheduler's live state, owned by `Sim` and handed in as views: one slot per
 *  WORLD_BOSSES entry (index-keyed, which is why the registry is append-only). */
export interface WorldBossClock {
  /** The day/night phase the previous pass observed (null until a clocked host ticks). */
  lastPhase: number | null;
}
export interface WorldBossScheduleState {
  /** Sim time each slot's interval next comes due. */
  nextAt: number[];
  /** The live (or lingering-corpse) entity per slot, null when none. */
  entityIds: (number | null)[];
  /** Slumbering bosses only: set once a slain boss's corpse is gone, held until the next
   *  DAWN spawns him again. While set, the interval cadence is ignored for that slot, so
   *  "he rises again at sunrise" is literally true: a kill at noon is a kill for the rest
   *  of the day. Never set without a day/night clock. Process-local like every other
   *  slot timer here (none is persisted): a realm restart puts him back on the boot
   *  cadence (`worldBossAtBoot`), exactly as Thunzharr has always come back on a restart. */
  riseAtDawn: boolean[];
  clock: WorldBossClock;
}

/**
 * The per-tick scheduler pass. Per slot: when the live boss is gone, clear the slot (and
 * once its lootable corpse window has elapsed, remove the corpse plus any summoned adds).
 * When the interval comes due, advance it and, if no boss is up, spawn a fresh one. A
 * slumbering boss (MobTemplate.slumber) additionally waits for SUNRISE after a kill: the
 * dawn edge is the crossing since the previous pass, so it fires exactly once per day.
 * Draws no rng and allocates no ids until a spawn actually fires (which never happens
 * inside the short parity scenarios), so existing determinism traces are unaffected.
 */
export function tickWorldBossSchedule(
  ctx: SimContext,
  state: WorldBossScheduleState,
  spawn: (def: WorldBossDef) => number | null,
): void {
  // One clock read per pass, shared by every slot. `dawn` is never true without a clock
  // and never true twice for one sunrise.
  const phase = ctx.dayNightPhase();
  const dawn =
    phase !== null && state.clock.lastPhase !== null && crossedDawn(state.clock.lastPhase, phase);
  state.clock.lastPhase = phase;
  for (let i = 0; i < WORLD_BOSSES.length; i++) {
    const def = WORLD_BOSSES[i];
    // A slumbering boss keeps the interval cadence on a clockless host (tests, the RL
    // env): with no night there is no dawn to wait for.
    const slumbers = phase !== null && !!MOBS[def.templateId]?.slumber;
    const liveId = state.entityIds[i];
    if (liveId !== null) {
      const boss = ctx.entities.get(liveId);
      if (!boss) {
        state.entityIds[i] = null;
      } else if (!boss.dead) {
        // Grow the HP pool with the raid size (retail-style, up to the cap).
        scaleWorldBossHp(ctx, boss, def);
      }
      if (boss?.dead) {
        // Lootable corpse lingers WORLD_BOSS_CORPSE_SECONDS for contributors to loot, then
        // is removed; respawnTimer is Infinity (handleDeath) so the normal in-place
        // respawn never fires; only this scheduler respawns it.
        if (boss.corpseTimer <= 0) {
          for (const addId of boss.summonedIds) ctx.dropEntity(addId);
          ctx.dropEntity(liveId);
          state.entityIds[i] = null;
          // A slain sleeper is gone until sunrise, whatever the interval says.
          if (slumbers) state.riseAtDawn[i] = true;
        }
      }
    }
    if (ctx.time >= state.nextAt[i]) {
      state.nextAt[i] += def.intervalSeconds;
      if (state.entityIds[i] === null && !state.riseAtDawn[i]) state.entityIds[i] = spawn(def);
    }
    if (slumbers && state.riseAtDawn[i] && dawn && state.entityIds[i] === null) {
      state.riseAtDawn[i] = false;
      state.entityIds[i] = spawn(def);
    }
  }
}

// The raid-lockout id under which a looted world boss is BOTH gated and shown in the
// raid-lockout timer UI. Prefixed so it never collides with a real dungeon id (the
// dungeon enter-gate keys on bare dungeon ids and never matches this) and so the HUD
// name resolver can spot it and localize it as a mob name. See raidLockoutPanelView in
// hud.ts. The world boss is a genuine raid lockout: the SAME `meta.raidLockouts` entry
// that renders the countdown is what the eligibility gate reads, so the displayed timer
// is exactly the loot lockout, and it resets on the same boundary as the raids.
export const WORLD_BOSS_LOCKOUT_PREFIX = 'worldboss:';
export function worldBossLockoutId(bossId: string): string {
  return WORLD_BOSS_LOCKOUT_PREFIX + bossId;
}
// The boss mob id inside a world-boss lockout id, or null for any other (dungeon)
// lockout id. The HUD calls this so the prefix convention lives in ONE place.
export function worldBossIdFromLockout(lockoutId: string): string | null {
  return lockoutId.startsWith(WORLD_BOSS_LOCKOUT_PREFIX)
    ? lockoutId.slice(WORLD_BOSS_LOCKOUT_PREFIX.length)
    : null;
}

// Eligible if this player holds no unexpired world-boss lockout for this boss. Reads
// the exact same `meta.raidLockouts` entry the raid-lockout UI renders (one source of
// truth), so gate and display can never disagree. `nowMs` is the host lockout clock
// (`ctx.lockoutNowMs()`); like the raid lockouts this is the host wall clock on the
// server and the sim clock offline, never a deterministic-tick value.
export function isWorldBossLootEligible(meta: PlayerMeta, bossId: string, nowMs: number): boolean {
  const until = meta.raidLockouts.get(worldBossLockoutId(bossId));
  return until === undefined || until <= nowMs;
}

// Record that this player looted this boss, locking them out until `untilMs` (the host's
// next raid-reset instant, `ctx.raidResetMs(ctx.lockoutNowMs())`, the same boundary the
// dungeon raids reset on). Called from lootCorpse when a personal world-boss slot is
// actually taken, NOT at kill/roll time. This single write is both the eligibility gate
// (isWorldBossLootEligible) and the rendered raid-lockout countdown.
export function markWorldBossLooted(meta: PlayerMeta, bossId: string, untilMs: number): void {
  if (untilMs > 0) meta.raidLockouts.set(worldBossLockoutId(bossId), untilMs);
}

// The players who contributed to (damaged or healed against) this boss, derived
// from its hate table. Pet threat is credited to the pet's owner; the set is
// deduped and resolved to live PlayerMeta, then sorted by entityId so any
// downstream rng draws happen in a fixed order. Read BEFORE handleDeath clears the
// boss's threat.
export function worldBossContributors(ctx: SimContext, mob: Entity): PlayerMeta[] {
  const seen = new Set<number>();
  const out: PlayerMeta[] = [];
  for (const attackerId of mob.threat.keys()) {
    const attacker = ctx.entities.get(attackerId);
    // controlled pets credit their owner; everyone else credits themselves. A pet
    // already despawned at the death frame cannot resolve to its owner (the hate
    // table holds only the pet's id), so that credit is dropped: rare, and
    // deterministic either way.
    const pid = attacker && attacker.ownerId !== null ? attacker.ownerId : attackerId;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const meta = ctx.players.get(pid);
    if (meta && !meta.leaving) out.push(meta);
  }
  return out.sort((a, b) => a.entityId - b.entityId);
}

// The LOOT roster for a slain world boss: everyone eligible for a personal drop. This
// is the permanent damager set (`mob.bossDamagers`, every player who hit the boss since
// it was pulled, never pruned) UNIONED with whoever still remains on the live hate table
// at death (a healer who threat-built but never dealt damage; pet threat credited to the
// owner). Deduped, resolved to live PlayerMeta, sorted by entityId so downstream rng
// draws stay in a fixed order. Unlike worldBossContributors (the hate-table-only view the
// HP scaler uses), this SURVIVES a contributor dying or dropping off threat: the whole
// point is that a raider who died to the boss still gets their loot. Read BEFORE
// handleDeath clears the boss's threat (the damager set survives that clear regardless).
export function worldBossLootContributors(ctx: SimContext, mob: Entity): PlayerMeta[] {
  const seen = new Set<number>();
  const out: PlayerMeta[] = [];
  const add = (pid: number) => {
    if (seen.has(pid)) return;
    seen.add(pid);
    const meta = ctx.players.get(pid);
    if (meta && !meta.leaving) out.push(meta);
  };
  // Permanent damagers (already owner-resolved player ids), then anyone still on the
  // hate table (pets credit their owner, exactly as worldBossContributors resolves).
  for (const pid of mob.bossDamagers) add(pid);
  for (const attackerId of mob.threat.keys()) {
    const attacker = ctx.entities.get(attackerId);
    add(attacker && attacker.ownerId !== null ? attacker.ownerId : attackerId);
  }
  return out.sort((a, b) => a.entityId - b.entityId);
}

// Retail-style participant HP scaling, driven each tick by the scheduler while the
// boss is alive. The target pool is `base + perPlayer * (participants - 1)` clamped
// to `max`, where participants is the deduped player count on the hate table. It only
// grows the pool (never shrinks it within a spawn, so members dying does not make the
// boss easier), and adds the same delta to current HP so the extra health is real,
// not a heal. Draws no rng (pure arithmetic over a sorted set), so it never perturbs
// the shared draw stream.
export function scaleWorldBossHp(ctx: SimContext, boss: Entity, def: WorldBossDef): void {
  // Once the pool is at the cap it can never grow again, so skip the per-tick
  // contributors recompute (a dedupe + sort over the hate table) for the rest of the
  // fight, which is thousands of ticks.
  if (boss.maxHp >= def.hpScale.max) return;
  const participants = worldBossContributors(ctx, boss).length;
  const target = Math.min(
    def.hpScale.max,
    def.hpScale.base + def.hpScale.perPlayer * Math.max(0, participants - 1),
  );
  if (target > boss.maxHp) {
    const delta = target - boss.maxHp;
    boss.maxHp = target;
    // Adding delta to current HP too nudges the HP FRACTION up (a boss at 50% of 40k
    // becomes ~58% of 48k). That is intentional ("real health, not a heal"), but note
    // the side effect: a participant joining right as the boss crosses an hp-fraction
    // threshold (the 20% enrage, a summonAdds gate) can push it back above and delay
    // that trigger. Acceptable: it only ever happens while the raid is still growing.
    boss.hp = Math.min(boss.maxHp, boss.hp + delta);
  }
}

// Drop PERSONAL loot for a slain world boss: every contributor who has not already
// looted this boss today gets an independent roll of the boss's loot table, added
// to the shared corpse as `personalFor` slots only that player can take. Mirrors
// rollLoot's per-entry semantics (exclusive rollGroups via one partitioned draw,
// plain per-entry chance) but runs the whole table once per eligible contributor.
// SUPPORTED ENTRY SHAPES: itemId with optional rollGroup and optional maxPlayerLevel.
// Unlike rollLoot, there is no questId gating and no per-entry copper here; a
// world-boss loot table must not use those fields (they would hand quest items to
// everyone ungated / silently drop the copper).
//
// LEVEL-GATED ENTRIES (maxPlayerLevel): a whole roll group, or a lone entry, meant
// for the low-level locals a zone boss fights beside. The gate is checked per
// contributor against the level of their own character, and a group NOBODY in the
// roster qualifies for is still rolled for each of them (one draw, discarded) so the
// rng draw order is a function of the roster alone, never of who is what level.
export function rollWorldBossLoot(ctx: SimContext, mob: Entity, contributors: PlayerMeta[]): void {
  const template = MOBS[mob.templateId];
  if (!template) return;
  const items: LootSlot[] = [];
  const copper = mob.loot?.copper ?? 0;
  // contributors arrive sorted by entityId (worldBossLootContributors); iterate in
  // that fixed order so the rng draw order is deterministic for the parity gate.
  // Eligibility is checked here, but the lockout is consumed only when the player
  // actually LOOTS a personal slot (lootCorpse in interaction.ts): a contributor who
  // dies or never reaches the corpse inside the loot window keeps their lockout and
  // can try again at the next spawn. The corpse window (WORLD_BOSS_CORPSE_SECONDS)
  // never overlaps the spawn cadence, so at most one corpse is ever lootable at a time.
  for (const meta of contributors) {
    if (!isWorldBossLootEligible(meta, mob.templateId, ctx.lockoutNowMs())) continue;
    const level = ctx.entities.get(meta.entityId)?.level ?? Number.POSITIVE_INFINITY;
    const qualifies = (entry: LootEntry): boolean =>
      entry.maxPlayerLevel === undefined || level <= entry.maxPlayerLevel;
    const rolledGroups = new Set<string>();
    // At most ONE roll-group (gear) item per contributor: no double gear drop (a glove
    // AND a belt) from a single kill. Every group is still ROLLED so the rng draw order
    // is unchanged (the parity gate depends on it); we just discard a second gear win.
    // Ungrouped entries (the guaranteed storm trophy) are unaffected and always drop.
    let gearWon = false;
    for (const entry of template.loot) {
      if (entry.rollGroup) {
        if (rolledGroups.has(entry.rollGroup)) continue;
        rolledGroups.add(entry.rollGroup);
        const group = template.loot.filter((l) => l.rollGroup === entry.rollGroup);
        const roll = ctx.rng.next();
        let cumulative = 0;
        for (const g of group) {
          cumulative += g.chance;
          if (roll < cumulative) {
            if (g.itemId && !gearWon && qualifies(g)) {
              items.push({ itemId: g.itemId, count: 1, personalFor: [meta.entityId] });
              gearWon = true;
            }
            break;
          }
        }
        continue;
      }
      if (!ctx.rng.chance(entry.chance)) continue;
      if (entry.itemId && qualifies(entry))
        items.push({ itemId: entry.itemId, count: 1, personalFor: [meta.entityId] });
    }
  }
  const selected = [...(mob.loot?.items ?? []), ...rollEnemyLootQuality(ctx.rng, mob, items)];
  if (copper > 0 || selected.length > 0) {
    mob.loot = { copper, items: selected };
    mob.lootable = true;
  }
}
