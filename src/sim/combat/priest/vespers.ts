import type { PlayerMeta, ResolvedAbility } from '../../sim';
import type { SimContext } from '../../sim_context';
import { type Aura, dist2d, type Entity } from '../../types';
import { dismissOwnedGuardians, guardianOf, summonGuardian } from '../guardians';
import { EFFIGY_AURA_ID, GLOOMTITHE_AURA_ID, GLOOMTITHE_MAX_STACKS } from './presentation';
import { hasPriestTalent, PRIEST_TALENT_IDS } from './talents';

export { EFFIGY_AURA_ID, GLOOMTITHE_AURA_ID, GLOOMTITHE_MAX_STACKS } from './presentation';
export const GLOOMTITHE_GRACE = 15;
export const EFFIGY_ECHO_RATE = 0.3;
export const TITHEFIEND_ECHO_RATE = 0.15;
export const TITHEFIEND_MANA_RETURN_RATE = 0.01;
export const TITHEFIEND_KEY = 'tithefiend';
export const TITHEFIEND_STRIKE_ID = 'tithefiend_strike';
export const TITHEFIEND_MAX_RANGE = 35;
export const VESPERS_DOT_DAMAGE_MULT = 1.1;
export const MINDFRACTURE_SPELL_POWER_COEFF = 0.5;
export const TITHEFIEND_BASE_SPELL_POWER_COEFF = 0.15;
export const TITHEFIEND_MAX_STACK_DAMAGE_MULT = 1.25;
export const TITHEFIEND_MAX_STACK_SCALE = 1.1;

export function resolveVespersAbility(
  resolved: ResolvedAbility,
  meta: PlayerMeta,
): ResolvedAbility {
  if (meta.cls !== 'priest' || meta.talents.spec !== 'shadow') return resolved;
  if (resolved.def.id === 'shadow_word_pain') {
    return {
      ...resolved,
      effects: resolved.effects.map((effect) =>
        effect.type === 'dot'
          ? { ...effect, total: Math.round(effect.total * VESPERS_DOT_DAMAGE_MULT) }
          : effect,
      ),
    };
  }
  if (resolved.def.id === 'mind_blast') {
    return {
      ...resolved,
      effects: resolved.effects.map((effect) =>
        effect.type === 'directDamage'
          ? { ...effect, spellPowerCoeff: MINDFRACTURE_SPELL_POWER_COEFF }
          : effect,
      ),
    };
  }
  return resolved;
}

function ownDirge(target: Entity, priestId: number): Aura | undefined {
  return target.auras.find(
    (aura) => aura.id === 'shadow_word_pain' && aura.kind === 'dot' && aura.sourceId === priestId,
  );
}

export function hasTithefiendTarget(ctx: SimContext, priestId: number): boolean {
  const priest = ctx.entities.get(priestId);
  if (!priest || priest.dead) return false;
  for (const entity of ctx.entities.values()) {
    if (
      !entity.dead &&
      ctx.isHostileTo(priest, entity) &&
      dist2d(priest.pos, entity.pos) <= TITHEFIEND_MAX_RANGE &&
      ownDirge(entity, priestId)
    ) {
      return true;
    }
  }
  return false;
}

function ownEffigy(target: Entity, priestId: number): Aura | undefined {
  return target.auras.find((aura) => aura.id === EFFIGY_AURA_ID && aura.sourceId === priestId);
}

export function effigyTarget(ctx: SimContext, priestId: number): Entity | null {
  for (const entity of ctx.entities.values()) {
    if (!entity.dead && ownEffigy(entity, priestId) && ownDirge(entity, priestId)) return entity;
  }
  return null;
}

/** Gloomtithe's grace timer starts only after its eligible Effigy is gone. */
export function preservesGloomtithe(ctx: SimContext, priestId: number): boolean {
  return effigyTarget(ctx, priestId) !== null;
}

export function stripEffigy(ctx: SimContext, priestId: number): void {
  for (const entity of ctx.entities.values()) {
    for (let index = entity.auras.length - 1; index >= 0; index--) {
      const aura = entity.auras[index];
      if (aura.id !== EFFIGY_AURA_ID || aura.sourceId !== priestId) continue;
      entity.auras.splice(index, 1);
      ctx.emit({ type: 'aura', targetId: entity.id, name: aura.name, gained: false });
    }
  }
}

export function bindEffigy(ctx: SimContext, priest: Entity, target: Entity): boolean {
  const dirge = ownDirge(target, priest.id);
  if (!dirge || target.dead) return false;
  const twin = hasPriestTalent(ctx, priest, PRIEST_TALENT_IDS.twinCovenant);
  if (!twin) {
    stripEffigy(ctx, priest.id);
  } else {
    const links = [...ctx.entities.values()].filter((entity) => ownEffigy(entity, priest.id));
    if (!links.some((entity) => entity.id === target.id) && links.length >= 2) {
      const remove = links[0];
      const index = remove.auras.findIndex(
        (aura) => aura.id === EFFIGY_AURA_ID && aura.sourceId === priest.id,
      );
      if (index >= 0) {
        const aura = remove.auras[index];
        remove.auras.splice(index, 1);
        ctx.emit({ type: 'aura', targetId: remove.id, name: aura.name, gained: false });
      }
    }
  }
  const duration = Math.max(0.05, dirge.remaining);
  ctx.applyAura(target, {
    id: EFFIGY_AURA_ID,
    name: 'Effigy',
    kind: 'hex',
    remaining: duration,
    duration,
    value: EFFIGY_ECHO_RATE,
    sourceId: priest.id,
    school: 'shadow',
  });
  const guardian = guardianOf(ctx, priest.id, TITHEFIEND_KEY);
  if (guardian?.guardianState) guardian.guardianState.preferredTargetId = target.id;
  ctx.emit({
    type: 'spellfx',
    sourceId: priest.id,
    targetId: target.id,
    school: 'shadow',
    fx: 'temporalGlyph',
  });
  return true;
}

export function addGloomtithe(ctx: SimContext, priest: Entity, amount = 1): void {
  if (amount <= 0 || priest.dead) return;
  const existing = priest.auras.find((aura) => aura.kind === 'gloomtithe');
  if (existing) {
    existing.stacks = Math.min(GLOOMTITHE_MAX_STACKS, (existing.stacks ?? 1) + amount);
    existing.remaining = GLOOMTITHE_GRACE;
    ctx.emit({ type: 'aura', targetId: priest.id, name: existing.name, gained: true });
    return;
  }
  ctx.applyAura(priest, {
    id: GLOOMTITHE_AURA_ID,
    name: 'Gloomtithe',
    kind: 'gloomtithe',
    remaining: GLOOMTITHE_GRACE,
    duration: GLOOMTITHE_GRACE,
    value: 0,
    stacks: Math.min(GLOOMTITHE_MAX_STACKS, amount),
    sourceId: priest.id,
    school: 'shadow',
  });
}

export function gloomtitheStacksForCast(priest: Entity, abilityId: string): number {
  if (abilityId !== 'summon_tithefiend') return 0;
  return priest.auras.find((aura) => aura.kind === 'gloomtithe')?.stacks ?? 0;
}

function tithefiendDuration(stacks: number): number {
  return [0, 6, 8, 10, 12, 15][Math.max(0, Math.min(5, stacks))] ?? 0;
}

function summonTithefiend(ctx: SimContext, priest: Entity, stacks: number): void {
  if (stacks <= 0) return;
  const incarnate = stacks === 5 && hasPriestTalent(ctx, priest, PRIEST_TALENT_IDS.incarnateSpirit);
  const incarnateMult = incarnate ? 1.5 : 1;
  const maxStackMult = stacks === GLOOMTITHE_MAX_STACKS ? TITHEFIEND_MAX_STACK_DAMAGE_MULT : 1;
  const damageMult = incarnateMult * maxStackMult;
  summonGuardian(ctx, priest, {
    key: TITHEFIEND_KEY,
    name: 'Tithefiend',
    color: 0x6c258a,
    scale: stacks === GLOOMTITHE_MAX_STACKS ? TITHEFIEND_MAX_STACK_SCALE : 0.82,
    remaining: tithefiendDuration(stacks) * incarnateMult,
    attackInterval: 2,
    minDamage: Math.round((12 + stacks * 8) * damageMult),
    maxDamage: Math.round((16 + stacks * 8) * damageMult),
    spellPowerCoeff: TITHEFIEND_BASE_SPELL_POWER_COEFF * damageMult,
    school: 'shadow',
    abilityId: TITHEFIEND_STRIKE_ID,
    abilityName: 'Tithefiend Strike',
    preferredTargetId: effigyTarget(ctx, priest.id)?.id ?? null,
    maxRange: TITHEFIEND_MAX_RANGE,
    requiredTargetAuraId: 'shadow_word_pain',
    dismissWhenUntargeted: true,
  });
}

function consumeGloomtithe(ctx: SimContext, priest: Entity): void {
  const index = priest.auras.findIndex((aura) => aura.kind === 'gloomtithe');
  if (index < 0) return;
  const [aura] = priest.auras.splice(index, 1);
  ctx.emit({ type: 'aura', targetId: priest.id, name: aura.name, gained: false });
}

export function vespersAfterAbility(
  ctx: SimContext,
  priest: Entity,
  meta: PlayerMeta,
  _target: Entity | null,
  abilityId: string,
  gloomtitheStacks: number,
): void {
  if (meta.cls !== 'priest' || meta.talents.spec !== 'shadow') return;
  if (abilityId === 'summon_tithefiend') {
    summonTithefiend(ctx, priest, gloomtitheStacks);
    if (gloomtitheStacks > 0) consumeGloomtithe(ctx, priest);
  }
}

/** Dirge ticks build only while ticking the caster's current Effigy. */
export function vespersOnDotTick(ctx: SimContext, target: Entity, aura: Aura): void {
  if (aura.id !== 'shadow_word_pain' || !ownEffigy(target, aura.sourceId)) return;
  if (aura.gloomtitheTick === ctx.tickCount) return;
  const priest = ctx.entities.get(aura.sourceId);
  const meta = ctx.players.get(aura.sourceId);
  if (!priest || priest.dead || !meta || meta.cls !== 'priest' || meta.talents.spec !== 'shadow')
    return;
  aura.gloomtitheTick = ctx.tickCount;
  addGloomtithe(ctx, priest);
}

function echoOwner(ctx: SimContext, source: Entity | null): Entity | null {
  if (!source) return null;
  if (source.kind === 'player') return source;
  if (source.guardianState?.key !== TITHEFIEND_KEY || source.ownerId === null) return null;
  return ctx.entities.get(source.ownerId) ?? null;
}

/** Post-landed damage hook. Echoes never carry an eligible ability id, so no recursion. */
export function vespersEchoDamage(
  ctx: SimContext,
  source: Entity | null,
  target: Entity,
  dealt: number,
  abilityId: string | null,
): void {
  if (dealt <= 0 || (abilityId !== 'mind_blast' && abilityId !== TITHEFIEND_STRIKE_ID)) return;
  const priest = echoOwner(ctx, source);
  if (!priest || priest.dead) return;
  const meta = ctx.players.get(priest.id);
  if (meta?.cls !== 'priest' || meta.talents.spec !== 'shadow') return;

  // Mindfracture establishes or moves Effigy only after it actually lands.
  // Keeping this on the post-damage seam prevents misses, invalid casts, and
  // cancellations from creating relationship state or Gloomtithe.
  if (abilityId === 'mind_blast') {
    if (!bindEffigy(ctx, priest, target)) return;
    addGloomtithe(ctx, priest);
  }

  const eligibleTarget =
    abilityId === 'mind_blast' ? ownEffigy(target, priest.id) : ownDirge(target, priest.id);
  if (!eligibleTarget) return;

  if (abilityId === TITHEFIEND_STRIKE_ID && priest.resourceType === 'mana') {
    priest.resource = Math.min(
      priest.maxResource,
      priest.resource + Math.max(1, Math.round(priest.maxResource * TITHEFIEND_MANA_RETURN_RATE)),
    );
  }
  const candidates: { entity: Entity; distance: number }[] = [];
  for (const entity of ctx.entities.values()) {
    if (entity.id === target.id || entity.dead || !ownDirge(entity, priest.id)) continue;
    const dx = entity.pos.x - target.pos.x;
    const dz = entity.pos.z - target.pos.z;
    candidates.push({ entity, distance: dx * dx + dz * dz });
  }
  candidates.sort((a, b) => a.distance - b.distance || a.entity.id - b.entity.id);
  const echoRate = abilityId === TITHEFIEND_STRIKE_ID ? TITHEFIEND_ECHO_RATE : EFFIGY_ECHO_RATE;
  const echoDamage = Math.max(1, Math.round(dealt * echoRate));
  for (const { entity } of candidates.slice(0, 3)) {
    const dirge = ownDirge(entity, priest.id);
    if (
      dirge &&
      hasPriestTalent(ctx, priest, PRIEST_TALENT_IDS.livingCovenant) &&
      dirge.extendedBy !== undefined
    ) {
      const extension = Math.min(1, 6 - dirge.extendedBy);
      if (extension > 0) {
        dirge.extendedBy += extension;
        dirge.remaining += extension;
        dirge.duration += extension;
      }
    } else if (dirge && hasPriestTalent(ctx, priest, PRIEST_TALENT_IDS.livingCovenant)) {
      dirge.extendedBy = 1;
      dirge.remaining += 1;
      dirge.duration += 1;
    }
    ctx.dealDamage(
      priest,
      entity,
      echoDamage,
      false,
      'shadow',
      'Effigy Echo',
      'hit',
      true,
      undefined,
      false,
      false,
      true,
      'priest_effigy_echo',
      true,
    );
    if (hasPriestTalent(ctx, priest, PRIEST_TALENT_IDS.secondVerse)) {
      ctx.applyAura(entity, {
        id: `priest_second_verse_effigy_${ctx.tickCount}_${entity.id}`,
        name: 'Effigy Echo',
        kind: 'dot',
        remaining: 2,
        duration: 2,
        value: Math.max(1, Math.round(echoDamage * 0.4)),
        tickInterval: 2,
        tickTimer: 2,
        sourceId: priest.id,
        school: 'shadow',
      });
    }
  }
}

export function vespersOnEntityDeath(ctx: SimContext, dead: Entity): void {
  const effigies = dead.auras.filter((aura) => aura.id === EFFIGY_AURA_ID);
  for (const effigy of effigies) {
    const priest = ctx.entities.get(effigy.sourceId);
    if (!priest || priest.dead) continue;
    const candidates: { entity: Entity; distance: number }[] = [];
    for (const entity of ctx.entities.values()) {
      if (entity.id === dead.id || entity.dead || !ownDirge(entity, priest.id)) continue;
      const dx = entity.pos.x - dead.pos.x;
      const dz = entity.pos.z - dead.pos.z;
      candidates.push({ entity, distance: dx * dx + dz * dz });
    }
    candidates.sort((a, b) => a.distance - b.distance || a.entity.id - b.entity.id);
    const next = candidates[0]?.entity;
    if (next) bindEffigy(ctx, priest, next);
  }
}

export function cleanupVespers(ctx: SimContext, priestId: number): void {
  stripEffigy(ctx, priestId);
  const priest = ctx.entities.get(priestId);
  if (priest) {
    for (let index = priest.auras.length - 1; index >= 0; index--) {
      const aura = priest.auras[index];
      if (aura.kind !== 'gloomtithe') continue;
      priest.auras.splice(index, 1);
      ctx.emit({ type: 'aura', targetId: priest.id, name: aura.name, gained: false });
    }
  }
  dismissOwnedGuardians(ctx, priestId);
}
