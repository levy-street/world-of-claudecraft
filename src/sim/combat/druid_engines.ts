// Druid v0.29 spec engines. Engine banks are authoritative, visible auras:
// Moongrove fills one Moontide bank toward a CHOSEN payoff (Moonsurge on the
// Moonseed button or Sunwake on the Skyfall button, either spend clears it),
// Wildfang shares Old Blood across Wolf and Bruin forms, and Groveheart
// grows Verdance toward Overbloom.

import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { hotTickBonus } from '../spell_scaling';
import type { Aura, AuraKind, Entity } from '../types';

export const MOONTIDE_ID = 'moontide';
export const OLD_BLOOD_ID = 'old_blood';
export const VERDANCE_ID = 'verdance';

export const MOONTIDE_STAGES = 3;
export const OLD_BLOOD_STAGES = 3;
export const VERDANCE_STAGES = 5;
const ENGINE_BACKING_DURATION = 3600;

export const HIGHMOON_TITHE_PCT = 0.15;
export const WILD_APEX_MULT = 1.25;
export const QUICKENING_ENERGY = 5;
export const QUICKENING_RAGE = 3;
export const QUICKENING_MANA_PCT = 0.02;
export const LOPING_STRIDE_SPEED = 0.6;
export const LOPING_STRIDE_DURATION = 3;
const LOPING_STRIDE_ICD_KEY = 'dru_loping_stride';
const LOPING_STRIDE_ICD = 20;

export const DRUID_TALENT_IDS = {
  wildshift: 'dru_r5_improved_wrath',
  lopingStride: 'dru_r5_ferocity',
  skylark: 'dru_r5_natures_bounty',
  highmoonTithe: 'dru_r14_moonfury',
  blooddrunk: 'dru_r14_savage_fury',
  seedspread: 'dru_r14_empowered_touch',
  naturesFury: 'dru_r20_improved_hurricane',
  wildApex: 'dru_r20_berserk',
  quickening: 'dru_r20_tranquility',
} as const;

export const DRUID_PAYOFF_IDS = new Set([
  'moonlash',
  'sunlance',
  'redharvest',
  'marrowbreak',
  'overbloom',
]);

const ENGINE_AURA_IDS = new Set([MOONTIDE_ID, OLD_BLOOD_ID, VERDANCE_ID]);
const FORM_ABILITY_IDS = new Set(['bear_form', 'cat_form', 'travel_form', 'moonkin_form']);
const MOONTIDE_BUILDER_IDS = new Set(['wrath', 'starfire', 'moonseed']);
const OLD_BLOOD_STRIKE_IDS = new Set(['claw', 'rake', 'rip', 'ferocious_bite', 'maul', 'swipe']);
const VERDANCE_SOWING_IDS = new Set(['rejuvenation', 'regrowth']);

function specOf(ctx: SimContext, player: Entity): string | null {
  if (player.kind !== 'player') return null;
  const meta = ctx.players.get(player.id);
  return meta ? ctx.playerMods(meta).spec : null;
}

function selectedRow(ctx: SimContext, player: Entity, optionId: string): boolean {
  if (player.kind !== 'player') return false;
  const meta = ctx.players.get(player.id);
  return meta ? ctx.playerMods(meta).selected[optionId] === true : false;
}

function ownedAura(player: Entity, id: string): Aura | undefined {
  return player.auras.find((aura) => aura.id === id && aura.sourceId === player.id);
}

function removeOwnedAura(ctx: SimContext, player: Entity, id: string): void {
  for (let index = player.auras.length - 1; index >= 0; index--) {
    const aura = player.auras[index];
    if (aura.id !== id || aura.sourceId !== player.id) continue;
    player.auras.splice(index, 1);
    ctx.emit({ type: 'aura', targetId: player.id, name: aura.name, gained: false });
  }
}

function rewardQuickening(ctx: SimContext, player: Entity): void {
  if (!selectedRow(ctx, player, DRUID_TALENT_IDS.quickening)) return;
  if (player.resourceType === 'energy') {
    player.resource = Math.min(player.maxResource, player.resource + QUICKENING_ENERGY);
  } else if (player.resourceType === 'rage') {
    player.resource = Math.min(player.maxResource, player.resource + QUICKENING_RAGE);
  } else {
    player.resource = Math.min(
      player.maxResource,
      player.resource + Math.round(player.maxResource * QUICKENING_MANA_PCT),
    );
  }
}

function setBank(
  ctx: SimContext,
  player: Entity,
  id: string,
  name: string,
  kind: AuraKind,
  stacks: number,
): void {
  const existing = ownedAura(player, id);
  if (existing) {
    existing.stacks = stacks;
    existing.remaining = ENGINE_BACKING_DURATION;
    existing.duration = ENGINE_BACKING_DURATION;
    return;
  }
  ctx.applyAura(player, {
    id,
    name,
    kind,
    remaining: ENGINE_BACKING_DURATION,
    duration: ENGINE_BACKING_DURATION,
    value: 0,
    sourceId: player.id,
    school: 'nature',
    stacks,
  });
}

function addStage(
  ctx: SimContext,
  player: Entity,
  id: string,
  name: string,
  kind: AuraKind,
  cap: number,
): void {
  const existing = ownedAura(player, id);
  const before = existing?.stacks ?? 0;
  if (before >= cap) return;
  setBank(ctx, player, id, name, kind, before + 1);
  rewardQuickening(ctx, player);
}

function seedNextEngineBank(
  ctx: SimContext,
  player: Entity,
  id: string,
  name: string,
  kind: AuraKind,
): void {
  setBank(
    ctx,
    player,
    id,
    name,
    kind,
    selectedRow(ctx, player, DRUID_TALENT_IDS.naturesFury) ? 1 : 0,
  );
}

function refundMana(player: Entity, fraction: number): void {
  if (player.resourceType !== 'mana') return;
  player.resource = Math.min(
    player.maxResource,
    player.resource + Math.round(player.maxResource * fraction),
  );
}

function inMoonwing(player: Entity): boolean {
  return player.auras.some((aura) => aura.kind === 'form_moonkin');
}

export function druidEngineOnCast(
  ctx: SimContext,
  player: Entity,
  abilityId: string,
  _target?: Entity | null,
): void {
  if (player.kind !== 'player') return;
  const meta = ctx.players.get(player.id);
  if (meta?.cls !== 'druid') return;

  if (FORM_ABILITY_IDS.has(abilityId)) {
    if (selectedRow(ctx, player, DRUID_TALENT_IDS.wildshift)) {
      for (let index = player.auras.length - 1; index >= 0; index--) {
        const aura = player.auras[index];
        if ((aura.kind !== 'root' && aura.kind !== 'slow') || aura.unbreakableControl) continue;
        player.auras.splice(index, 1);
        ctx.emit({ type: 'aura', targetId: player.id, name: aura.name, gained: false });
      }
    }
    if (selectedRow(ctx, player, DRUID_TALENT_IDS.lopingStride)) {
      if (!player.procState) player.procState = { counters: {}, icds: {} };
      if (player.procState.icds[LOPING_STRIDE_ICD_KEY] === undefined) {
        player.procState.icds[LOPING_STRIDE_ICD_KEY] = LOPING_STRIDE_ICD;
        ctx.applyAura(player, {
          id: 'loping_stride',
          name: 'Loping Stride',
          kind: 'buff_speed',
          remaining: LOPING_STRIDE_DURATION,
          duration: LOPING_STRIDE_DURATION,
          value: LOPING_STRIDE_SPEED,
          sourceId: player.id,
          school: 'nature',
        });
      }
    }
  }

  const spec = specOf(ctx, player);
  if (spec === 'balance') {
    if (!inMoonwing(player)) return;
    // One bank, one loop: every completed Wildbolt, Skyfall, or Moonseed
    // fills the Moontide. At full tide BOTH payoff buttons arm (Moonseed
    // becomes Moonsurge, Skyfall becomes Sunwake) and either press spends.
    if (MOONTIDE_BUILDER_IDS.has(abilityId)) {
      addStage(ctx, player, MOONTIDE_ID, 'Moontide', 'moontide', MOONTIDE_STAGES);
      return;
    }
    if (abilityId === 'moonlash' || abilityId === 'sunlance') {
      // Either chosen payoff spends the whole bank; both buttons revert.
      removeOwnedAura(ctx, player, MOONTIDE_ID);
      seedNextEngineBank(ctx, player, MOONTIDE_ID, 'Moontide', 'moontide');
      if (selectedRow(ctx, player, DRUID_TALENT_IDS.highmoonTithe)) {
        refundMana(player, HIGHMOON_TITHE_PCT);
      }
    }
    return;
  }

  if (spec === 'feral' && (abilityId === 'redharvest' || abilityId === 'marrowbreak')) {
    removeOwnedAura(ctx, player, OLD_BLOOD_ID);
    if (selectedRow(ctx, player, DRUID_TALENT_IDS.naturesFury)) {
      setBank(ctx, player, OLD_BLOOD_ID, 'Old Blood', 'old_blood', 1);
    }
    return;
  }
}

export function druidEngineOnHotPlanted(ctx: SimContext, player: Entity, abilityId: string): void {
  if (!VERDANCE_SOWING_IDS.has(abilityId)) return;
  const meta = player.kind === 'player' ? ctx.players.get(player.id) : undefined;
  if (meta?.cls !== 'druid' || specOf(ctx, player) !== 'restoration') return;
  addStage(ctx, player, VERDANCE_ID, 'Verdance', 'verdance', VERDANCE_STAGES);
}

export function druidMarrowbreakUsesGuard(player: Entity, belowFrac: number): boolean {
  return player.hp < player.maxHp * belowFrac;
}

export function druidEngineOnLandedStrike(
  ctx: SimContext,
  player: Entity,
  abilityId?: string,
): void {
  if (!abilityId || !OLD_BLOOD_STRIKE_IDS.has(abilityId)) return;
  const meta = player.kind === 'player' ? ctx.players.get(player.id) : undefined;
  if (meta?.cls !== 'druid' || specOf(ctx, player) !== 'feral') return;
  addStage(ctx, player, OLD_BLOOD_ID, 'Old Blood', 'old_blood', OLD_BLOOD_STAGES);
}

export function druidEngineOnBleedTick(ctx: SimContext, source: Entity | null, aura: Aura): void {
  if (
    !source ||
    source.dead ||
    aura.school !== 'physical' ||
    (aura.id !== 'rake' && aura.id !== 'rip') ||
    specOf(ctx, source) !== 'feral' ||
    !selectedRow(ctx, source, DRUID_TALENT_IDS.blooddrunk)
  ) {
    return;
  }
  addStage(ctx, source, OLD_BLOOD_ID, 'Old Blood', 'old_blood', OLD_BLOOD_STAGES);
}

export function druidEngineCombatState(ctx: SimContext, player: Entity): void {
  if (!player.inCombat && ownedAura(player, OLD_BLOOD_ID)) {
    removeOwnedAura(ctx, player, OLD_BLOOD_ID);
  }
}

export function druidApexPayoffMult(ctx: SimContext, player: Entity, abilityId: string): number {
  if (!DRUID_PAYOFF_IDS.has(abilityId)) return 1;
  return selectedRow(ctx, player, DRUID_TALENT_IDS.wildApex) ? WILD_APEX_MULT : 1;
}

export function druidSeedspreadSelected(ctx: SimContext, player: Entity): boolean {
  return selectedRow(ctx, player, DRUID_TALENT_IDS.seedspread);
}

function remainingTicks(aura: Aura): number {
  const interval = aura.tickInterval ?? 1;
  const untilNextTick = aura.tickTimer ?? interval;
  return untilNextTick <= aura.remaining
    ? 1 + Math.max(0, Math.floor((aura.remaining - untilNextTick) / interval))
    : 0;
}

function replantWildbloom(ctx: SimContext, player: Entity, target: Entity): void {
  const resolved = ctx.resolvedAbility('rejuvenation', player.id);
  const hot = resolved?.effects.find((effect) => effect.type === 'hot');
  if (!resolved || !hot || hot.type !== 'hot') return;
  const tickValue =
    Math.max(1, Math.round(hot.total / (hot.duration / hot.interval))) +
    hotTickBonus(player.spellPower, hot.duration, hot.interval);
  ctx.applyAura(target, {
    id: 'rejuvenation',
    name: resolved.def.name,
    kind: 'hot',
    remaining: hot.duration,
    duration: hot.duration,
    value: tickValue,
    tickInterval: hot.interval,
    tickTimer: hot.interval,
    sourceId: player.id,
    school: resolved.def.school,
  });
}

export function resolveDruidOverbloom(
  ctx: SimContext,
  player: Entity,
  castTarget: Entity,
  harvestPct: number,
): void {
  const harvested = new Map<number, Entity>();
  for (const ally of ctx.entities.values()) {
    if (ally.dead || (ally.id !== player.id && !ctx.isFriendlyTo(player, ally))) {
      continue;
    }
    let remainingHealing = 0;
    for (let index = ally.auras.length - 1; index >= 0; index--) {
      const aura = ally.auras[index];
      if (aura.kind !== 'hot' || aura.sourceId !== player.id) continue;
      remainingHealing += aura.value * remainingTicks(aura);
      ally.auras.splice(index, 1);
      ctx.emit({ type: 'aura', targetId: ally.id, name: aura.name, gained: false });
    }
    if (remainingHealing <= 0) continue;
    harvested.set(ally.id, ally);
    ctx.applyHeal(
      player,
      ally,
      Math.round(remainingHealing * harvestPct * druidApexPayoffMult(ctx, player, 'overbloom')),
      'Overbloom',
      'overbloom',
      false,
      false,
    );
  }
  replantWildbloom(ctx, player, castTarget);
  if (druidSeedspreadSelected(ctx, player)) {
    for (const ally of harvested.values()) {
      if (ally.id !== castTarget.id) replantWildbloom(ctx, player, ally);
    }
  }
  if (selectedRow(ctx, player, DRUID_TALENT_IDS.naturesFury)) {
    setBank(ctx, player, VERDANCE_ID, 'Verdance', 'verdance', 1);
  }
}

export function cleanDruidEngineState(
  ctx: SimContext,
  player: Entity,
  _previousSpec: string | null,
  _nextSpec: string | null,
): void {
  for (let index = player.auras.length - 1; index >= 0; index--) {
    const aura = player.auras[index];
    if (aura.sourceId !== player.id || !ENGINE_AURA_IDS.has(aura.id)) continue;
    player.auras.splice(index, 1);
    ctx.emit({ type: 'aura', targetId: player.id, name: aura.name, gained: false });
  }
  if (player.procState) delete player.procState.icds[LOPING_STRIDE_ICD_KEY];
}

export type DruidEngineMeta = PlayerMeta;
