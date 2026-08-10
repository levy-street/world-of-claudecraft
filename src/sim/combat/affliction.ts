import { MOBS } from '../data';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { AbilityDef, Aura, Entity } from '../types';
import { grantShadowCredit } from './warlock_talents';

export const AFFLICTION_DOOM_MAX = 100;
export const AFFLICTION_DOOM_DURATION = 20;
export const AFFLICTION_DOOM_WARNING = 5;
export const AFFLICTION_EYE_DEATH_GAIN = 10;
export const FATE_THREAD_MAX = 3;
export const FATE_THREAD_DURATION = 12;
export const FATE_THREAD_SENTENCE_DAMAGE_PER_STACK = 0.06;

const EYE_DURATION = 3600;
const ACCOMPLICE_INTERVAL = 2;
const MALEDICT_GAZE_INTERVAL = 2.5;
const POSSESSED_MALEDICT_GAZE_INTERVAL = 1.25;
// The doom-100 payoff against players and bosses. 1.2 shipped with the rework
// and made capped Sentences the bulk of the spec's boss lead; 1.05 keeps the
// overcap identity (a capped Sentence still hits hardest) at tuned size.
const SENTENCE_DOOM_CAPPED_BONUS_MULT = 1.05;
const MALEDICT_GAZE_RANGE = 30;
const ENEMY_ACTION_GAIN = 2;
// Rate cap on the enemy-action doom stream: one gain per eye per second. On the
// single-target bench the enemy never acts, so this moves nothing there; live, a
// boss's flurry of damage events (melee, mechanics, dot ticks) otherwise streams
// doom far above what the tuning study measured.
const ENEMY_ACTION_GAIN_ICD = 1;
const DRAIN_TICK_GAIN = 2;
const DRAIN_COMPLETION_GAIN = 3;
const FATE_THREAD_DOOM_PER_TICK = 1;
const SENTENCE_SPLASH_RADIUS = 8;
const SENTENCE_SPLASH_MULT = 0.35;
const SENTENCE_COVEN_ECHO_MULT = 0.35;
export const SENTENCE_THREAT_MULT = 0.35;
const POSSESSED_NEEDLE_CAST_TIME = 1;
const POSSESSED_NEEDLE_DOOM_BONUS = 2;
const POSSESSED_SENTENCE_ECHO_DELAY = 0.75;
const POSSESSED_SENTENCE_DAMAGE_MULT = 1.25;
export const JUDGMENT_SENTENCE_DAMAGE_MULT = 1.2;
const POSSESSED_SENTENCE_ECHO_ID = 'possess_evil_eye_sentence_echo';
const LITANY_PULSE_INTERVAL = 1;
const POSSESSED_ABILITY_IDS = new Set(['needle_of_fate', 'drain_life', 'sentence']);
const AFFLICTION_SOURCE_DAMAGE_KINDS = new Set([
  'affliction_eye',
  'affliction_eye_secondary',
  'affliction_accomplice',
  'affliction_violence',
]);

function afflictionMeta(ctx: SimContext, entity: Entity): PlayerMeta | null {
  const meta = entity.kind === 'player' ? ctx.players.get(entity.id) : undefined;
  return meta?.cls === 'warlock' && meta.talents.spec === 'affliction' ? meta : null;
}

function doomAura(player: Entity): Aura | undefined {
  return player.auras.find((aura) => aura.kind === 'affliction_doom');
}

export function doomValue(player: Entity): number {
  return doomAura(player)?.stacks ?? 0;
}

export function gainDoom(ctx: SimContext, warlock: Entity, amount: number): number {
  if (!afflictionMeta(ctx, warlock) || warlock.dead || amount <= 0) return doomValue(warlock);
  const rounded = Math.max(1, Math.round(amount));
  const existing = doomAura(warlock);
  if (existing) {
    const before = existing.stacks ?? 0;
    existing.stacks = Math.min(AFFLICTION_DOOM_MAX, before + rounded);
    existing.value = existing.stacks;
    existing.remaining = AFFLICTION_DOOM_DURATION;
    existing.duration = AFFLICTION_DOOM_DURATION;
    if (existing.stacks > before) triggerLitanyOfGuilt(ctx, warlock);
    return existing.stacks;
  }
  const value = Math.min(AFFLICTION_DOOM_MAX, rounded);
  ctx.applyAura(warlock, {
    id: 'affliction_doom',
    name: 'Condemnation',
    kind: 'affliction_doom',
    remaining: AFFLICTION_DOOM_DURATION,
    duration: AFFLICTION_DOOM_DURATION,
    value,
    stacks: value,
    sourceId: warlock.id,
    school: 'shadow',
  });
  triggerLitanyOfGuilt(ctx, warlock);
  return value;
}

export function consumeDoom(ctx: SimContext, warlock: Entity): number {
  const index = warlock.auras.findIndex((aura) => aura.kind === 'affliction_doom');
  if (index < 0) return 0;
  const [spent] = warlock.auras.splice(index, 1);
  ctx.emit({ type: 'aura', targetId: warlock.id, name: spent.name, gained: false });
  const amount = spent.stacks ?? 0;
  grantShadowCredit(ctx, warlock, amount, AFFLICTION_DOOM_MAX);
  return amount;
}

function eyeAura(target: Entity, warlockId: number): Aura | undefined {
  return target.auras.find(
    (aura) =>
      aura.sourceId === warlockId &&
      (aura.kind === 'affliction_eye' || aura.kind === 'affliction_eye_secondary'),
  );
}

function eyeGeneration(eye: Aura, amount: number, warlock: Entity): number {
  const eyeMult = eye.kind === 'affliction_eye_secondary' ? 0.5 : 1;
  const judgmentMult =
    eye.kind === 'affliction_eye' &&
    warlock.auras.some((aura) => aura.kind === 'affliction_judgment')
      ? 2
      : 1;
  return Math.round(amount * eyeMult * judgmentMult);
}

function fateThreadAura(target: Entity, warlockId: number): Aura | undefined {
  return target.auras.find(
    (aura) => aura.kind === 'affliction_fate_threads' && aura.sourceId === warlockId,
  );
}

function primaryEye(ctx: SimContext, warlockId: number): Entity | null {
  for (const entity of ctx.entities.values()) {
    if (
      entity.auras.some((aura) => aura.kind === 'affliction_eye' && aura.sourceId === warlockId)
    ) {
      return entity;
    }
  }
  return null;
}

function removeOwnedAura(ctx: SimContext, target: Entity, aura: Aura): void {
  const index = target.auras.indexOf(aura);
  if (index < 0) return;
  target.auras.splice(index, 1);
  ctx.emit({ type: 'aura', targetId: target.id, name: aura.name, gained: false });
}

const OWNED_AFFLICTION_KINDS = new Set([
  'affliction_doom',
  'affliction_eye',
  'affliction_eye_secondary',
  'affliction_accomplice',
  'affliction_violence',
  'affliction_vicarious',
  'affliction_possession',
  'affliction_judgment',
  'affliction_litany',
  'affliction_fate_threads',
  'affliction_consume_threads',
]);

export function clearAfflictionState(ctx: SimContext, warlockId: number): void {
  for (const entity of ctx.entities.values()) {
    for (let index = entity.auras.length - 1; index >= 0; index--) {
      const aura = entity.auras[index];
      if (
        aura.sourceId !== warlockId ||
        (!OWNED_AFFLICTION_KINDS.has(aura.kind) && aura.id !== POSSESSED_SENTENCE_ECHO_ID)
      ) {
        continue;
      }
      entity.auras.splice(index, 1);
      ctx.emit({ type: 'aura', targetId: entity.id, name: aura.name, gained: false });
    }
  }
}

export function hasAfflictionPossession(entity: Pick<Entity, 'auras'>): boolean {
  return entity.auras.some((aura) => aura.kind === 'affliction_possession' && aura.remaining > 0);
}

export function afflictionPossessionEmpowers(
  auras: readonly Pick<Aura, 'kind'>[],
  abilityId: string,
): boolean {
  return (
    POSSESSED_ABILITY_IDS.has(abilityId) &&
    auras.some((aura) => aura.kind === 'affliction_possession')
  );
}

export function afflictionAdjustedCastTime(
  entity: Pick<Entity, 'auras'>,
  abilityId: string,
  castTime: number,
): number {
  return abilityId === 'needle_of_fate' && hasAfflictionPossession(entity)
    ? Math.min(castTime, POSSESSED_NEEDLE_CAST_TIME)
    : castTime;
}

export function afflictionCanCastWhileMoving(
  entity: Pick<Entity, 'auras'>,
  abilityId: string,
): boolean {
  return abilityId === 'drain_life' && hasAfflictionPossession(entity);
}

export function applyEvilEyePossession(
  ctx: SimContext,
  warlock: Entity,
  duration: number,
  doom = 0,
): void {
  if (doom > 0) gainDoom(ctx, warlock, doom);
  ctx.applyAura(warlock, {
    id: 'possess_evil_eye',
    name: 'Possess the Evil Eye',
    kind: 'affliction_possession',
    remaining: duration,
    duration,
    value: 1,
    sourceId: warlock.id,
    school: 'shadow',
  });
}

function grantFateThreads(ctx: SimContext, target: Entity, warlock: Entity, stacks: number): void {
  const bounded = Math.min(FATE_THREAD_MAX, Math.max(0, Math.floor(stacks)));
  if (bounded === 0) return;
  const existing = fateThreadAura(target, warlock.id);
  if (existing) {
    existing.stacks = bounded;
    existing.value = bounded;
    existing.remaining = FATE_THREAD_DURATION;
    existing.duration = FATE_THREAD_DURATION;
    return;
  }
  ctx.applyAura(target, {
    id: 'needle_of_fate',
    name: 'Fate Threads',
    kind: 'affliction_fate_threads',
    remaining: FATE_THREAD_DURATION,
    duration: FATE_THREAD_DURATION,
    value: bounded,
    stacks: bounded,
    sourceId: warlock.id,
    school: 'shadow',
  });
}

export function applyHourOfJudgment(
  ctx: SimContext,
  warlock: Entity,
  target: Entity,
  duration: number,
  doom: number,
  refund: number,
): void {
  gainDoom(ctx, warlock, doom);
  grantFateThreads(ctx, target, warlock, FATE_THREAD_MAX);
  applyEvilEyePossession(ctx, warlock, duration);
  ctx.applyAura(warlock, {
    id: 'hour_of_judgment',
    name: 'Hour of Judgment',
    kind: 'affliction_judgment',
    remaining: duration,
    duration,
    value: refund,
    charges: 1,
    sourceId: warlock.id,
    school: 'shadow',
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: warlock.id,
    targetId: target.id,
    school: 'shadow',
    fx: 'evilEyeGaze',
    ability: 'hour_of_judgment',
  });
}

export function applyLitanyOfGuilt(
  ctx: SimContext,
  warlock: Entity,
  target: Entity,
  duration: number,
  radius: number,
  maxTargets: number,
  damage: number,
): void {
  if (
    !target.auras.some((aura) => aura.kind === 'affliction_eye' && aura.sourceId === warlock.id)
  ) {
    return;
  }
  ctx.applyAura(warlock, {
    id: 'litany_of_guilt',
    name: 'Litany of Guilt',
    kind: 'affliction_litany',
    remaining: duration,
    duration,
    value: damage,
    value2: radius,
    value3: maxTargets,
    sourceId: warlock.id,
    school: 'shadow',
    icd: 0,
    icdMax: LITANY_PULSE_INTERVAL,
  });
}

function triggerLitanyOfGuilt(ctx: SimContext, warlock: Entity): void {
  const litany = warlock.auras.find(
    (aura) => aura.kind === 'affliction_litany' && aura.sourceId === warlock.id,
  );
  if (!litany || (litany.icd ?? 0) > 0) return;
  const eye = primaryEye(ctx, warlock.id);
  if (!eye || eye.dead) return;
  const radius = Math.max(0, litany.value2 ?? 0);
  const maxTargets = Math.max(0, Math.floor(litany.value3 ?? 0));
  const targets = [...ctx.entities.values()]
    .filter(
      (entity) =>
        entity.id !== eye.id &&
        !entity.dead &&
        ctx.isHostileTo(warlock, entity) &&
        Math.hypot(entity.pos.x - eye.pos.x, entity.pos.z - eye.pos.z) <= radius,
    )
    .sort((a, b) => {
      const ad = (a.pos.x - eye.pos.x) ** 2 + (a.pos.z - eye.pos.z) ** 2;
      const bd = (b.pos.x - eye.pos.x) ** 2 + (b.pos.z - eye.pos.z) ** 2;
      return ad - bd || a.id - b.id;
    })
    .slice(0, maxTargets);
  if (targets.length === 0) return;
  litany.icd = litany.icdMax ?? LITANY_PULSE_INTERVAL;
  ctx.emit({
    type: 'spellfxAt',
    x: eye.pos.x,
    z: eye.pos.z,
    school: 'shadow',
    fx: 'nova',
    radius,
    sourceId: warlock.id,
    ability: 'litany_of_guilt',
  });
  for (const target of targets) {
    ctx.dealDamage(
      warlock,
      target,
      litany.value,
      false,
      'shadow',
      litany.name,
      'hit',
      true,
      undefined,
      false,
      false,
      false,
      'litany_of_guilt',
      true,
    );
  }
}

export function moveEvilEye(ctx: SimContext, warlock: Entity, target: Entity): void {
  for (const entity of ctx.entities.values()) {
    const existing = entity.auras.find(
      (aura) => aura.kind === 'affliction_eye' && aura.sourceId === warlock.id,
    );
    if (!existing) continue;
    removeOwnedAura(ctx, entity, existing);
    const threads = fateThreadAura(entity, warlock.id);
    if (threads) removeOwnedAura(ctx, entity, threads);
  }
  ctx.applyAura(target, {
    id: 'evil_eye',
    name: 'Evil Eye',
    kind: 'affliction_eye',
    remaining: EYE_DURATION,
    duration: EYE_DURATION,
    value: 1,
    tickInterval: MALEDICT_GAZE_INTERVAL,
    tickTimer: MALEDICT_GAZE_INTERVAL,
    sourceId: warlock.id,
    school: 'shadow',
  });
}

export function maledictGazeDamage(level: number): number {
  if (level >= 20) return 10;
  if (level >= 12) return 9;
  return 5;
}

function canMaledictGaze(
  ctx: SimContext,
  target: Entity,
  aura: Aura,
): { warlock: Entity; interval: number } | null {
  const warlock = ctx.entities.get(aura.sourceId);
  if (!warlock || warlock.dead || !afflictionMeta(ctx, warlock)) return null;
  const interval = hasAfflictionPossession(warlock)
    ? POSSESSED_MALEDICT_GAZE_INTERVAL
    : MALEDICT_GAZE_INTERVAL;
  if (
    target.dead ||
    !warlock.inCombat ||
    !target.inCombat ||
    !ctx.isHostileTo(warlock, target) ||
    Math.hypot(target.pos.x - warlock.pos.x, target.pos.z - warlock.pos.z) > MALEDICT_GAZE_RANGE ||
    !ctx.hasLineOfSight(warlock, target)
  ) {
    return null;
  }
  return { warlock, interval };
}

export function tickMaledictGaze(ctx: SimContext, target: Entity, aura: Aura): void {
  if (aura.kind !== 'affliction_eye') return;
  const ready = canMaledictGaze(ctx, target, aura);
  if (!ready) return;
  const { warlock } = ready;
  const hpBefore = target.hp;
  ctx.emit({
    type: 'spellfx',
    sourceId: warlock.id,
    targetId: target.id,
    school: 'shadow',
    fx: 'evilEyeGaze',
    duration: 0.28,
    ability: 'maledict_gaze',
  });
  ctx.dealDamage(
    warlock,
    target,
    maledictGazeDamage(warlock.level),
    false,
    'shadow',
    'Maledict Gaze',
    'hit',
    false,
    undefined,
    false,
    false,
    false,
    'maledict_gaze',
  );
  if (hpBefore <= target.hp) return;
  const accomplice = warlock.auras.find(
    (candidate) =>
      candidate.kind === 'affliction_accomplice' &&
      candidate.sourceId === warlock.id &&
      (candidate.icd ?? 0) <= 0,
  );
  if (!accomplice) return;
  gainDoom(ctx, warlock, eyeGeneration(aura, accomplice.value, warlock));
  accomplice.icd = accomplice.icdMax ?? ACCOMPLICE_INTERVAL;
}

export function resolveNeedleOfFate(ctx: SimContext, warlock: Entity, target: Entity): void {
  if (!afflictionMeta(ctx, warlock)) return;
  const current = primaryEye(ctx, warlock.id);
  if (!current) moveEvilEye(ctx, warlock, target);
  const eye = eyeAura(target, warlock.id);
  if (!eye) return;
  gainDoom(
    ctx,
    warlock,
    eyeGeneration(
      eye,
      7 + (hasAfflictionPossession(warlock) ? POSSESSED_NEEDLE_DOOM_BONUS : 0),
      warlock,
    ),
  );
  if (eye.kind !== 'affliction_eye') return;
  const threads = fateThreadAura(target, warlock.id);
  if (threads) {
    threads.stacks = Math.min(FATE_THREAD_MAX, (threads.stacks ?? 0) + 1);
    threads.value = threads.stacks;
    threads.remaining = FATE_THREAD_DURATION;
    threads.duration = FATE_THREAD_DURATION;
    return;
  }
  ctx.applyAura(target, {
    id: 'needle_of_fate',
    name: 'Needle of Fate',
    kind: 'affliction_fate_threads',
    remaining: FATE_THREAD_DURATION,
    duration: FATE_THREAD_DURATION,
    value: 1,
    stacks: 1,
    sourceId: warlock.id,
    school: 'shadow',
  });
}

export function applyCursedAccomplice(ctx: SimContext, warlock: Entity, target: Entity): void {
  const linked = target.kind === 'player' && target.id !== warlock.id ? target : warlock;
  for (const entity of ctx.entities.values()) {
    const existing = entity.auras.find(
      (aura) => aura.kind === 'affliction_accomplice' && aura.sourceId === warlock.id,
    );
    if (existing) removeOwnedAura(ctx, entity, existing);
  }
  ctx.applyAura(linked, {
    id: 'cursed_accomplice',
    name: 'Cursed Accomplice',
    kind: 'affliction_accomplice',
    remaining: EYE_DURATION,
    duration: EYE_DURATION,
    value: linked.id === warlock.id ? 2 : 3,
    sourceId: warlock.id,
    school: 'shadow',
    icd: 0,
    icdMax: ACCOMPLICE_INTERVAL,
  });
}

export function applyHexOfViolence(
  ctx: SimContext,
  warlock: Entity,
  target: Entity,
  duration: number,
  charges: number,
  doomPerProc: number,
  damage: number,
): void {
  ctx.applyAura(target, {
    id: 'hex_of_violence',
    name: 'Hex of Violence',
    kind: 'affliction_violence',
    remaining: duration,
    duration,
    value: doomPerProc,
    value2: damage,
    charges,
    sourceId: warlock.id,
    school: 'shadow',
  });
}

export function applyCruelPact(
  ctx: SimContext,
  warlock: Entity,
  healthPct: number,
  manaPctMax: number,
  doom: number,
): void {
  const damage = Math.round(warlock.maxHp * healthPct);
  warlock.hp = Math.max(1, warlock.hp - damage);
  ctx.emit({
    type: 'damage',
    sourceId: warlock.id,
    targetId: warlock.id,
    amount: damage,
    crit: false,
    school: 'shadow',
    ability: 'Cruel Pact',
    kind: 'hit',
  });
  if (warlock.resourceType === 'mana') {
    warlock.resource = Math.min(
      warlock.maxResource,
      warlock.resource + Math.round(warlock.maxResource * manaPctMax),
    );
  }
  gainDoom(ctx, warlock, doom);
}

export function applyVicariousSuffering(
  ctx: SimContext,
  warlock: Entity,
  target: Entity,
  duration: number,
  maxDoom: number,
): void {
  ctx.applyAura(target, {
    id: 'vicarious_suffering',
    name: 'Vicarious Suffering',
    kind: 'affliction_vicarious',
    remaining: duration,
    duration,
    value: maxDoom,
    value2: 0,
    sourceId: warlock.id,
    school: 'shadow',
  });
}

/**
 * Vicarious Suffering is resolved after absorbs. Self-casts reduce the landed
 * hit by 20%; allied casts transfer only the amount the warlock can safely pay.
 */
export function mitigateVicariousSuffering(
  ctx: SimContext,
  source: Entity | null,
  target: Entity,
  amount: number,
  abilityId: string | null,
): number {
  if (
    !source ||
    source.id === target.id ||
    amount <= 0 ||
    abilityId === 'vicarious_suffering_redirect'
  ) {
    return amount;
  }
  const aura = target.auras.find((candidate) => candidate.kind === 'affliction_vicarious');
  if (!aura) return amount;
  const warlock = ctx.entities.get(aura.sourceId);
  if (!warlock || warlock.dead || !ctx.isHostileTo(warlock, source)) return amount;

  const share = Math.min(amount, Math.round(amount * 0.2));
  if (share <= 0) return amount;
  if (warlock.id === target.id) return amount - share;

  const floor = Math.ceil(warlock.maxHp * 0.15);
  const redirected = Math.min(share, Math.max(0, warlock.hp - floor));
  if (redirected <= 0) return amount;
  ctx.dealDamage(
    null,
    warlock,
    redirected,
    false,
    'shadow',
    'Vicarious Suffering',
    'hit',
    true,
    undefined,
    false,
    false,
    true,
    'vicarious_suffering_redirect',
  );
  return amount - redirected;
}

export function applyCoven(
  ctx: SimContext,
  warlock: Entity,
  target: Entity,
  duration: number,
  radius: number,
  maxSecondary: number,
): void {
  if (!primaryEye(ctx, warlock.id)) moveEvilEye(ctx, warlock, target);
  const candidates = [...ctx.entities.values()]
    .filter(
      (entity) =>
        entity.id !== target.id &&
        !entity.dead &&
        ctx.isHostileTo(warlock, entity) &&
        Math.hypot(entity.pos.x - target.pos.x, entity.pos.z - target.pos.z) <= radius,
    )
    .sort((a, b) => {
      const ad = (a.pos.x - target.pos.x) ** 2 + (a.pos.z - target.pos.z) ** 2;
      const bd = (b.pos.x - target.pos.x) ** 2 + (b.pos.z - target.pos.z) ** 2;
      return ad - bd || a.id - b.id;
    })
    .slice(0, maxSecondary);
  for (const secondary of candidates) {
    ctx.applyAura(secondary, {
      id: 'coven',
      name: 'Coven',
      kind: 'affliction_eye_secondary',
      remaining: duration,
      duration,
      value: 0.5,
      sourceId: warlock.id,
      school: 'shadow',
    });
  }
}

// 2026-08-09 120s band round: the 80 and 100 anchors step down (750 to 620,
// 1100 to 910) to land the BiS bench inside the 150-200 band. The 20 and 50
// anchors stay at 138/400: the bench spends in the 80-100 segment, and the
// doom-50 base keeps the judgment (1.2x) and possession (1.25x) ratios exact
// integers in the mechanics tests.
export function sentenceBaseDamage(doom: number): number {
  if (doom <= 20) return 138;
  if (doom <= 50) return Math.round(138 + ((doom - 20) / 30) * 262);
  if (doom <= 80) return Math.round(400 + ((doom - 50) / 30) * 220);
  return Math.round(620 + ((doom - 80) / 20) * 290);
}

function endgameCompressionProgress(level: number): number {
  return Math.max(0, Math.min(4, Math.floor(level) - 16)) / 4;
}

export function sentenceEndgameDamageMultiplier(level: number): number {
  return Math.round((1 - endgameCompressionProgress(level) * 0.45) * 1000) / 1000;
}

export function possessedSentenceEchoMultiplier(level: number): number {
  return Math.round((0.6 - endgameCompressionProgress(level) * 0.3) * 1000) / 1000;
}

export function resolveSentence(
  ctx: SimContext,
  warlock: Entity,
  target: Entity,
  abilityName: string,
  damageMult = 1,
  flat = 0,
): void {
  const possessed = hasAfflictionPossession(warlock);
  const threads = fateThreadAura(target, warlock.id);
  const threadCount = Math.min(FATE_THREAD_MAX, Math.max(0, threads?.stacks ?? 0));
  const doom = consumeDoom(ctx, warlock);
  if (doom < 20) return;
  if (threads) removeOwnedAura(ctx, target, threads);
  const judgment = warlock.auras.find(
    (aura) => aura.kind === 'affliction_judgment' && aura.remaining > 0,
  );
  const levelScale = Math.max(0.25, Math.min(1, warlock.level / 20));
  const threadDamageMult = 1 + threadCount * FATE_THREAD_SENTENCE_DAMAGE_PER_STACK;
  const sharedDamage = Math.round(
    (sentenceBaseDamage(doom) *
      levelScale *
      damageMult *
      threadDamageMult *
      (possessed ? POSSESSED_SENTENCE_DAMAGE_MULT : 1) *
      (judgment ? JUDGMENT_SENTENCE_DAMAGE_MULT : 1) +
      flat) *
      sentenceEndgameDamageMultiplier(warlock.level),
  );
  if (judgment && (judgment.charges ?? 0) > 0) {
    judgment.charges = Math.max(0, (judgment.charges ?? 0) - 1);
    gainDoom(ctx, warlock, judgment.value);
  }
  let primaryDamage = sharedDamage;
  const normalMob =
    target.kind === 'mob' && !MOBS[target.templateId]?.boss && !MOBS[target.templateId]?.elite;
  if (doom >= 100 && (target.kind === 'player' || MOBS[target.templateId]?.boss)) {
    primaryDamage = Math.round(primaryDamage * SENTENCE_DOOM_CAPPED_BONUS_MULT);
  }
  if (doom >= 100 && normalMob && target.maxHp > 0 && target.hp / target.maxHp < 0.2) {
    primaryDamage = target.hp;
  }
  const before = target.hp;
  ctx.dealDamage(
    warlock,
    target,
    primaryDamage,
    false,
    'shadow',
    abilityName,
    'hit',
    false,
    { mult: SENTENCE_THREAT_MULT },
    true,
    false,
    false,
    'sentence',
  );
  ctx.emit({
    type: 'spellfx',
    sourceId: warlock.id,
    targetId: target.id,
    school: 'shadow',
    fx: 'sentenceBurst',
    level: doom,
    ...(threadCount > 0 ? { threads: threadCount } : {}),
  });
  const dealt = before - target.hp;
  if (doom >= 50 && dealt > 0 && !warlock.dead) {
    ctx.applyHeal(warlock, warlock, Math.round(dealt * 0.2), abilityName, 'sentence');
  }
  if (possessed && dealt > 0 && !target.dead) {
    ctx.applyAura(target, {
      id: POSSESSED_SENTENCE_ECHO_ID,
      name: 'Demonic Sentence',
      kind: 'dot',
      remaining: POSSESSED_SENTENCE_ECHO_DELAY,
      duration: POSSESSED_SENTENCE_ECHO_DELAY,
      value: Math.max(1, Math.round(dealt * possessedSentenceEchoMultiplier(warlock.level))),
      tickInterval: POSSESSED_SENTENCE_ECHO_DELAY,
      tickTimer: POSSESSED_SENTENCE_ECHO_DELAY,
      sourceId: warlock.id,
      school: 'shadow',
      finalDamage: true,
    });
  }
  if (doom >= 80) {
    for (const entity of ctx.entities.values()) {
      if (entity.id === target.id || entity.dead || !ctx.isHostileTo(warlock, entity)) continue;
      if (
        Math.hypot(entity.pos.x - target.pos.x, entity.pos.z - target.pos.z) >
        SENTENCE_SPLASH_RADIUS
      ) {
        continue;
      }
      ctx.dealDamage(
        warlock,
        entity,
        Math.round(sharedDamage * SENTENCE_SPLASH_MULT),
        false,
        'shadow',
        abilityName,
        'hit',
        true,
        { mult: SENTENCE_THREAT_MULT },
        false,
        false,
        false,
        'sentence',
        true,
      );
    }
  }
  for (const entity of ctx.entities.values()) {
    if (entity.id === target.id || entity.dead || !ctx.isHostileTo(warlock, entity)) continue;
    if (
      !entity.auras.some(
        (aura) =>
          aura.sourceId === warlock.id &&
          (aura.kind === 'affliction_eye' || aura.kind === 'affliction_eye_secondary'),
      )
    ) {
      continue;
    }
    ctx.dealDamage(
      warlock,
      entity,
      Math.round(sharedDamage * SENTENCE_COVEN_ECHO_MULT),
      false,
      'shadow',
      abilityName,
      'hit',
      true,
      { mult: SENTENCE_THREAT_MULT },
      false,
      false,
      false,
      'sentence',
    );
  }
}

export function consumeFateThreadsForDrain(
  ctx: SimContext,
  warlock: Entity,
  target: Entity | null,
  channelDuration: number,
): number {
  clearAfflictionConsumeThreads(ctx, warlock);
  if (
    !target?.auras.some((aura) => aura.kind === 'affliction_eye' && aura.sourceId === warlock.id)
  ) {
    return 0;
  }
  const threads = fateThreadAura(target, warlock.id);
  if (!threads) return 0;
  const count = Math.min(FATE_THREAD_MAX, Math.max(0, threads.stacks ?? 0));
  removeOwnedAura(ctx, target, threads);
  if (count === 0) return 0;
  ctx.applyAura(warlock, {
    id: 'drain_life_fate_threads',
    name: 'Consume',
    kind: 'affliction_consume_threads',
    remaining: channelDuration,
    duration: channelDuration,
    value: count,
    stacks: count,
    sourceId: warlock.id,
    school: 'shadow',
  });
  return count;
}

export function clearAfflictionConsumeThreads(ctx: SimContext, warlock: Entity): void {
  const threads = warlock.auras.find(
    (aura) => aura.kind === 'affliction_consume_threads' && aura.sourceId === warlock.id,
  );
  if (threads) removeOwnedAura(ctx, warlock, threads);
}

export function afflictionConsumeThreadDoomBonus(warlock: Entity): number {
  const threads = warlock.auras.find(
    (aura) => aura.kind === 'affliction_consume_threads' && aura.sourceId === warlock.id,
  );
  return (threads?.stacks ?? 0) * FATE_THREAD_DOOM_PER_TICK;
}

export function afflictionDrainTickDoom(
  ctx: SimContext,
  warlock: Entity,
  target: Entity,
  threadBonus = 0,
): number {
  const eye = eyeAura(target, warlock.id);
  if (!eye || !afflictionMeta(ctx, warlock)) return 0;
  return eyeGeneration(eye, DRAIN_TICK_GAIN + threadBonus, warlock);
}

export function afflictionDrainCompletionDoom(
  ctx: SimContext,
  warlock: Entity,
  target: Entity,
): number {
  const eye = eyeAura(target, warlock.id);
  if (!eye || !afflictionMeta(ctx, warlock)) return 0;
  return eyeGeneration(eye, DRAIN_COMPLETION_GAIN, warlock);
}

export function completeAfflictionDrain(
  ctx: SimContext,
  warlock: Entity,
  target: Entity | null,
  abilityId: string,
): void {
  if (abilityId !== 'drain_life' || !target) return;
  const doom = afflictionDrainCompletionDoom(ctx, warlock, target);
  if (doom > 0) gainDoom(ctx, warlock, doom);
}

export function afflictionCastError(player: Entity, ability: AbilityDef): string | null {
  if (ability.id === 'cruel_pact' && player.hp <= player.maxHp * 0.2) {
    return 'Not enough health.';
  }
  return null;
}

export function afflictionTargetCastError(
  player: Entity,
  target: Entity | null,
  ability: AbilityDef,
): string | null {
  if (
    ability.id === 'sentence' &&
    !target?.auras.some((aura) => aura.sourceId === player.id && aura.kind === 'affliction_eye')
  ) {
    return 'That ability is not ready yet.';
  }
  if (
    ability.id === 'coven' &&
    !target?.auras.some((aura) => aura.kind === 'affliction_eye' && aura.sourceId === player.id)
  ) {
    return 'That ability is not ready yet.';
  }
  if (
    ability.id === 'possess_evil_eye' &&
    !target?.auras.some((aura) => aura.kind === 'affliction_eye' && aura.sourceId === player.id)
  ) {
    return 'That ability is not ready yet.';
  }
  if (
    ability.id === 'hour_of_judgment' &&
    !target?.auras.some((aura) => aura.kind === 'affliction_eye' && aura.sourceId === player.id)
  ) {
    return 'That ability is not ready yet.';
  }
  if (
    ability.id === 'litany_of_guilt' &&
    !target?.auras.some((aura) => aura.kind === 'affliction_eye' && aura.sourceId === player.id)
  ) {
    return 'That ability is not ready yet.';
  }
  return null;
}

export function tickAfflictionAura(ctx: SimContext, target: Entity, aura: Aura, dt: number): void {
  if (aura.kind === 'affliction_accomplice' && aura.icd && aura.icd > 0) {
    aura.icd = Math.max(0, aura.icd - dt);
  }
  if (aura.kind === 'affliction_litany' && aura.icd && aura.icd > 0) {
    aura.icd = Math.max(0, aura.icd - dt);
  }
  if (aura.kind !== 'affliction_eye') return;
  const warlock = ctx.entities.get(aura.sourceId);
  const interval =
    warlock && hasAfflictionPossession(warlock)
      ? POSSESSED_MALEDICT_GAZE_INTERVAL
      : MALEDICT_GAZE_INTERVAL;
  if (aura.tickInterval !== interval) {
    aura.tickInterval = interval;
    aura.tickTimer = Math.min(aura.tickTimer ?? interval, interval);
  }
  if (!canMaledictGaze(ctx, target, aura)) {
    // The companion never auto-pulls. While its owner is idle, out of range,
    // or the marked enemy is not yet engaged, keep a full attack timer banked.
    aura.tickTimer = interval + dt;
  }
}

/**
 * A marked enemy that dies pays out one last time. Below the level cap the only
 * reliable generation is Needle of Fate, so normal mobs die long before the pool
 * reaches a worthwhile Sentence threshold and it then expires on the walk to the
 * next pull. Feeding the kill back into `gainDoom` keeps the ramp alive across a
 * questing pull chain, and refreshes the expiry exactly like every other
 * generation event. Secondary (Coven) Eyes pay the same halved rate as every
 * other generation path, via `eyeGeneration`. This belongs to the shared death
 * lifecycle so ranked-arena and direct scripted deaths cannot bypass it.
 */
export function afflictionOnDeath(ctx: SimContext, target: Entity): void {
  if (target.dead) return;
  for (const eye of target.auras) {
    if (eye.kind !== 'affliction_eye' && eye.kind !== 'affliction_eye_secondary') continue;
    const warlock = ctx.entities.get(eye.sourceId);
    if (!warlock || warlock.id === target.id) continue;
    gainDoom(ctx, warlock, eyeGeneration(eye, AFFLICTION_EYE_DEATH_GAIN, warlock));
  }
}

export function onAfflictionDamage(
  ctx: SimContext,
  source: Entity | null,
  target: Entity,
  actualDamage: number,
): void {
  if (!source || source.id === target.id || actualDamage <= 0) return;
  const sourceCanTrigger = source.auras.some((aura) =>
    AFFLICTION_SOURCE_DAMAGE_KINDS.has(aura.kind),
  );
  const targetCanTrigger = target.auras.some((aura) => aura.kind === 'affliction_vicarious');
  if (!sourceCanTrigger && !targetCanTrigger) return;

  for (const eye of source.auras) {
    if (eye.kind !== 'affliction_eye' && eye.kind !== 'affliction_eye_secondary') continue;
    if ((eye.actionGainLockout ?? 0) > ctx.time) continue;
    const warlock = ctx.entities.get(eye.sourceId);
    if (warlock) {
      eye.actionGainLockout = ctx.time + ENEMY_ACTION_GAIN_ICD;
      gainDoom(ctx, warlock, eyeGeneration(eye, ENEMY_ACTION_GAIN, warlock));
    }
  }

  for (const violence of source.auras) {
    if (violence.kind !== 'affliction_violence' || (violence.charges ?? 0) <= 0) continue;
    const warlock = ctx.entities.get(violence.sourceId);
    if (!warlock || warlock.dead) continue;
    const marked = eyeAura(source, warlock.id);
    gainDoom(
      ctx,
      warlock,
      marked ? eyeGeneration(marked, violence.value, warlock) : violence.value,
    );
    violence.charges = Math.max(0, (violence.charges ?? 0) - 1);
    ctx.dealDamage(
      warlock,
      source,
      violence.value2 ?? 0,
      false,
      'shadow',
      violence.name,
      'hit',
      true,
      undefined,
      false,
      false,
      false,
      'hex_of_violence',
    );
  }
  for (let index = source.auras.length - 1; index >= 0; index--) {
    const aura = source.auras[index];
    if (aura.kind === 'affliction_violence' && (aura.charges ?? 0) <= 0) {
      removeOwnedAura(ctx, source, aura);
    }
  }

  for (const accomplice of source.auras) {
    if (accomplice.kind !== 'affliction_accomplice' || (accomplice.icd ?? 0) > 0) continue;
    if (source.id === accomplice.sourceId) continue;
    const warlock = ctx.entities.get(accomplice.sourceId);
    if (!warlock || !eyeAura(target, warlock.id)) continue;
    const marked = eyeAura(target, warlock.id);
    if (!marked) continue;
    gainDoom(ctx, warlock, eyeGeneration(marked, accomplice.value, warlock));
    accomplice.icd = accomplice.icdMax ?? ACCOMPLICE_INTERVAL;
  }

  for (const vicarious of target.auras) {
    if (vicarious.kind !== 'affliction_vicarious') continue;
    const warlock = ctx.entities.get(vicarious.sourceId);
    if (!warlock || !ctx.isHostileTo(warlock, source)) continue;
    const generated = vicarious.value2 ?? 0;
    const gain = Math.min(3, Math.max(0, vicarious.value - generated));
    if (gain <= 0) continue;
    vicarious.value2 = generated + gain;
    gainDoom(ctx, warlock, gain);
  }
}
