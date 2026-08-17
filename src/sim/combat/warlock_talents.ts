import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { type AbilityDef, type Aura, DT, type Entity } from '../types';

export const WARLOCK_GENERATOR_IDS = ['needle_of_fate', 'soul_harvest', 'shadow_bolt'] as const;

const WARLOCK_GENERATORS = new Set<string>(WARLOCK_GENERATOR_IDS);
const WARLOCK_DAMAGING_SPELLS = new Set([
  'immolate',
  'searing_pain',
  'rain_of_fire',
  'chaos_bolt',
  'conflagrate',
  'summon_infernal',
  'shadow_bolt',
  'needle_of_fate',
  'sentence',
  'soul_harvest',
  'corpse_explosion',
  'corruption',
  'curse_of_agony',
  'drain_life',
  'shadowburn',
  'siphon_life',
  'litany_of_guilt',
  'reaping_command',
  'abyssal_rift',
]);

const LEADEN_SLOW_ID = 'wlk_leaden_hex_slow';
const LEADEN_ROOT_ID = 'wlk_leaden_hex_root';
const LEADEN_ROOT_LOCK_ID = 'wlk_leaden_hex_root_lock';
const LEADEN_SLOW_PER_STACK = 0.05;
const LEADEN_MAX_STACKS = 3;
const LEADEN_DURATION = 5;
const LEADEN_ROOT_DURATION = 1.5;
const LEADEN_ROOT_LOCK = 15;

const SHADOW_CREDIT_ID = 'wlk_shadow_credit';
const SHADOW_CREDIT_GENERATORS = [...WARLOCK_GENERATOR_IDS];

const ASHEN_SECONDS_KEY = 'wlk_ashen_focus_seconds';
const ASHEN_X_KEY = 'wlk_ashen_focus_x';
const ASHEN_Z_KEY = 'wlk_ashen_focus_z';

const REFLECTION_READY_ID = 'wlk_forbidden_reflection';
const REFLECTION_LOCK_ID = 'wlk_forbidden_reflection_lock';
const REFLECTION_WINDOW = 10;
const REFLECTION_LOCK = 60;
const BLACKTIDE_SPEED_ID = 'wlk_blacktide_speed';
const BLACKTIDE_SPEED_DURATION = 4;
const LEVEL_20_ABILITY_IDS = new Set(['abyssal_rift']);
const FORBIDDEN_REFLECTION_EXCLUDED_IDS = new Set(['soulwell', 'army_of_the_dead']);

function warlockMods(ctx: SimContext, player: Entity) {
  const meta = ctx.players.get(player.id);
  if (meta?.cls !== 'warlock') return null;
  return ctx.playerMods(meta);
}

export function applyBlacktideReturnSpeed(ctx: SimContext, player: Entity): void {
  const speedPct = warlockMods(ctx, player)?.global.warlockBlacktideSpeedPct ?? 0;
  if (speedPct <= 0) return;
  ctx.applyAura(player, {
    id: BLACKTIDE_SPEED_ID,
    name: 'Blacktide',
    kind: 'buff_speed',
    remaining: BLACKTIDE_SPEED_DURATION,
    duration: BLACKTIDE_SPEED_DURATION,
    value: 1 + speedPct,
    sourceId: player.id,
    school: 'shadow',
  });
}

export function reconcileWarlockTalentState(
  ctx: SimContext,
  player: Entity,
  meta: PlayerMeta,
): void {
  if (meta.cls !== 'warlock') return;
  const knownIds = new Set(meta.known.map((ability) => ability.def.id));
  const staleAuraIds = new Set<string>();
  if (!knownIds.has('sacrilegious_march')) staleAuraIds.add('sacrilegious_march');
  if (meta.talentMods.global.warlockBlacktideSpeedPct <= 0) {
    staleAuraIds.add(BLACKTIDE_SPEED_ID);
  }
  if (meta.talentMods.global.warlockShadowCredit <= 0) {
    staleAuraIds.add(SHADOW_CREDIT_ID);
  }
  if (meta.talentMods.global.warlockForbiddenReflection <= 0) {
    staleAuraIds.add(REFLECTION_READY_ID);
    staleAuraIds.add(REFLECTION_LOCK_ID);
  }

  for (let index = player.auras.length - 1; index >= 0; index--) {
    const aura = player.auras[index];
    if (!staleAuraIds.has(aura.id)) continue;
    removeAura(ctx, player, aura);
  }
  if (meta.talentMods.global.warlockAshenFocus <= 0 && player.procState) {
    delete player.procState.counters[ASHEN_SECONDS_KEY];
    delete player.procState.counters[ASHEN_X_KEY];
    delete player.procState.counters[ASHEN_Z_KEY];
  }
}

function removeAura(ctx: SimContext, owner: Entity, aura: Aura): void {
  const index = owner.auras.indexOf(aura);
  if (index < 0) return;
  owner.auras.splice(index, 1);
  ctx.emit({
    type: 'aura',
    targetId: owner.id,
    name: aura.name,
    gained: false,
    auraKind: aura.kind,
  });
}

export function applyLeadenHex(
  ctx: SimContext,
  player: Entity,
  abilityId: string,
  target: Entity | null | undefined,
): void {
  if (!target || target.dead || !WARLOCK_DAMAGING_SPELLS.has(abilityId)) return;
  const mods = warlockMods(ctx, player);
  if (!mods || mods.global.warlockLeadenHex <= 0 || !ctx.isHostileTo(player, target)) return;

  const slow = target.auras.find(
    (aura) => aura.id === LEADEN_SLOW_ID && aura.sourceId === player.id,
  );
  const rootLocked = target.auras.some(
    (aura) => aura.id === LEADEN_ROOT_LOCK_ID && aura.sourceId === player.id,
  );
  if ((slow?.stacks ?? 0) >= LEADEN_MAX_STACKS && !rootLocked) {
    if (slow) removeAura(ctx, target, slow);
    ctx.applyRootAura(player, target, 'Leaden Hex', LEADEN_ROOT_ID, LEADEN_ROOT_DURATION, 'shadow');
    ctx.applyAura(target, {
      id: LEADEN_ROOT_LOCK_ID,
      name: 'Leaden Hex',
      kind: 'internal_cd',
      value: 0,
      remaining: LEADEN_ROOT_LOCK,
      duration: LEADEN_ROOT_LOCK,
      sourceId: player.id,
      school: 'shadow',
    });
    ctx.enterCombat(player, target);
    return;
  }

  const stacks = Math.min(LEADEN_MAX_STACKS, (slow?.stacks ?? 0) + 1);
  if (slow) {
    slow.stacks = stacks;
    slow.value = 1 - stacks * LEADEN_SLOW_PER_STACK;
    slow.remaining = LEADEN_DURATION;
    slow.duration = LEADEN_DURATION;
  } else {
    ctx.applyAura(target, {
      id: LEADEN_SLOW_ID,
      name: 'Leaden Hex',
      kind: 'slow',
      value: 1 - LEADEN_SLOW_PER_STACK,
      stacks: 1,
      remaining: LEADEN_DURATION,
      duration: LEADEN_DURATION,
      sourceId: player.id,
      school: 'shadow',
    });
  }
  ctx.enterCombat(player, target);
}

export function grantShadowCredit(
  ctx: SimContext,
  player: Entity,
  spent: number,
  maximum: number,
): void {
  if (spent <= 0 || maximum <= 0) return;
  const mods = warlockMods(ctx, player);
  if (!mods || mods.global.warlockShadowCredit <= 0) return;
  const fraction = spent / maximum;
  const granted = fraction >= 0.8 ? 2 : fraction >= 0.4 ? 1 : 0;
  if (granted === 0) return;

  const existing = player.auras.find(
    (aura) => aura.id === SHADOW_CREDIT_ID && aura.sourceId === player.id,
  );
  if (existing) {
    existing.charges = Math.min(2, (existing.charges ?? 1) + granted);
    existing.remaining = 30;
    existing.duration = 30;
    return;
  }
  ctx.applyAura(player, {
    id: SHADOW_CREDIT_ID,
    name: 'Shadow Credit',
    kind: 'next_cast_free',
    value: 0,
    charges: granted,
    remaining: 30,
    duration: 30,
    sourceId: player.id,
    school: 'shadow',
    empowerAbilities: SHADOW_CREDIT_GENERATORS,
  });
}

export function tickWarlockTalentState(ctx: SimContext, player: Entity, meta: PlayerMeta): void {
  if (meta.cls !== 'warlock') return;
  const enabled = ctx.playerMods(meta).global.warlockAshenFocus > 0;
  const procState = player.procState;
  if (!enabled) {
    if (!procState) return;
    delete procState.counters[ASHEN_SECONDS_KEY];
    delete procState.counters[ASHEN_X_KEY];
    delete procState.counters[ASHEN_Z_KEY];
    return;
  }
  if (!player.procState) player.procState = { counters: {}, icds: {} };
  const state = player.procState;
  const previousX = state.counters[ASHEN_X_KEY];
  const previousZ = state.counters[ASHEN_Z_KEY];
  const moved =
    previousX !== undefined &&
    previousZ !== undefined &&
    Math.hypot(player.pos.x - previousX, player.pos.z - previousZ) > 0.001;
  state.counters[ASHEN_SECONDS_KEY] = moved
    ? 0
    : Math.min(1, (state.counters[ASHEN_SECONDS_KEY] ?? 0) + DT);
  state.counters[ASHEN_X_KEY] = player.pos.x;
  state.counters[ASHEN_Z_KEY] = player.pos.z;
}

export function ashenFocusCastTimeMult(
  ctx: SimContext,
  player: Entity,
  meta: PlayerMeta,
  abilityId: string,
): number {
  if (
    meta.cls !== 'warlock' ||
    ctx.playerMods(meta).global.warlockAshenFocus <= 0 ||
    !WARLOCK_GENERATORS.has(abilityId)
  ) {
    return 1;
  }
  return (player.procState?.counters[ASHEN_SECONDS_KEY] ?? 0) >= 1 ? 0.8 : 1;
}

function isEligibleWarlockCooldownAbility(ability: AbilityDef): boolean {
  return ability.class === 'warlock' && !ability.passive && !LEVEL_20_ABILITY_IDS.has(ability.id);
}

export function tickUnbrokenRitual(ctx: SimContext, player: Entity, meta: PlayerMeta): void {
  if (meta.cls !== 'warlock' || ctx.playerMods(meta).global.warlockUnbrokenRitual <= 0) return;
  const refund = DT * 0.5;
  for (const [abilityId, remaining] of player.cooldowns) {
    const resolved = ctx.resolvedAbility(abilityId, player.id);
    if (!resolved || !isEligibleWarlockCooldownAbility(resolved.def)) continue;
    const next = remaining - refund;
    if (next <= 0) player.cooldowns.delete(abilityId);
    else player.cooldowns.set(abilityId, next);
  }
}

export function canUseForbiddenReflection(player: Entity, abilityId: string): boolean {
  return player.auras.some(
    (aura) =>
      aura.id === REFLECTION_READY_ID &&
      aura.sourceId === player.id &&
      aura.empowerAbilities?.includes(abilityId),
  );
}

export function consumeForbiddenReflection(
  ctx: SimContext,
  player: Entity,
  abilityId: string,
): boolean {
  const ready = player.auras.find(
    (aura) =>
      aura.id === REFLECTION_READY_ID &&
      aura.sourceId === player.id &&
      aura.empowerAbilities?.includes(abilityId),
  );
  if (!ready) return false;
  removeAura(ctx, player, ready);
  return true;
}

export function armForbiddenReflection(
  ctx: SimContext,
  player: Entity,
  meta: PlayerMeta,
  ability: AbilityDef,
  cooldown: number,
): void {
  if (
    cooldown <= 0 ||
    meta.cls !== 'warlock' ||
    ctx.playerMods(meta).global.warlockForbiddenReflection <= 0 ||
    !isEligibleWarlockCooldownAbility(ability) ||
    FORBIDDEN_REFLECTION_EXCLUDED_IDS.has(ability.id) ||
    player.auras.some((aura) => aura.id === REFLECTION_LOCK_ID)
  ) {
    return;
  }
  ctx.applyAura(player, {
    id: REFLECTION_READY_ID,
    name: 'Forbidden Reflection',
    kind: 'internal_cd',
    value: 0,
    remaining: REFLECTION_WINDOW,
    duration: REFLECTION_WINDOW,
    sourceId: player.id,
    school: 'shadow',
    empowerAbilities: [ability.id],
  });
  ctx.applyAura(player, {
    id: REFLECTION_LOCK_ID,
    name: 'Forbidden Reflection',
    kind: 'internal_cd',
    value: 0,
    remaining: REFLECTION_LOCK,
    duration: REFLECTION_LOCK,
    sourceId: player.id,
    school: 'shadow',
  });
}

export function tickSacrilegiousMarch(ctx: SimContext, player: Entity, aura: Aura): void {
  const healthPct = player.maxHp > 0 ? player.hp / player.maxHp : 0;
  const floor = aura.value3 ?? 0.2;
  if (healthPct <= floor) {
    aura.remaining = 0;
    return;
  }
  const floorHp = Math.ceil(player.maxHp * floor);
  const requested = Math.max(1, Math.round(player.maxHp * (aura.value2 ?? 0.02)));
  const amount = Math.min(requested, Math.max(0, player.hp - floorHp));
  if (amount <= 0) {
    aura.remaining = 0;
    return;
  }
  player.hp = Math.max(floorHp, player.hp - amount);
  ctx.emit({
    type: 'damage',
    sourceId: player.id,
    targetId: player.id,
    amount,
    crit: false,
    school: 'shadow',
    ability: aura.name,
    kind: 'hit',
  });
  if (player.hp / player.maxHp <= floor) aura.remaining = 0;
}
