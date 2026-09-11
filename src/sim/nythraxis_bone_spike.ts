// Bone Spike: Nythraxis impales raiders on spikes the DPS must shatter.
//
// On each cast the boss picks NYTHRAXIS_BONE_SPIKE_VICTIMS distinct players
// (anyone but the aggro holder, minus raiders already carrying a personal
// mechanic), pins each under an unbreakable, encounter-owned stun (the client
// drapes the death pose over it), and raises a stationary Bone Spike mob at the
// victim's feet. The victim drains a fraction of max hp every second until the
// spike dies; killing it frees them at once. A raider who has just been
// impaled is off the pick list for NYTHRAXIS_BONE_SPIKE_COOLDOWN_SECONDS
// (owner call, 2026-09-11: one raider could be spiked four waves running), so
// consecutive waves spread across the raid. The pure pieces live here (tuning,
// eligibility, the cooldown ledger, the aura shape, the spike template
// contract); the driver in encounters/nythraxis.ts owns the cadence, the rng
// picks, the spawns, and the drain ticks.
//
// `src/sim`-pure: no rng, no wall clock, no DOM.

import type { DungeonDifficulty, Entity, NythraxisBoneSpikeCooldown } from './types';

export const NYTHRAXIS_BONE_SPIKE_ID = 'nythraxis_bone_spike';
export const NYTHRAXIS_BONE_SPIKE_CAST_ID = 'Bone Spike';
export const NYTHRAXIS_IMPALED_AURA_ID = 'nythraxis_impaled';
export const NYTHRAXIS_IMPALED_AURA_NAME = 'Impaled';
export const NYTHRAXIS_BONE_SPIKE_FIRST_SECONDS = 12;
export const NYTHRAXIS_BONE_SPIKE_EVERY_NORMAL = 24;
export const NYTHRAXIS_BONE_SPIKE_EVERY_HEROIC = 20;
/**
 * Spikes and fire never overlap (owner playtest, 2026-09-04: raiders pinned in
 * a circle they were about to leave). A spike cast holds while a Grave
 * Eruption is telegraphing and for this long after it lands; an eruption holds
 * this long after a spike wave; a held cast polls again every
 * NYTHRAXIS_BONE_SPIKE_RETRY_SECONDS instead of skipping a whole cycle.
 */
export const NYTHRAXIS_BONE_SPIKE_FIRE_SETTLE_SECONDS = 3;
export const NYTHRAXIS_BONE_SPIKE_RETRY_SECONDS = 1;
/**
 * A due cast that finds nobody eligible (everyone but the aggro holder is
 * marked, impaled, in fire, dead, or still inside their cooldown) re-polls
 * after this long instead of skipping a whole cadence. A partial wave (one
 * victim where the difficulty wants two or three) is a real cast and re-arms
 * the full cadence.
 */
export const NYTHRAXIS_BONE_SPIKE_EMPTY_RETRY_SECONDS = 3;
/**
 * No spike lands in the run-up to Deathless Rage, so the wardstone channelers
 * are free to reach their stones; anyone still impaled when the cast begins
 * is freed by it (the calm window frees everyone).
 */
export const NYTHRAXIS_BONE_SPIKE_RAGE_LEAD_SECONDS = 8;
export const NYTHRAXIS_BONE_SPIKE_VICTIMS_NORMAL = 2;
export const NYTHRAXIS_BONE_SPIKE_VICTIMS_HEROIC = 3;
/**
 * Seconds after a raider is impaled during which no Bone Spike cast (the
 * cadence cast or the Bone Storm one) may pick them again. Measured from the
 * impale, not the release: it is a share-the-load rule, so the clock runs
 * while they are still pinned. Longer than two normal cadences (48 s) and two
 * heroic ones (40 s), so a raider sits out at least the next two waves.
 */
export const NYTHRAXIS_BONE_SPIKE_COOLDOWN_SECONDS = 55;
/**
 * A spike is a ward (owner call, 2026-09-11, the League of Legends idiom): it
 * takes HITS to clear, not damage. Its health pool IS the hit count, so the
 * health bar reads as hits remaining, and every damaging hit from any player
 * or player-owned pet, whatever it would have dealt (a poke, a crit, a DoT
 * tick), lands exactly NYTHRAXIS_BONE_SPIKE_HIT_DAMAGE. The rule is applied
 * at the one damage funnel (combat/damage.ts dealDamage) through
 * nythraxisBoneSpikeWardHit below.
 */
export const NYTHRAXIS_BONE_SPIKE_HITS_NORMAL = 4;
export const NYTHRAXIS_BONE_SPIKE_HITS_HEROIC = 6;
export const NYTHRAXIS_BONE_SPIKE_HIT_DAMAGE = 1;
export const NYTHRAXIS_IMPALED_TICK_SECONDS = 1;
export const NYTHRAXIS_IMPALED_TICK_MAX_HP_NORMAL = 0.08;
export const NYTHRAXIS_IMPALED_TICK_MAX_HP_HEROIC = 0.1;
// The impale aura outlives any realistic spike: it is removed by the spike's
// death, the transition, a wipe, or the kill, never by its own timer.
export const NYTHRAXIS_IMPALED_AURA_SECONDS = 600;

export function nythraxisBoneSpikeCadence(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_BONE_SPIKE_EVERY_HEROIC
    : NYTHRAXIS_BONE_SPIKE_EVERY_NORMAL;
}

export function nythraxisBoneSpikeVictims(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_BONE_SPIKE_VICTIMS_HEROIC
    : NYTHRAXIS_BONE_SPIKE_VICTIMS_NORMAL;
}

export function nythraxisBoneSpikeHits(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_BONE_SPIKE_HITS_HEROIC
    : NYTHRAXIS_BONE_SPIKE_HITS_NORMAL;
}

/** True for a live Bone Spike mob. */
export function isNythraxisBoneSpike(entity: Entity | null | undefined): boolean {
  return (
    !!entity &&
    entity.kind === 'mob' &&
    entity.templateId === NYTHRAXIS_BONE_SPIKE_ID &&
    !entity.dead
  );
}

/**
 * True when `source` hitting `target` is a ward hit: the target is a live
 * spike and the source is a player or a player-owned pet ("hits from
 * anyone"). Wild mobs, the boss included, never chip a spike this way.
 */
export function nythraxisBoneSpikeWardHit(
  source: Entity | null | undefined,
  target: Entity,
): boolean {
  if (!source || !isNythraxisBoneSpike(target)) return false;
  return source.kind === 'player' || (source.kind === 'mob' && source.ownerId !== null);
}

export function nythraxisImpaledTickMaxHp(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_IMPALED_TICK_MAX_HP_HEROIC
    : NYTHRAXIS_IMPALED_TICK_MAX_HP_NORMAL;
}

/** The impale aura this boss holds on the player, if any. */
export function nythraxisImpaledAura(player: Entity, bossId: number) {
  return player.auras.find(
    (aura) => aura.id === NYTHRAXIS_IMPALED_AURA_ID && aura.sourceId === bossId,
  );
}

export function isNythraxisImpaled(player: Entity, bossId: number): boolean {
  return nythraxisImpaledAura(player, bossId) !== undefined;
}

const NO_IDS: ReadonlySet<number> = new Set();

/**
 * Who a Bone Spike cast may pick: living players in the room, never the aggro
 * holder, never someone already impaled, never a live Soul Rend carrier (one
 * personal mechanic per raider), never a raider still inside the cooldown
 * their last impale started. The order is the caller's (entity-id sorted
 * room roster), so the driver's rng.int picks stay deterministic.
 */
export function nythraxisBoneSpikeCandidates(
  room: readonly Entity[],
  bossId: number,
  aggroTargetId: number | null,
  soulRendMarkedIds: ReadonlySet<number>,
  standingInFire: (player: Entity) => boolean = () => false,
  onCooldownIds: ReadonlySet<number> = NO_IDS,
): Entity[] {
  return room.filter(
    (player) =>
      !player.dead &&
      player.id !== aggroTargetId &&
      !soulRendMarkedIds.has(player.id) &&
      !isNythraxisImpaled(player, bossId) &&
      !onCooldownIds.has(player.id) &&
      // never pinned in fire they cannot step out of
      !standingInFire(player),
  );
}

/**
 * The cooldown ledger after `seconds` pass: every entry counts down and any
 * that reaches zero is dropped. Returns a new list; the input is untouched.
 */
export function tickNythraxisBoneSpikeCooldowns(
  cooldowns: readonly NythraxisBoneSpikeCooldown[],
  seconds: number,
): NythraxisBoneSpikeCooldown[] {
  const next: NythraxisBoneSpikeCooldown[] = [];
  for (const entry of cooldowns) {
    const remaining = entry.remaining - seconds;
    if (remaining > 1e-9) next.push({ playerId: entry.playerId, remaining });
  }
  return next;
}

/**
 * The ledger with every id in `playerIds` armed at the full cooldown (an id
 * already cooling restarts, so a Bone Storm spike right after a cadence spike
 * still counts from the latest impale). Returns a new list.
 */
export function withNythraxisBoneSpikeCooldowns(
  cooldowns: readonly NythraxisBoneSpikeCooldown[],
  playerIds: readonly number[],
): NythraxisBoneSpikeCooldown[] {
  const armed = new Set(playerIds);
  const kept = cooldowns.filter((entry) => !armed.has(entry.playerId));
  const fresh = playerIds.map((playerId) => ({
    playerId,
    remaining: NYTHRAXIS_BONE_SPIKE_COOLDOWN_SECONDS,
  }));
  return [...kept, ...fresh];
}

/** The ids the ledger currently keeps out of a Bone Spike pick. */
export function nythraxisBoneSpikeCooldownIds(
  cooldowns: readonly NythraxisBoneSpikeCooldown[],
): Set<number> {
  return new Set(cooldowns.map((entry) => entry.playerId));
}

/**
 * The wardstone channel's control gate: every stun, stasis, incapacitate, or
 * polymorph locks it EXCEPT this boss's own Impale. A spiked raider already
 * within reach of a wardstone may channel it (owner decision, 2026-09-04): the
 * spike holds their body, not their will.
 */
export function isNythraxisWardChannelLocked(player: Entity, bossId: number): boolean {
  return player.auras.some(
    (aura) =>
      (aura.kind === 'stun' ||
        aura.kind === 'stasis' ||
        aura.kind === 'incapacitate' ||
        aura.kind === 'polymorph') &&
      !(aura.id === NYTHRAXIS_IMPALED_AURA_ID && aura.sourceId === bossId),
  );
}

/** The aura an impaled raider carries; value2 is the spike entity that holds them. */
export function nythraxisImpaledAuraFor(bossId: number, spikeId: number) {
  return {
    id: NYTHRAXIS_IMPALED_AURA_ID,
    name: NYTHRAXIS_IMPALED_AURA_NAME,
    kind: 'stun' as const,
    remaining: NYTHRAXIS_IMPALED_AURA_SECONDS,
    duration: NYTHRAXIS_IMPALED_AURA_SECONDS,
    value: 0,
    value2: spikeId,
    sourceId: bossId,
    school: 'shadow' as const,
    unbreakableControl: true as const,
    encounterOwned: true as const,
  };
}

/**
 * Hold a Bone Spike in place: it never walks, aggroes, or swings. Mirrors the
 * pin Ignivar's Heart of the End uses, called from the mob tick dispatcher
 * before any generic AI can move it.
 */
export function pinNythraxisBoneSpike(spike: Entity): void {
  if (spike.templateId !== NYTHRAXIS_BONE_SPIKE_ID || spike.dead) return;
  spike.pos = { ...spike.spawnPos };
  spike.prevPos = { ...spike.spawnPos };
  spike.vx = 0;
  spike.vz = 0;
  spike.aggroTargetId = null;
  spike.inCombat = true;
  spike.aiState = 'attack';
  spike.swingTimer = Number.POSITIVE_INFINITY;
}
