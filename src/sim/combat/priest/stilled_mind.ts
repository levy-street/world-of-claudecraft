import type { ResolvedAbility } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';

export const STILLED_MIND_CRIT_AURA_ID = 'priest_stilled_mind_crit';
const TALENT_ID = 'pri_r11_inner_focus';

function ownsShadowStilledMind(ctx: SimContext, priest: Entity): boolean {
  const meta = ctx.players.get(priest.id);
  return Boolean(
    !priest.dead &&
      meta?.cls === 'priest' &&
      meta.talents.spec === 'shadow' &&
      ctx.playerMods(meta).selected[TALENT_ID],
  );
}

/** Independent from the next spell's free mana and interrupt protection. */
export function grantShadowStilledMind(ctx: SimContext, priest: Entity, abilityId: string): void {
  if (abilityId !== 'inner_focus' || !ownsShadowStilledMind(ctx, priest)) return;
  ctx.applyAura(priest, {
    id: STILLED_MIND_CRIT_AURA_ID,
    name: 'Stilled Mind',
    kind: 'buff_dmg_done',
    value: 0,
    duration: 60,
    remaining: 60,
    sourceId: priest.id,
    school: 'shadow',
  });
}

/** Commit only after admission/cast completion. Copy the hit effect so a projectile
 * retains its critical outcome even after consumption, expiry, or a later cast.
 * The ordinary hit/resist and critical damage multiplier paths remain unchanged. */
export function reserveShadowStilledMind(
  ctx: SimContext,
  priest: Entity,
  resolved: ResolvedAbility,
): ResolvedAbility {
  if (
    (resolved.def.id !== 'mind_blast' && resolved.def.id !== 'void_rupture') ||
    !ownsShadowStilledMind(ctx, priest)
  )
    return resolved;
  const index = priest.auras.findIndex(
    (aura) =>
      aura.id === STILLED_MIND_CRIT_AURA_ID && aura.sourceId === priest.id && aura.remaining > 0,
  );
  if (index < 0) return resolved;
  const [aura] = priest.auras.splice(index, 1);
  ctx.emit({
    type: 'aura',
    targetId: priest.id,
    name: aura.name,
    gained: false,
    auraKind: aura.kind,
  });
  return {
    ...resolved,
    effects: resolved.effects.map((effect) =>
      effect.type === 'directDamage' ? { ...effect, guaranteedCrit: true } : effect,
    ),
  };
}
