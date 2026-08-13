import type { SimContext } from '../../sim_context';
import type { Aura, Entity } from '../../types';
import { isUnbreakableControlAura } from '../cc';

export const PRIEST_TALENT_IDS = {
  shelteringStep: 'pri_r5_improved_renew',
  veilUnbound: 'pri_r5_searing_light',
  processionalGrace: 'pri_r5_twisted_faith',
  lingeringDread: 'pri_r8_psychic_scream',
  bindingPsalm: 'pri_r11_vampiric_embrace',
  livingCovenant: 'pri_r14_pain_and_suffering',
  twinCovenant: 'pri_r20_twin_covenant',
  secondVerse: 'pri_r20_second_verse',
  incarnateSpirit: 'pri_r20_incarnate_spirit',
} as const;

export function hasPriestTalent(ctx: SimContext, priest: Entity, talentId: string): boolean {
  const meta = ctx.players.get(priest.id);
  return (
    meta?.cls === 'priest' &&
    Object.values(meta.talents.rows).some((selected) => selected === talentId)
  );
}

export function priestAfterAbility(
  ctx: SimContext,
  priest: Entity,
  abilityId: string,
  target: Entity | null,
): void {
  if (
    abilityId === 'power_word_shield' &&
    target &&
    hasPriestTalent(ctx, priest, PRIEST_TALENT_IDS.shelteringStep)
  ) {
    ctx.applyAura(target, {
      id: 'priest_sheltering_step',
      name: 'Sheltering Step',
      kind: 'buff_speed',
      remaining: 3,
      duration: 3,
      value: 1.4,
      sourceId: priest.id,
      school: 'holy',
    });
  }
  if (abilityId !== 'veilstep') return;
  if (hasPriestTalent(ctx, priest, PRIEST_TALENT_IDS.veilUnbound)) {
    for (let index = priest.auras.length - 1; index >= 0; index--) {
      const aura = priest.auras[index];
      if ((aura.kind !== 'slow' && aura.kind !== 'root') || isUnbreakableControlAura(aura))
        continue;
      priest.auras.splice(index, 1);
      ctx.emit({ type: 'aura', targetId: priest.id, name: aura.name, gained: false });
    }
    ctx.applyAura(priest, {
      id: 'priest_veil_unbound',
      name: 'Veil Unbound',
      kind: 'buff_speed',
      remaining: 3,
      duration: 3,
      value: 1.5,
      sourceId: priest.id,
      school: 'holy',
    });
  }
  if (hasPriestTalent(ctx, priest, PRIEST_TALENT_IDS.processionalGrace)) {
    ctx.applyAura(priest, {
      id: 'priest_processional_grace',
      name: 'Processional Grace',
      kind: 'processional_grace',
      remaining: 4,
      duration: 4,
      value: 1,
      sourceId: priest.id,
      school: 'holy',
    });
  }
}

export function priestOnAuraEnded(ctx: SimContext, target: Entity, aura: Aura): void {
  if (aura.id !== 'fear_incap' || aura.name !== 'Terror Canticle') return;
  const priest = ctx.entities.get(aura.sourceId);
  if (!priest || priest.dead || !hasPriestTalent(ctx, priest, PRIEST_TALENT_IDS.lingeringDread))
    return;
  ctx.applyAura(target, {
    id: 'priest_lingering_dread',
    name: 'Lingering Dread',
    kind: 'slow',
    remaining: 4,
    duration: 4,
    value: 0.5,
    sourceId: priest.id,
    school: 'shadow',
  });
}

export function priestOnShieldConsumed(
  ctx: SimContext,
  priest: Entity,
  shield: Aura,
  owner: Entity,
  attacker: Entity | null,
): void {
  if (shield.id !== 'power_word_shield') return;
  if (
    attacker &&
    !attacker.dead &&
    ctx.isHostileTo(priest, attacker) &&
    hasPriestTalent(ctx, priest, PRIEST_TALENT_IDS.bindingPsalm)
  ) {
    if (!attacker.procState) attacker.procState = { counters: {}, icds: {} };
    const key = `binding_psalm_${priest.id}`;
    if (attacker.procState.icds[key] === undefined) {
      attacker.procState.icds[key] = 12;
      ctx.applyRootAura(priest, attacker, 'Binding Psalm', key, 2, 'holy');
    }
  }
  if (hasPriestTalent(ctx, priest, PRIEST_TALENT_IDS.incarnateSpirit)) {
    const originalAbsorb = shield.value2 ?? 0;
    if (originalAbsorb > 0) {
      ctx.applyHeal(
        priest,
        owner,
        Math.round(originalAbsorb * 0.4),
        'Incarnate Spirit',
        'priest_incarnate_spirit',
        false,
        false,
      );
    }
  }
}

export function priestOnCastCompleted(ctx: SimContext, priest: Entity): void {
  if (priest.castConsumedEmpower !== true) return;
  const index = priest.auras.findIndex(
    (aura) => aura.id === 'inner_focus' && aura.kind === 'cast_shield',
  );
  if (index < 0) return;
  const aura = priest.auras[index];
  priest.auras.splice(index, 1);
  ctx.emit({ type: 'aura', targetId: priest.id, name: aura.name, gained: false });
}

function scheduleSecondVerseHeal(
  ctx: SimContext,
  priest: Entity,
  target: Entity,
  amount: number,
  abilityName: string,
  abilityId: string,
): void {
  if (amount <= 0) return;
  ctx.applyAura(target, {
    id: `priest_second_verse_${abilityId}_${ctx.tickCount}`,
    name: abilityName,
    kind: 'hot',
    remaining: 2,
    duration: 2,
    value: Math.max(1, Math.round(amount * 0.4)),
    tickInterval: 2,
    tickTimer: 2,
    sourceId: priest.id,
    school: 'holy',
  });
}

export function priestOnGroupHeal(
  ctx: SimContext,
  priest: Entity,
  target: Entity,
  abilityId: string,
  abilityName: string,
  attempted: number,
  missingBefore: number,
  effective: number,
): void {
  if (abilityId !== 'prayer_of_healing' && abilityId !== 'holy_nova') return;
  if (
    abilityId === 'prayer_of_healing' &&
    hasPriestTalent(ctx, priest, PRIEST_TALENT_IDS.livingCovenant)
  ) {
    const overheal = Math.max(0, attempted - missingBefore);
    const cap = Math.max(1, Math.round(target.maxHp * 0.1));
    if (overheal > 0) {
      const existing = target.auras.find(
        (aura) => aura.id === 'priest_living_covenant' && aura.sourceId === priest.id,
      );
      if (existing) {
        existing.value = Math.min(cap, existing.value + overheal);
        existing.remaining = 10;
      } else {
        ctx.applyAura(target, {
          id: 'priest_living_covenant',
          name: 'Living Covenant',
          kind: 'absorb',
          remaining: 10,
          duration: 10,
          value: Math.min(cap, overheal),
          value2: cap,
          sourceId: priest.id,
          school: 'holy',
        });
      }
    }
  }
  if (hasPriestTalent(ctx, priest, PRIEST_TALENT_IDS.secondVerse)) {
    scheduleSecondVerseHeal(ctx, priest, target, effective, abilityName, abilityId);
  }
}

export function priestOnVigilTriggered(
  ctx: SimContext,
  priest: Entity,
  primary: Entity,
  healed: number,
): void {
  if (healed <= 0 || !hasPriestTalent(ctx, priest, PRIEST_TALENT_IDS.incarnateSpirit)) return;
  const party = ctx.partyOf(priest.id);
  const memberIds = party?.members ?? [priest.id];
  const candidates: { entity: Entity; distance: number }[] = [];
  for (const id of memberIds) {
    if (id === primary.id) continue;
    const entity = ctx.entities.get(id);
    if (!entity || entity.dead) continue;
    const dx = entity.pos.x - primary.pos.x;
    const dz = entity.pos.z - primary.pos.z;
    const distance = dx * dx + dz * dz;
    if (distance <= 225) candidates.push({ entity, distance });
  }
  candidates.sort((a, b) => a.distance - b.distance || a.entity.id - b.entity.id);
  const amount = Math.max(1, Math.round(healed * 0.4));
  for (const { entity } of candidates.slice(0, 3)) {
    ctx.applyHeal(
      priest,
      entity,
      amount,
      'Incarnate Spirit',
      'priest_incarnate_spirit',
      false,
      false,
    );
  }
}
