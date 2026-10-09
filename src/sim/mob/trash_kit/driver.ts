// The dungeon trash kit driver (MobTemplate.trashKit): one pass per tick over
// every claimed dungeon's mobs, AFTER the mob AI (called from
// instances/dungeons.ts updateInstances, which the coordinator runs after the
// per-entity loop), so a leap, a dive or a landing can own the mob's position
// for the tick the AI already moved it.
//
// Every cast is a real cast bar (castingAbility / castRemaining / castTotal,
// mirrored online like any cast). The interruptible ones are registered in
// cast_ids.ts TRASH_KIT_CAST_SCHOOLS; an interrupt (cancelCast) clears the bar,
// which this pass reads as "cancelled", and the school lockout it leaves keeps
// the caster from starting that school again until it lapses. A stun or a
// silence breaks a cast the same way. The effect lands only when the bar runs
// out.
//
// Determinism: targets are hashed (targets.ts), never rolled; the only rng
// draws are the damage rolls of a landing cast, in mob-roster order.

import { isLockedOut, isSilenced } from '../../combat/cc';
import { DUNGEONS, MOBS } from '../../data';
import { applyKnockback } from '../../knockback';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { addThreat } from '../../threat';
import {
  type Aura,
  angleTo,
  DT,
  dist2d,
  type Entity,
  type TrashKitCast,
  type TrashKitDef,
  type TrashKitState,
} from '../../types';
import { packPeerRank, packStaggerOffset } from '../pack_cast_stagger';
import { BASTION_KIT_EXTENSION } from './bastion_extension';
import {
  dropUnlaidFog,
  endBastionPull,
  endColumn,
  landFog,
  landHook,
  lockColumn,
  lockFog,
  pickColumnTarget,
  pickFogTarget,
  pickHookTarget,
  stepBastionKit,
  stepColumnChannel,
  stepUnshackle,
} from './bastion_kit';
import { brandReady, landBrand, stepQuench } from './brand';
import { holdAreaCast } from './cast_hold';
import { CRYPT_PERCH_DIVE, CRYPT_SKY_LANDING, CRYPT_TORN_TENDON } from './cast_ids';
import { stepCombatWall, syncCombatWallCollision } from './combat_walls';
import {
  armReleap,
  dropRupture,
  endCryptPull,
  faceRupture,
  judgeReassemble,
  landEye,
  landRupture,
  lockRupture,
  pickEyeTarget,
  pickRuptureCorpse,
  stepBonePile,
  stepCryptKit,
} from './crypt_kit';
import { stepDeathBurst } from './death_burst';
import { callDownLastFlier } from './flier_call';
import { applyFreezeStack } from './freeze_stacks';
import type { TrashKitExtension } from './kit_extension';
import { stepKitHazard } from './kit_hazard';
import { landNova, novaCastIdFor, novaReady } from './kit_nova';
import { kitObjectIds } from './kit_objects';
import { restoreSplit, stepSplit } from './kit_split';
import { launchWalker, pickWalkerAlly, stepWalker } from './kit_walker';
import { landReanimate, pickReanimateCorpse } from './reanimate';
import {
  dropToss,
  landGoad,
  landToss,
  lockToss,
  pickGoadTarget,
  pickTossTarget,
  stepStoke,
} from './sanctum_kit';
import { spawnKitAdd } from './spawn';
import {
  holdLineAim,
  landSupportCast,
  lockLineAim,
  type SupportKey,
  stepWithdraw,
  supportCastReady,
} from './support';
import { inCone, livingInReach, pickHashedTarget, pickLeapTarget } from './targets';
import { TEMPLE_KIT_EXTENSION } from './temple_extension';
import { landLullaby, lullabyReady, stepCarapace, stepDetonate } from './temple_kit';
import { WILDHEART_KIT_EXTENSION } from './wildheart_extension';
import { stepDeathCloud, stepPulse } from './wildheart_kit';

/** Kit casts in priority order: a summon before a heal or shield, a control
 *  before a strike, a bolt last. */
const CAST_KEYS = [
  'raise',
  'reanimate',
  'call',
  'mend',
  'ward',
  'walker',
  'goad',
  'brand',
  'rupture',
  'eye',
  'column',
  'fogBank',
  'screech',
  'nova',
  'lullaby',
  'wingGust',
  'tailLash',
  'cone',
  'hook',
  'line',
  'toss',
  'bolt',
] as const;
type CastKey = (typeof CAST_KEYS)[number];

/** The dungeons' own key blocks (kit_extension.ts), run after the core keys. */
const EXTENSIONS: readonly TrashKitExtension[] = [
  TEMPLE_KIT_EXTENSION,
  WILDHEART_KIT_EXTENSION,
  BASTION_KIT_EXTENSION,
];

/** Each extension cast key's owner, built once (the driver asks per key,
 *  per engaged mob, per tick). */
const EXTENSION_OF_KEY: ReadonlyMap<string, TrashKitExtension> = new Map(
  EXTENSIONS.flatMap((ext) => ext.castKeys.map((key) => [key, ext] as const)),
);

/** The extension that owns cast key `key`, if any. */
function extensionOf(key: string): TrashKitExtension | undefined {
  return EXTENSION_OF_KEY.get(key);
}

/** A bar-launched walker's cast record, derived once per walker def. */
const WALKER_CASTS = new WeakMap<object, TrashKitCast>();

/** Every cast key the driver runs: its own, then each extension's, in order. */
const ALL_CAST_KEYS: readonly string[] = [
  ...CAST_KEYS,
  ...EXTENSIONS.flatMap((ext) => ext.castKeys),
];

/** Physical kit casts: a silence never breaks them and no school lockout
 *  stops them (dodge these, never kick them). */
function isPhysicalKey(key: CastKey): boolean {
  return (
    key === 'tailLash' ||
    key === 'wingGust' ||
    key === 'line' ||
    key === 'toss' ||
    key === 'cone' ||
    key === 'hook'
  );
}

function isSupportKey(key: CastKey): key is SupportKey {
  return key === 'mend' || key === 'ward' || key === 'line';
}

/** A caster's own swings (and a petSpell caster's bolts) hold while a bar runs. */
const SWING_HOLD_SECONDS = 0.6;
/** A mob this far over the floor is airborne (on a perch or on the wing). */
const AIRBORNE = 1;
/** The leap stops this short of its victim. */
const LEAP_STOP = 1.5;
/** How high a leap arcs at its apex. */
const LEAP_ARC = 3;

function castDef(kit: TrashKitDef, key: string): TrashKitCast | undefined {
  const ext = extensionOf(key);
  if (ext) return ext.castDef(kit, key);
  if (key === 'walker') {
    // A walker launched by a bar (its death launch has no bar).
    const w = kit.walker;
    if (!w || w.launch !== 'cast') return undefined;
    let cast = WALKER_CASTS.get(w);
    if (!cast) {
      cast = {
        castId: w.castId,
        name: w.name,
        castTime: w.castTime ?? 1.5,
        every: w.every ?? 15,
        first: w.first ?? 6,
        school: w.school,
      };
      WALKER_CASTS.set(w, cast);
    }
    return cast;
  }
  return kit[key as Exclude<CastKey, 'walker'>];
}

/** A physical cast of any owner (the core's or an extension's). */
function isPhysicalCast(key: string): boolean {
  const ext = extensionOf(key);
  return ext ? ext.isPhysical(key) : isPhysicalKey(key as CastKey);
}

function clearCast(mob: Entity, castId: string): void {
  if (mob.castingAbility !== castId) return;
  mob.castingAbility = null;
  mob.castRemaining = 0;
  mob.castTotal = 0;
  mob.castTargetId = null;
  mob.channeling = false;
}

/** The players standing in a claim (the boss-add spawner's footprint). */
function claimPlayers(ctx: SimContext, inst: InstanceSlot): Entity[] {
  const o = ctx.instanceOriginOf(inst);
  const out: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e) continue;
    if (Math.abs(e.pos.x - o.x) < 120 && Math.abs(e.pos.z - o.z) < 250) out.push(e);
  }
  return out;
}

function groundY(ctx: SimContext, e: Entity): number {
  return ctx.groundPos(e.pos.x, e.pos.z).y;
}

/** Fresh per-pull state: every ability waits its `first` seconds, plus the
 *  pack stagger (mob/pack_cast_stagger.ts) when same-type peers in the claim
 *  were pulled with it, so a pack's casts alternate instead of landing as one. */
export function startTrashKit(
  ctx: SimContext,
  mob: Entity,
  kit: TrashKitDef,
  inst?: InstanceSlot,
): TrashKitState {
  const roster = inst ? inst.mobIds.map((id) => ctx.entities.get(id)) : [];
  const { rank, size } = packPeerRank(roster, mob, (peer) => peer.trashKit !== undefined);
  const timers: Record<string, number> = {};
  for (const key of ALL_CAST_KEYS) {
    const def = castDef(kit, key);
    if (def) timers[key] = def.first + packStaggerOffset(rank, size, def.every);
  }
  if (kit.leap) timers.leap = kit.leap.first + packStaggerOffset(rank, size, kit.leap.every);
  const st: TrashKitState = { timers, cast: null, leap: null, descent: null, engaged: 0, casts: 0 };
  // Pulled off a perch or out of the sky: come down first. The mob AI has
  // already stood it on the floor this tick, so the height it was up at is the
  // one its last idle tick recorded.
  const floor = groundY(ctx, mob);
  const upAt = Math.max(mob.pos.y, mob.airY ?? -Infinity);
  mob.airY = undefined;
  if (upAt > floor + AIRBORNE) {
    const dive = mob.perchY !== undefined;
    mob.pos.y = upAt;
    st.descent = {
      fromY: upAt,
      t: 0,
      seconds: dive ? (kit.perch?.diveSeconds ?? 1) : (kit.land?.seconds ?? 1.5),
      dive,
    };
    ctx.emit({
      type: 'spellfx',
      sourceId: mob.id,
      targetId: mob.aggroTargetId ?? mob.id,
      school: 'physical',
      fx: 'windup',
      ability: dive ? CRYPT_PERCH_DIVE : CRYPT_SKY_LANDING,
    });
  }
  return st;
}

/** The pull ended (evade, reset, death): drop the bar and the state. */
export function endTrashKit(mob: Entity): void {
  const st = mob.trashKit;
  if (st?.cast) clearCast(mob, st.cast.castId);
  mob.trashKit = undefined;
  mob.castHold = undefined;
}

/** An idle perched mob back on its spawn spot sits on its perch again. */
function holdPerch(mob: Entity): void {
  if (mob.perchY === undefined || mob.aiState !== 'idle') return;
  if (dist2d(mob.pos, mob.spawnPos) > 0.5) return;
  mob.pos.y = mob.perchY;
  mob.prevPos.y = mob.perchY;
}

/** Bring a diving or landing mob down onto the floor. */
function stepDescent(ctx: SimContext, mob: Entity, st: TrashKitState): void {
  const d = st.descent;
  if (!d) return;
  d.t += DT;
  const k = Math.min(1, d.t / d.seconds);
  const floor = groundY(ctx, mob);
  // A dive accelerates off the perch with a small hop; a landing glides in.
  const ease = d.dive ? k * k : k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
  const hop = d.dive ? Math.sin(Math.PI * Math.min(1, k * 2)) * 0.8 * (1 - k) : 0;
  mob.pos.y = d.fromY + (floor - d.fromY) * ease + hop;
  if (k >= 1) {
    mob.pos.y = floor;
    st.descent = null;
  }
}

/** A summon template plus every form its kit grows into (a Bone Minion and the
 *  Bone Brute it swells into), read off the content: a grown add is still the
 *  summoner's, so it still counts toward the summon cap. */
function summonFamily(templateId: string): ReadonlySet<string> {
  const ids = new Set<string>();
  for (let id: string | undefined = templateId; id && !ids.has(id); ) {
    ids.add(id);
    id = MOBS[id]?.trashKit?.grow?.into;
  }
  return ids;
}

function livingSummons(ctx: SimContext, owner: Entity, templateId: string): number {
  const family = summonFamily(templateId);
  let n = 0;
  for (const id of owner.summonedIds) {
    const e = ctx.entities.get(id);
    if (e && !e.dead && family.has(e.templateId)) n++;
  }
  return n;
}

function mechanicDamage(ctx: SimContext, mob: Entity, min: number, max: number): number {
  return Math.max(1, Math.round(ctx.rng.range(min, max) * (mob.mechanicDamageMult ?? 1)));
}

/** Can the kit start `key` now? Returns the cast's victim for a bolt. */
function castReady(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  key: CastKey,
  st: TrashKitState,
  players: readonly Entity[],
): { ok: boolean; target: Entity | null } {
  const no = { ok: false, target: null };
  if (isSupportKey(key)) return supportCastReady(ctx, inst, mob, kit, key, st, players);
  switch (key) {
    case 'bolt': {
      const def = kit.bolt;
      if (!def) return no;
      const target = pickHashedTarget(players, mob.pos, def.range, mob.id, st.casts);
      return target ? { ok: true, target } : no;
    }
    case 'raise':
      return kit.raise && livingSummons(ctx, mob, kit.raise.summon) < kit.raise.maxAlive
        ? { ok: true, target: null }
        : no;
    case 'reanimate': {
      // The rite's target is the corpse it raises (the bar's castTargetId).
      const corpse = pickReanimateCorpse(ctx, inst, mob, kit);
      return corpse ? { ok: true, target: corpse } : no;
    }
    case 'brand':
      return brandReady(ctx, mob, kit, st, players);
    case 'nova':
      return novaReady(mob, kit, players) ? { ok: true, target: null } : no;
    case 'walker':
      return pickWalkerAlly(ctx, inst, mob.pos, mob.id, kit.walker?.allies)
        ? { ok: true, target: null }
        : no;
    case 'cone': {
      // At the one it fights, when it stands in the cone's reach.
      const def = kit.cone;
      const victim =
        mob.aggroTargetId !== null ? (ctx.entities.get(mob.aggroTargetId) ?? null) : null;
      if (!def || !victim || victim.dead || victim.kind !== 'player') return no;
      return dist2d(victim.pos, mob.pos) <= def.range ? { ok: true, target: victim } : no;
    }
    case 'call':
      // A whole flock must fit under the cap, so a second call waits.
      return kit.call &&
        livingSummons(ctx, mob, kit.call.summon) + kit.call.count <= kit.call.maxAlive
        ? { ok: true, target: null }
        : no;
    case 'lullaby':
      return lullabyReady(mob, kit, st, players);
    case 'goad': {
      const ally = pickGoadTarget(ctx, inst, mob, kit);
      return ally ? { ok: true, target: ally } : no;
    }
    case 'toss': {
      const victim = pickTossTarget(players, mob, kit);
      return victim ? { ok: true, target: victim } : no;
    }
    case 'rupture': {
      const corpse = kit.rupture ? pickRuptureCorpse(ctx, inst, mob, kit.rupture.range) : null;
      return corpse ? { ok: true, target: corpse } : no;
    }
    case 'eye': {
      const victim = pickEyeTarget(ctx, inst, mob, kit, st, players);
      return victim ? { ok: true, target: victim } : no;
    }
    case 'column': {
      const victim = pickColumnTarget(mob, kit, st, players);
      return victim ? { ok: true, target: victim } : no;
    }
    case 'fogBank': {
      const foe = pickFogTarget(ctx, mob, kit, st);
      return foe ? { ok: true, target: foe } : no;
    }
    case 'hook': {
      const victim = pickHookTarget(players, mob, kit);
      return victim ? { ok: true, target: victim } : no;
    }
    case 'screech':
      return kit.screech && livingInReach(players, mob.pos, kit.screech.radius).length > 0
        ? { ok: true, target: null }
        : no;
    case 'wingGust':
      return kit.wingGust && livingInReach(players, mob.pos, kit.wingGust.radius).length > 0
        ? { ok: true, target: null }
        : no;
    case 'tailLash': {
      const def = kit.tailLash;
      if (!def) return no;
      const behind = players.some(
        (p) => !p.dead && inCone(mob.pos, mob.facing + Math.PI, p.pos, def.range, def.arcDeg),
      );
      return behind ? { ok: true, target: null } : no;
    }
  }
}

function hit(ctx: SimContext, mob: Entity, p: Entity, def: TrashKitCast, amount: number): void {
  ctx.dealDamage(mob, p, amount, false, def.school, def.name, 'hit', true);
}

/** The bar ran out: the cast lands. */
function landCast(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  key: CastKey,
  castId: string,
  targetId: number | null,
  players: readonly Entity[],
  st: TrashKitState,
): void {
  if (isSupportKey(key)) {
    landSupportCast(ctx, mob, kit, key, targetId, st, players);
    return;
  }
  switch (key) {
    case 'reanimate':
      landReanimate(ctx, inst, mob, kit, targetId);
      return;
    case 'brand':
      landBrand(ctx, mob, kit, targetId);
      return;
    case 'nova':
      landNova(ctx, mob, kit, castId, players);
      return;
    case 'walker':
      if (kit.walker) launchWalker(ctx, inst, mob, kit.walker);
      return;
    case 'cone': {
      const def = kit.cone;
      if (!def) return;
      ctx.emit({
        type: 'spellfx',
        sourceId: mob.id,
        targetId: mob.id,
        school: def.school,
        fx: 'nova',
        ability: def.castId,
      });
      for (const p of players) {
        if (p.dead || !inCone(mob.pos, mob.facing, p.pos, def.range, def.arcDeg)) continue;
        hit(ctx, mob, p, def, mechanicDamage(ctx, mob, def.min, def.max));
        if (def.freezeStack && !p.dead) applyFreezeStack(ctx, mob, p, def.freezeStack, def.school);
      }
      return;
    }
    case 'lullaby':
      landLullaby(ctx, inst, mob, kit, targetId, st);
      return;
    case 'goad':
      landGoad(ctx, mob, kit, targetId);
      return;
    case 'toss':
      landToss(ctx, inst, mob, kit, st, players);
      return;
    case 'rupture':
      landRupture(ctx, inst, mob, kit, st, players);
      return;
    case 'eye':
      landEye(ctx, inst, mob, kit, targetId);
      return;
    case 'column':
      endColumn(ctx, mob, kit, st, true);
      return;
    case 'fogBank':
      landFog(ctx, inst, mob, kit, st);
      return;
    case 'hook':
      landHook(ctx, inst, mob, kit, st, players);
      return;
    case 'bolt': {
      const def = kit.bolt;
      const target = targetId !== null ? ctx.entities.get(targetId) : undefined;
      if (!def || !target || target.dead) return;
      ctx.emit({
        type: 'spellfx',
        sourceId: mob.id,
        targetId: target.id,
        school: def.school,
        fx: 'heavyBolt',
        ability: def.castId,
      });
      hit(ctx, mob, target, def, mechanicDamage(ctx, mob, def.min, def.max));
      return;
    }
    case 'raise': {
      const def = kit.raise;
      if (!def) return;
      const x = mob.pos.x + Math.sin(mob.facing) * 2.5;
      const z = mob.pos.z + Math.cos(mob.facing) * 2.5;
      const victim =
        mob.aggroTargetId !== null ? (ctx.entities.get(mob.aggroTargetId) ?? null) : null;
      const add = spawnKitAdd(ctx, inst, mob, def.summon, x, z, victim);
      if (add)
        ctx.emit({
          type: 'spellfx',
          sourceId: mob.id,
          targetId: add.id,
          school: def.school,
          fx: 'nova',
          ability: def.castId,
        });
      return;
    }
    case 'call': {
      const def = kit.call;
      if (!def) return;
      const victim =
        mob.aggroTargetId !== null ? (ctx.entities.get(mob.aggroTargetId) ?? null) : null;
      for (let k = 0; k < def.count; k++) {
        const a = (k / def.count) * Math.PI * 2 + mob.facing;
        spawnKitAdd(
          ctx,
          inst,
          mob,
          def.summon,
          mob.pos.x + Math.sin(a) * 2,
          mob.pos.z + Math.cos(a) * 2,
          victim,
        );
      }
      ctx.emit({
        type: 'spellfx',
        sourceId: mob.id,
        targetId: mob.id,
        school: def.school,
        fx: 'nova',
        ability: def.castId,
      });
      return;
    }
    case 'screech': {
      const def = kit.screech;
      if (!def) return;
      ctx.emit({
        type: 'spellfx',
        sourceId: mob.id,
        targetId: mob.id,
        school: def.school,
        fx: 'nova',
        ability: def.castId,
      });
      for (const p of livingInReach(players, mob.pos, def.radius)) {
        hit(ctx, mob, p, def, mechanicDamage(ctx, mob, def.min, def.max));
        if (p.dead) continue;
        ctx.applyAura(p, {
          id: def.castId,
          name: def.name,
          kind: 'stun',
          remaining: def.stun,
          duration: def.stun,
          value: 0,
          sourceId: mob.id,
          school: def.school,
        });
      }
      return;
    }
    case 'wingGust': {
      const def = kit.wingGust;
      if (!def) return;
      ctx.emit({
        type: 'spellfx',
        sourceId: mob.id,
        targetId: mob.id,
        school: def.school,
        fx: 'nova',
        ability: def.castId,
      });
      for (const p of livingInReach(players, mob.pos, def.radius)) {
        hit(ctx, mob, p, def, mechanicDamage(ctx, mob, def.min, def.max));
        if (!p.dead) applyKnockback(ctx, mob, p, def.knockback);
      }
      return;
    }
    case 'tailLash': {
      const def = kit.tailLash;
      if (!def) return;
      ctx.emit({
        type: 'spellfx',
        sourceId: mob.id,
        targetId: mob.id,
        school: def.school,
        fx: 'nova',
        ability: def.castId,
      });
      for (const p of players) {
        if (p.dead || !inCone(mob.pos, mob.facing + Math.PI, p.pos, def.range, def.arcDeg))
          continue;
        hit(ctx, mob, p, def, mechanicDamage(ctx, mob, def.min, def.max));
      }
      return;
    }
  }
}

/** Advance the cast in flight; returns true while a bar is running. */
function stepCast(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): boolean {
  const cast = st.cast;
  if (!cast) return false;
  const key = cast.key;
  const ext = extensionOf(key);
  const def = castDef(kit, key);
  // An unstoppable nova (kit_nova.ts) shrugs a silence off; a stun still
  // breaks every bar.
  const unstoppable = key === 'nova' && cast.castId === kit.nova?.unstoppableCastId;
  const broken =
    !def ||
    mob.castingAbility !== cast.castId ||
    ctx.isStunned(mob) ||
    (!isPhysicalCast(key) && !unstoppable && isSilenced(mob));
  if (broken) {
    clearCast(mob, cast.castId);
    st.cast = null;
    if (key === 'toss') dropToss(ctx, inst, st);
    if (key === 'rupture') dropRupture(ctx, inst, st);
    if (key === 'column') endColumn(ctx, mob, kit, st, false);
    if (key === 'fogBank') dropUnlaidFog(st);
    if (key === 'hook') st.aim = undefined;
    ext?.broken?.(ctx, mob, key, cast.targetId, st);
    return false;
  }
  mob.castRemaining = Math.max(0, mob.castRemaining - DT);
  mob.swingTimer = Math.max(mob.swingTimer, SWING_HOLD_SECONDS);
  const target = cast.targetId !== null ? ctx.entities.get(cast.targetId) : undefined;
  // A lane holds the aim it locked at the start, a toss the spot it marked;
  // everything else tracks.
  if (ext?.hold?.(mob, key, st)) {
    // The extension holds its own aim (a locked lane).
  } else if (key === 'line' || key === 'hook') holdLineAim(mob, st);
  else if (key === 'rupture') faceRupture(mob, st);
  else if (key === 'toss' && st.toss)
    mob.facing = angleTo(mob.pos, { x: st.toss.x, y: 0, z: st.toss.z });
  else if (target && !target.dead && key !== 'cone') mob.facing = angleTo(mob.pos, target.pos);
  if (key === 'column') stepColumnChannel(ctx, mob, kit, st);
  if (mob.castRemaining > 0) return true;
  clearCast(mob, cast.castId);
  st.cast = null;
  if (ext) ext.land(ctx, inst, mob, kit, key, cast.targetId, players, st);
  else landCast(ctx, inst, mob, kit, key as CastKey, cast.castId, cast.targetId, players, st);
  return false;
}

/** Tick the cooldowns and start the first ready cast. */
function tryStartCast(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): void {
  for (const key of ALL_CAST_KEYS) {
    if (st.timers[key] !== undefined) st.timers[key] -= DT;
  }
  if (mob.castingAbility !== null || st.descent || st.leap) return;
  if (ctx.isStunned(mob)) return;
  for (const key of ALL_CAST_KEYS) {
    const def = castDef(kit, key);
    if (!def || (st.timers[key] ?? 0) > 0) continue;
    // A heroic-only cast never starts on normal (TrashKitCast.heroicOnly).
    if (def.heroicOnly && inst.difficulty !== 'heroic') continue;
    const physical = isPhysicalCast(key);
    if (!physical && (isSilenced(mob) || isLockedOut(mob, def.school as Aura['school']))) continue;
    const ext = extensionOf(key);
    const { ok, target } = ext
      ? ext.ready(ctx, inst, mob, kit, key, st, players)
      : castReady(ctx, inst, mob, kit, key as CastKey, st, players);
    if (!ok) continue;
    st.timers[key] = def.every;
    st.casts++;
    // A nova's every Nth bar runs under its unstoppable id (kit_nova.ts).
    let castId = def.castId;
    if (key === 'nova' && kit.nova) {
      castId = novaCastIdFor(kit.nova, st.novas ?? 0);
      st.novas = (st.novas ?? 0) + 1;
    }
    st.cast = { key, castId, targetId: target?.id ?? null };
    mob.castingAbility = castId;
    mob.castTotal = def.castTime;
    mob.castRemaining = def.castTime;
    mob.castTargetId = target?.id ?? null;
    mob.channeling = key === 'raise' || key === 'reanimate';
    if (key === 'line' || key === 'hook') lockLineAim(mob, st, target);
    else if (target) mob.facing = angleTo(mob.pos, target.pos);
    if (key === 'toss') lockToss(ctx, inst, mob, kit, st, target);
    if (key === 'rupture') lockRupture(ctx, inst, kit, st, target);
    if (key === 'column') lockColumn(ctx, mob, kit, st, target);
    if (key === 'fogBank') lockFog(st, target);
    ext?.started?.(ctx, inst, mob, key, st, target);
    holdAreaCast(ctx, mob, false);
    return;
  }
}

/** The leap: pick a victim when ready, fly the arc, open the bleed on landing.
 *  Returns true while the leap owns the mob's position. */
function stepLeap(
  ctx: SimContext,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): boolean {
  const def = kit.leap;
  if (!def) return false;
  if (!st.leap) {
    st.timers.leap = (st.timers.leap ?? def.first) - DT;
    if (st.timers.leap > 0 || mob.castingAbility !== null || st.descent) return false;
    if (ctx.isStunned(mob) || ctx.isRooted(mob)) return false;
    const target = pickLeapTarget(players, mob.pos, def.minRange, def.maxRange);
    if (!target) return false;
    st.timers.leap = def.every;
    st.leap = { fromX: mob.pos.x, fromZ: mob.pos.z, fromY: mob.pos.y, targetId: target.id, t: 0 };
    mob.facing = angleTo(mob.pos, target.pos);
    ctx.emit({
      type: 'spellfx',
      sourceId: mob.id,
      targetId: target.id,
      school: 'physical',
      fx: 'windup',
      ...(def.castId !== undefined ? { ability: def.castId } : {}),
    });
  }
  const leap = st.leap;
  const target = ctx.entities.get(leap.targetId);
  if (!target || target.dead || ctx.isStunned(mob)) {
    st.leap = null;
    return false;
  }
  leap.t += DT;
  const k = Math.min(1, leap.t / def.seconds);
  const dx = target.pos.x - leap.fromX;
  const dz = target.pos.z - leap.fromZ;
  const len = Math.hypot(dx, dz);
  const reach = Math.max(0, len - LEAP_STOP) / (len || 1);
  mob.pos.x = leap.fromX + dx * reach * k;
  mob.pos.z = leap.fromZ + dz * reach * k;
  const floor = groundY(ctx, mob);
  mob.pos.y = leap.fromY + (floor - leap.fromY) * k + Math.sin(Math.PI * k) * LEAP_ARC;
  mob.facing = angleTo(mob.pos, target.pos);
  if (k < 1) return true;
  mob.pos.y = floor;
  st.leap = null;
  if (def.bleed) {
    ctx.applyAura(target, {
      id: 'crypt_rending_leap',
      name: def.name,
      kind: 'dot',
      remaining: def.bleed.duration,
      duration: def.bleed.duration,
      value: Math.max(1, Math.round(def.bleed.perTick * (mob.mechanicDamageMult ?? 1))),
      tickInterval: def.bleed.interval,
      tickTimer: def.bleed.interval,
      sourceId: mob.id,
      school: 'physical',
    });
  }
  // The Ossuary Cutthroat's Torn Tendon: the victim cannot run from it alone.
  if (def.slow) {
    ctx.applyAura(target, {
      id: CRYPT_TORN_TENDON,
      name: def.slow.name,
      kind: 'slow',
      remaining: def.slow.seconds,
      duration: def.slow.seconds,
      value: def.slow.mult,
      sourceId: mob.id,
      school: 'physical',
    });
  }
  armReleap(kit, st, target);
  if (def.stun) {
    ctx.applyAura(target, {
      id: 'trash_kit_leap_stun',
      name: def.name,
      kind: 'stun',
      remaining: def.stun,
      duration: def.stun,
      value: 0,
      sourceId: mob.id,
      school: 'physical',
    });
  }
  // It fixates on the one it leapt at for a few seconds (a taunt still wins).
  mob.forcedTargetId = target.id;
  mob.forcedTargetTimer = def.fixate;
  mob.aggroTargetId = target.id;
  addThreat(mob, target.id, 1);
  return true;
}

/** A kit add that outlived its growth timer turns into its bigger form. */
function grow(ctx: SimContext, inst: InstanceSlot, mob: Entity, into: string): void {
  let owner: Entity = mob;
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (e && e.summonedIds.includes(mob.id)) {
      owner = e;
      break;
    }
  }
  const victim = mob.aggroTargetId !== null ? (ctx.entities.get(mob.aggroTargetId) ?? null) : null;
  const grown = spawnKitAdd(
    ctx,
    inst,
    owner === mob ? mob : owner,
    into,
    mob.pos.x,
    mob.pos.z,
    victim,
  );
  if (grown) {
    grown.facing = mob.facing;
    grown.prevFacing = mob.facing;
    ctx.emit({
      type: 'spellfx',
      sourceId: grown.id,
      targetId: grown.id,
      school: 'shadow',
      fx: 'nova',
      ability: 'crypt_bone_growth',
    });
  }
  owner.summonedIds = owner.summonedIds.filter((id) => id !== mob.id);
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (e?.targetId === mob.id) e.targetId = grown?.id ?? null;
  }
  mob.trashKit = undefined;
  ctx.dropEntity(mob.id);
}

/** The claim mobs that summoned `mob` (a caller's flock). */
function summonersOf(ctx: SimContext, inst: InstanceSlot, mob: Entity): Entity[] {
  const out: Entity[] = [];
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (e?.summonedIds.includes(mob.id)) out.push(e);
  }
  return out;
}

/** The pull ended in the claim (a death, an evade, a reset): a toss that will
 *  never land lifts its ring, then the kit state goes. */
function endPull(ctx: SimContext, inst: InstanceSlot, mob: Entity): void {
  const st = mob.trashKit;
  if (st) {
    dropToss(ctx, inst, st);
    for (const ext of EXTENSIONS) ext.endPull?.(ctx, inst, mob, st);
  }
  endCryptPull(ctx, inst, mob);
  endBastionPull(ctx, inst, mob, MOBS[mob.templateId]?.trashKit);
  endTrashKit(mob);
}

/** One mob's kit tick. */
function stepMob(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef | undefined,
  players: () => Entity[],
): void {
  // Its brands still burning are put out in a quench zone (brand.ts): only a
  // caster that branded someone carries the list, so nothing else pays.
  if (mob.kitBranded) stepQuench(ctx, inst, mob);
  // A bone pile (crypt_kit.ts) never fights: it counts down or crumbles.
  if (stepBonePile(ctx, inst, mob, kit)) return;
  if (mob.dead || mob.hp <= 0) {
    if (mob.trashKit) endPull(ctx, inst, mob);
    if (kit?.reassemble) judgeReassemble(ctx, inst, mob, kit);
    if (kit?.deathBurst) stepDeathBurst(ctx, inst, mob, kit, players());
    if (kit?.deathCloud) stepDeathCloud(ctx, inst, mob, kit, players());
    // A walker launched by its death leaves once (kit_walker.ts).
    if (kit?.walker?.launch === 'death' && !mob.kitWalkerSent) {
      mob.kitWalkerSent = true;
      launchWalker(ctx, inst, mob, kit.walker);
    }
    return;
  }
  // An area cast in flight (the kit's own, or the template's breath cone):
  // the mob AI walked and turned the caster this tick; stand it back on the
  // spot and the facing its bar began with (cast_hold.ts).
  holdAreaCast(ctx, mob, DUNGEONS[inst.dungeonId]?.areaCastsPlant === true);
  // A mob with no kit came only for its breath cone's hold.
  if (!kit && mob.perchY === undefined) return;
  // A freed prisoner (bastion_kit.ts) kneels out of the fight, then leaves.
  if (stepUnshackle(ctx, inst, mob, kit)) return;
  const engaged =
    mob.inCombat &&
    mob.aggroTargetId !== null &&
    (mob.aiState === 'chase' || mob.aiState === 'attack');
  if (!engaged || !kit) {
    if (mob.trashKit) endPull(ctx, inst, mob);
    // A split half that outlived its pull gets its pool and size back.
    if (mob.kitSplit?.role === 'parent') restoreSplit(mob);
    holdPerch(mob);
    // Remember how high it waits (a perch, a flight loop) for its pull.
    mob.airY = mob.pos.y > groundY(ctx, mob) + AIRBORNE ? mob.pos.y : undefined;
    // The last pack of a gate never stays on the wing (flier_call.ts).
    if (!engaged && mob.dungeonPatrol?.flightY !== undefined)
      callDownLastFlier(ctx, inst, mob, players());
    return;
  }
  const st = mob.trashKit ?? startTrashKit(ctx, mob, kit, inst);
  mob.trashKit = st;
  st.engaged += DT;
  if (kit.grow && st.engaged >= kit.grow.after) {
    grow(ctx, inst, mob, kit.grow.into);
    return;
  }
  stepDescent(ctx, mob, st);
  stepPulse(ctx, inst, mob, kit, st);
  // The dungeons' own upkeep (kit_extension.ts): auras kept up, links, drags.
  for (const ext of EXTENSIONS) if (ext.step?.(ctx, inst, mob, kit, st, players)) return;
  // A brazier whose tender fell gutters out: nothing more this tick.
  if (stepStoke(ctx, inst, mob, kit, st) < 0) return;
  if (stepWithdraw(ctx, mob, kit, st)) return;
  stepCarapace(ctx, mob, kit, st);
  stepSplit(ctx, inst, mob, kit, st);
  const list = players();
  if (kit.detonate && stepDetonate(ctx, mob, kit, list, summonersOf(ctx, inst, mob))) return;
  stepCryptKit(ctx, inst, mob, kit, st, list);
  // A leap back in flight owns the mob's position (bastion_kit.ts).
  if (stepBastionKit(ctx, inst, mob, kit, st, list)) return;
  if (stepCast(ctx, inst, mob, kit, st, list)) return;
  if (stepLeap(ctx, mob, kit, st, list)) return;
  tryStartCast(ctx, inst, mob, kit, st, list);
}

/** One tick of every trash kit in every claimed dungeon. */
export function tickTrashKits(ctx: SimContext): void {
  for (const inst of ctx.instances) {
    if (inst.partyKey === null) {
      // A freed claim drops its walls from the collision view (once).
      syncCombatWallCollision(ctx, inst, 0);
      continue;
    }
    let cached: Entity[] | null = null;
    const players = (): Entity[] => {
      cached ??= claimPlayers(ctx, inst);
      return cached;
    };
    // A copy: a raise, a call or a growth appends to the roster mid-pass.
    for (const id of inst.mobIds.slice()) {
      const mob = ctx.entities.get(id);
      if (!mob || mob.kind !== 'mob') continue;
      const template = MOBS[mob.templateId];
      // A dev-lent kit (engine_demo.ts, /dev trashkit) stands in for the
      // template's while it is set.
      const kit = mob.devTrashKit ?? template?.trashKit;
      // (A mob with no kit still plants for its breath cone: cast_hold.ts.)
      const breath = template?.breathCone && DUNGEONS[inst.dungeonId]?.areaCastsPlant;
      if (!kit && mob.perchY === undefined && !breath) continue;
      stepMob(ctx, inst, mob, kit, players);
    }
    // The engine's encounter objects (hazard pools, combat walls, walkers),
    // after every mob, in object-roster order (a snapshot of their ids: a
    // pool may lift mid-pass).
    const kitIds = kitObjectIds(ctx, inst);
    if (kitIds) stepKitObjects(ctx, inst, kitIds, players);
    syncCombatWallCollision(ctx, inst, kitIds ? kitWallCount(ctx, kitIds) : 0);
  }
}

/** Walls still standing among the pass's objects (one may have shattered). */
function kitWallCount(ctx: SimContext, ids: readonly number[]): number {
  let n = 0;
  for (const id of ids) if (ctx.entities.get(id)?.kitObject?.kind === 'wall') n++;
  return n;
}

/** One tick of every engine object of a claim. */
function stepKitObjects(
  ctx: SimContext,
  inst: InstanceSlot,
  ids: readonly number[],
  players: () => Entity[],
): void {
  for (const id of ids) {
    const obj = ctx.entities.get(id);
    const st = obj?.kitObject;
    if (!obj || !st) continue;
    if (st.kind === 'hazard') stepKitHazard(ctx, inst, obj, players());
    else if (st.kind === 'wall') stepCombatWall(ctx, inst, obj);
    else stepWalker(ctx, inst, obj, players());
  }
}
