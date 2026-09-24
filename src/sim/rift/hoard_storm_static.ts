import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { hoardMechanicDamage } from './hoard_scaling';
import type { HoardBossCue, HoardBossState, RiftInstance } from './types';

export const HOARD_STATIC_RADIUS = 6;
export const HOARD_STATIC_WARNING_SEC = 3;
export const HOARD_STATIC_DAMAGE_FRACTION = 0.25;
type MarkCue = Extract<HoardBossCue, { kind: 'mark' }>;

/** Only the Hoard version trades its unannounced melee shove for a spread check. */
export function suppressHoardStormShove(ctx: SimContext, mob: Entity): boolean {
  if (mob.templateId === 'rift_boss_storm') {
    return ctx.riftInstances.some(
      (inst) => inst.vault && inst.partyKey !== null && inst.bossId === mob.id,
    );
  }
  // Nor do his drakes: their Tail Sweep threw players across a room already full
  // of strikes and surges (playtest). Ordinary Rifts keep it.
  if (mob.templateId === 'rift_stormscale') {
    return ctx.riftInstances.some(
      (inst) => inst.vault && inst.partyKey !== null && inst.mobIds.includes(mob.id),
    );
  }
  return false;
}

/** The player is safe alone, or with every living teammate outside their ring. */
export function hoardStaticOverlaps(player: Entity, living: readonly Entity[]): boolean {
  return living.some(
    (other) =>
      other.id !== player.id &&
      !other.dead &&
      (other.pos.x - player.pos.x) ** 2 + (other.pos.z - player.pos.z) ** 2 <=
        HOARD_STATIC_RADIUS ** 2,
  );
}

/** Snapshot before any detonation damage: cue iteration order cannot spare a clustered ally. */
export function resolveHoardStormStaticTargets(living: readonly Entity[]): ReadonlySet<number> {
  return new Set(
    living
      .filter((player) => !player.dead && hoardStaticOverlaps(player, living))
      .map((player) => player.id),
  );
}

export function startHoardStormStatic(
  ctx: SimContext,
  inst: RiftInstance,
  state: HoardBossState,
  living: readonly Entity[],
  emitCue: (ctx: SimContext, inst: RiftInstance, cue: HoardBossCue) => void,
): void {
  for (const player of living) {
    const cue: MarkCue = {
      id: state.nextCueId++,
      kind: 'mark',
      variant: 'storm-static',
      phase: 'warning',
      targetId: player.id,
      x: player.pos.x,
      z: player.pos.z,
      radius: HOARD_STATIC_RADIUS,
      remaining: HOARD_STATIC_WARNING_SEC,
      total: HOARD_STATIC_WARNING_SEC,
    };
    state.cues.push(cue);
    emitCue(ctx, inst, cue);
  }
}

/** The caller advances the fuse. One cue per player means clustered groups never multiply damage. */
export function tickHoardStormStaticCue(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  cue: MarkCue,
  living: readonly Entity[],
  dangerousIds: ReadonlySet<number> = resolveHoardStormStaticTargets(living),
): void {
  const player = living.find((candidate) => candidate.id === cue.targetId && !candidate.dead);
  if (!player) {
    cue.remaining = 0;
    return;
  }
  cue.x = player.pos.x;
  cue.z = player.pos.z;
  if (cue.remaining > 0 || !dangerousIds.has(player.id)) return;
  ctx.dealDamage(
    boss,
    player,
    hoardMechanicDamage(inst, HOARD_STATIC_DAMAGE_FRACTION),
    false,
    'nature',
    'Chain Lightning',
    'hit',
    true,
  );
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: player.id,
    school: 'nature',
    fx: 'nova',
    ability: 'chain_lightning',
  });
}
