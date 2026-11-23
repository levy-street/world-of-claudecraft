import { dawnreaverDamageMultiplier } from '../../dawnreaver_damage';
import type { PlayerMeta, ResolvedAbility } from '../../sim';
import type { SimContext } from '../../sim_context';
import { abilityScalingPower, directHitBonus } from '../../spell_scaling';
import { resolveTalentHitMult } from '../../talent_hit_mult';
import type { Entity } from '../../types';
import { stoneboundThreatMultiplier } from '../shaman_warspirit';
import { spellDamageMultFromAuras } from '../spell_combat';
import { spawnSpiritBombResidual } from './spirit_bomb_residual';

/** Snapshot the lingering region at cast commitment, before the initial hit can resist. */
export function completeSpiritBomb(
  ctx: SimContext,
  priest: Entity,
  meta: PlayerMeta,
  target: Entity | null,
  resolved: ResolvedAbility,
): void {
  if (resolved.def.id !== 'spirit_bomb') return;
  const blast = resolved.effects.find((effect) => effect.type === 'aoeDamage');
  if (!blast) return;
  const mods = ctx.playerMods(meta);
  const { dmgMult } = resolveTalentHitMult(resolved.def, mods);
  const power = directHitBonus(
    abilityScalingPower(priest, resolved.def),
    resolved.def,
    resolved.castTime,
    true,
    dmgMult,
  );
  spawnSpiritBombResidual(
    ctx,
    priest,
    (blast.centerOnTarget ? target?.pos : null) ?? priest.castAim ?? priest.pos,
    blast.radius,
    ((blast.min + blast.max) / 2 + power) *
      spellDamageMultFromAuras(priest) *
      dawnreaverDamageMultiplier(meta.cls, mods.spec, resolved.def.id),
    {
      flat: resolved.threatFlat,
      mult: resolved.threatMult * stoneboundThreatMultiplier(ctx, priest),
    },
  );
}
