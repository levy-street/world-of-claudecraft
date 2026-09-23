import { ABILITIES } from '../../sim/data';
import { abilityHexColor } from '../ability_vfx_core';
import { abilityVfxFullSpec } from '../ability_vfx_registry';
import { attackAbilityId } from '../characters/weapon_attack_style_core';
import type { AbilityVfxFx } from './fx';
import type { AbilityVfxDamageEvent, AbilityVfxSpellfxEvent } from './painter';
import { shamanWeaponProc } from './shaman_proc_events';
import { shamanCurrentHeal, shamanCurrentSpell } from './shaman_restorative_events';
import { drawShamanThunderVent } from './shaman_vent';

interface Host {
  fx: AbilityVfxFx;
  variant(id: string, source: number): string;
  tier(source: number, id: string): number;
  gesture(source: number, id: string, windup?: boolean): void;
  isShaman?(source: number): boolean;
}

/** Cast cues own the performance. Only resolved outcomes own receiving impacts. */
export function shamanCast(host: Host, ev: AbilityVfxSpellfxEvent): boolean {
  if (shamanCurrentSpell(host.fx, ev)) return true;
  if (!ev.ability) return false;
  const appearance = host.variant(ev.ability, ev.sourceId);
  const spec = abilityVfxFullSpec(appearance);
  if (!spec?.shaman) return false;
  // The resolved heal already owns Lifespring's receiving water. Its tagged
  // companion must not replay the cast or add the old generic echo burst.
  if (ev.ability === 'unleash_weapon' && ev.fx === 'echoBurst') return true;
  if (ev.ability === 'earth_shock' && ev.fx === 'procSurge') {
    if (ev.level === 5) {
      const at = host.fx.anchorOf(ev.targetId, 0.55);
      if (at)
        drawShamanThunderVent(host.fx, at.x, at.y, at.z, 3.3, host.tier(ev.sourceId, ev.ability));
    }
    return true;
  }
  if (ev.ability === 'chain_lightning' && ev.fx === 'projectile' && ev.level !== undefined) {
    // A resolved chain segment starts at the previous victim. It never gives
    // that enemy the caster's release animation or predicts another hit.
    if (Number.isInteger(ev.level) && ev.level >= 0)
      host.fx.shamanChainLink(ev.sourceId, ev.targetId, ev.level === 0);
    return true;
  }
  if (ev.fx === 'windup') {
    host.gesture(ev.sourceId, ev.ability, true);
    return true;
  }
  if (ev.fx === 'chainHeal') {
    // source is the previous recipient, not always the caster.
    host.fx.healStream(ev.sourceId, ev.targetId, ev.level === 0);
    return true;
  }
  const tier = host.tier(ev.sourceId, ev.ability);
  const action = spec.shaman.action;
  if (ev.fx === 'tick') return true;
  if (ev.ability === 'stoneward' && ev.fx === 'selfCast') {
    // The caster performs the invocation, but the ward braces the protected
    // recipient. A missing ally must not redirect their ceremony to the caster.
    host.gesture(ev.sourceId, ev.ability);
    host.fx.sequenceShamanRelease(appearance, spec, ev.sourceId, ev.targetId, tier);
    host.fx.sequenceShamanContact(appearance, spec, ev.sourceId, ev.targetId, tier);
    return true;
  }
  if (action === 'bolt' || action === 'jolt' || action === 'strike' || action === 'heal') {
    host.gesture(ev.sourceId, ev.ability);
    host.fx.sequenceShamanRelease(appearance, spec, ev.sourceId, ev.targetId, tier);
    return true;
  }
  host.gesture(ev.sourceId, ev.ability);
  // Point fields are owned by their point event, not a second actor-centred burst.
  if (action === 'field') return true;
  host.fx.sequenceInstant(
    appearance,
    spec,
    ev.sourceId,
    ev.targetId,
    abilityHexColor(spec.tint!),
    tier,
  );
  return true;
}

export function shamanDamage(host: Host, ev: AbilityVfxDamageEvent): boolean {
  if (shamanWeaponProc(host.fx, ev, host.isShaman)) return true;
  const id = ev.abilityId ?? attackAbilityId(ev.ability);
  if (!id || ABILITIES[id]?.class !== 'shaman') return false;
  const appearance = host.variant(id, ev.sourceId);
  const spec = abilityVfxFullSpec(appearance);
  if (!spec?.shaman) return false;
  // A blocked melee swing can still deal damage or strike an absorption ward.
  // Misses and resists never become contacts, regardless of other payload fields.
  const connected = ev.kind === 'hit' || ev.kind === 'block';
  const outcome = !connected ? 0 : ev.amount > 0 ? 1 : (ev.absorbed ?? 0) > 0 ? 2 : 0;
  if (!outcome) return true;
  if (id === 'flame_shock' && !ev.abilityId) {
    const at = host.fx.anchorOf(ev.targetId, 0.55);
    if (at) host.fx.burstAt(at.x, at.y, at.z, 0xf39643, 7, 0.45, 'shaman_embers', 0.38);
    return true;
  }
  // The field owns its full ground footprint; each confirmed victim gets a
  // subordinate local fracture, never another eight-yard eruption.
  const contact =
    id === 'lightning_shield'
      ? { ...spec, shaman: { ...spec.shaman, action: 'jolt' as const, radius: 1.6, weight: 0.9 } }
      : spec.shaman.action === 'field'
        ? {
            ...spec,
            shaman: { ...spec.shaman, action: 'jolt' as const, radius: 1.25, weight: 0.75 },
          }
        : ev.crit
          ? {
              ...spec,
              shaman: {
                ...spec.shaman,
                radius: spec.shaman.radius * 1.12,
                weight: spec.shaman.weight * 1.22,
              },
            }
          : spec;
  host.fx.sequenceShamanContact(
    appearance,
    contact,
    ev.sourceId,
    ev.targetId,
    host.tier(ev.sourceId, id),
    outcome,
  );
  return true;
}

export interface ShamanHealEvent {
  sourceId: number;
  targetId: number;
  ability: string;
  abilityId?: string;
  amount: number;
  absorbed?: number;
  hot?: boolean;
  cueOnly?: boolean;
}

export function shamanHeal(host: Host, ev: ShamanHealEvent): boolean {
  if (shamanCurrentHeal(host.fx, ev, host.isShaman)) return true;
  const id = ev.abilityId ?? attackAbilityId(ev.ability);
  if (!id || ABILITIES[id]?.class !== 'shaman') return false;
  const appearance = host.variant(id, ev.sourceId);
  const spec = abilityVfxFullSpec(appearance);
  if (!spec?.shaman || spec.shaman.action !== 'heal') return false;
  // Periodic healing is a quiet recipient pulse, not a repeated cast ceremony.
  if (ev.hot) {
    const at = host.fx.anchorOf(ev.targetId, 0.6);
    if (at && ev.amount > 0)
      host.fx.burstAt(at.x, at.y, at.z, 0xbdece0, 5, 0.25, 'shaman_droplets', 0.3);
    return true;
  }
  const tier = host.tier(ev.sourceId, id);
  // A full overheal is still a real completed spell. Absorption has its own catch.
  const outcome = ev.amount <= 0 && (ev.absorbed ?? 0) > 0 ? 2 : 1;
  host.fx.sequenceShamanContact(appearance, spec, ev.sourceId, ev.targetId, tier, outcome);
  return true;
}
