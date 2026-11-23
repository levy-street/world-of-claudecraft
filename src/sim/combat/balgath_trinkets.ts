// Balgath's five trinkets (the data is src/sim/content/trinkets.ts): the Knucklebone of
// Balgath's Shape of the Foreman, the Muster Standard's soldiers, the Guttered Eye's
// channelled glare, the Muster Grapnel's haul and the Barrowstone Heart's stone statue.
// combat/trinkets.ts useWornTrinket routes the four USE kinds here, damage.ts asks the
// Heart before a lethal hit lands, and auras.ts ticks the glare and the statue.
//
// Every mechanic rides machinery the sim already has rather than a parallel system:
//   - the shape is an aura (kind 'form_foreman') that entity.ts folds into armor and
//     body scale and that knockback.ts reads to refuse a shove; the renderer swaps the
//     body the same way it swaps the warlock's Metamorphosis rig;
//   - the soldiers are guardians (combat/guardians.ts) in its opt-in walking melee mode,
//     following their owner;
//   - the glare is an aura with a tick interval, its line test run server-side;
//   - the haul is a Heroic Leap flight (combat/heroic_leap.ts) armed on the ally, with
//     no landing blast;
//   - the statue is a stasis aura (full immunity and lockout, combat/cc.ts) whose tick
//     at the end of its life brings the wearer back.
// Determinism: the only rng draws are the soldiers' damage rolls (guardians.ts); the
// glare, the haul and the statue draw nothing.

import {
  TRINKET_AURA,
  TRINKET_SPECS,
  type TrinketPassive,
  type TrinketUse,
  trinketCooldownKey,
} from '../content/trinkets';
import { DUNGEON_X_THRESHOLD } from '../data';
import { instanceInfoAt } from '../instances/dungeons';
import { forceDismount } from '../mounts';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { type Aura, type Entity, MELEE_RANGE } from '../types';
import { isStunned } from './cc';
import { summonGuardian } from './guardians';
import { sweptLanding } from './heroic_leap';

type UseOf<K extends TrinketUse['kind']> = Extract<TrinketUse, { kind: K }>;

/** The Muster Standard's two soldiers: guardian key, name, and the camp look the
 *  renderer dresses them in (render/characters/manifest.ts MOB_KEYS). */
export const MUSTER_STANDARD_SOLDIERS = Object.freeze([
  { key: 'muster_standard_spear', name: 'Muster Footman' },
  { key: 'muster_standard_sword', name: 'Muster Sergeant' },
] as const);

/** The muster's crimson, the entity tint the camp soldiers wear. */
const MUSTER_TINT = 0x9c2f26;

/** How far the glare may drift from where it was planted before the channel breaks
 *  (turning in place is the point; walking away is not). */
export const GUTTERED_GLARE_DRIFT = 0.5;

/** Where the grappled ally lands: this far to your right, a step ahead. */
const GRAPNEL_SIDE = 1.6;
const GRAPNEL_AHEAD = 0.6;

function removeOwnAura(ctx: SimContext, e: Entity, id: string): void {
  const index = e.auras.findIndex((aura) => aura.id === id && aura.sourceId === e.id);
  if (index < 0) return;
  const [aura] = e.auras.splice(index, 1);
  ctx.emit({ type: 'aura', targetId: e.id, name: aura.name, gained: false });
}

function selfCue(ctx: SimContext, e: Entity, school: string, ability: string): void {
  ctx.emit({ type: 'spellfx', sourceId: e.id, targetId: e.id, school, fx: 'selfCast', ability });
}

/** The power a weapon-driven trinket scales with (combat/trinkets.ts weaponPower). */
function weaponPower(p: Entity): number {
  return Math.max(p.attackPower, p.rangedPower);
}

// ---- using them ------------------------------------------------------------------------

/**
 * Run one of the Balgath USE kinds. Returns true when it fired (the caller then starts
 * the cooldown), false when it was refused (the reason already emitted), and null when
 * `use` is not one of these kinds.
 */
export function useBalgathTrinket(
  ctx: SimContext,
  meta: PlayerMeta,
  p: Entity,
  use: TrinketUse,
): boolean | null {
  switch (use.kind) {
    case 'foremanShape':
      takeForemanShape(ctx, p, use);
      return true;
    case 'musterStandard':
      plantMusterStandard(ctx, p, use);
      return true;
    case 'gutteredGlare':
      return startGutteredGlare(ctx, meta, p, use);
    case 'grapnel':
      return throwGrapnel(ctx, meta, p, use);
    case 'passiveOnly':
      ctx.error(meta.entityId, 'It works on its own.');
      return false;
    default:
      return null;
  }
}

// ---- Knucklebone of Balgath: the Shape of the Foreman ------------------------------------

function takeForemanShape(ctx: SimContext, p: Entity, use: UseOf<'foremanShape'>): void {
  // A cyclops does not ride: the shape takes the saddle's place, the way a form does.
  if (p.mountKey) forceDismount(ctx, p);
  ctx.applyAura(p, {
    id: TRINKET_AURA.foremanShape,
    name: 'Shape of the Foreman',
    kind: 'form_foreman',
    remaining: use.duration,
    duration: use.duration,
    value: use.armorPct,
    sourceId: p.id,
    school: 'physical',
  });
  selfCue(ctx, p, 'physical', 'trinket_knucklebone_of_balgath');
}

/** Whether the Shape of the Foreman holds this body against a knockback. */
export function isForemanShaped(e: Entity): boolean {
  for (const aura of e.auras) if (aura.kind === 'form_foreman') return true;
  return false;
}

// ---- Muster Standard: the soldiers --------------------------------------------------------

function plantMusterStandard(ctx: SimContext, p: Entity, use: UseOf<'musterStandard'>): void {
  // The standard is an aura on its planter carrying where it stands (value2/value3 are
  // the x/z, the Last Flame Lantern's idiom): the renderer plants the banner there and it
  // falls with the aura, on its timer or the planter's death.
  ctx.applyAura(p, {
    id: TRINKET_AURA.musterStandard,
    name: 'Muster Standard',
    kind: 'internal_cd',
    remaining: use.duration,
    duration: use.duration,
    value: use.soldiers,
    value2: p.pos.x,
    value3: p.pos.z,
    sourceId: p.id,
    school: 'physical',
  });
  const bonus = weaponPower(p) * use.coef;
  const minDamage = Math.max(1, Math.round(use.min + bonus));
  const maxDamage = Math.max(minDamage, Math.round(use.max + bonus));
  for (let index = 0; index < use.soldiers; index++) {
    const soldier = MUSTER_STANDARD_SOLDIERS[index % MUSTER_STANDARD_SOLDIERS.length];
    // Either side of the standard, a stride apart, so the two do not spawn in one body.
    const side = index % 2 === 0 ? -1 : 1;
    summonGuardian(ctx, p, {
      key: soldier.key,
      name: soldier.name,
      color: MUSTER_TINT,
      scale: 1,
      remaining: use.duration,
      attackInterval: use.attackInterval,
      minDamage,
      maxDamage,
      school: 'physical',
      abilityId: 'trinket_muster_standard',
      abilityName: 'Muster Standard',
      preferredTargetId: null,
      maxRange: use.leash,
      spawnAt: {
        x: p.pos.x + Math.cos(p.facing) * 1.4 * side,
        z: p.pos.z - Math.sin(p.facing) * 1.4 * side,
      },
      maxHp: p.maxHp * use.hpShare,
      // They FOLLOW (owner playtest: soldiers that stood guard at the banner while the
      // player walked on read as broken): out of a fight they march at your side, in one
      // they fight your target wherever you take it, and left behind past the leash they
      // rejoin you. The banner stays where it was planted, the muster's rallying point.
      melee: {
        moveSpeed: use.moveSpeed,
        reach: MELEE_RANGE,
        postX: p.pos.x,
        postZ: p.pos.z,
        leash: use.leash,
        postAuraId: TRINKET_AURA.musterStandard,
        followOwner: true,
        followSide: side,
      },
    });
  }
  ctx.emit({
    type: 'spellfxAt',
    x: p.pos.x,
    z: p.pos.z,
    school: 'physical',
    fx: 'nova',
    ability: 'trinket_muster_standard',
    radius: 2,
    sourceId: p.id,
  });
}

// ---- The Guttered Eye: the glare --------------------------------------------------------------

function startGutteredGlare(
  ctx: SimContext,
  meta: PlayerMeta,
  p: Entity,
  use: UseOf<'gutteredGlare'>,
): boolean {
  if (p.castingAbility) {
    ctx.error(meta.entityId, 'You are busy.');
    return false;
  }
  // The per-tick hit is set when the eye opens (Spell Power snapshot, like a DoT's), so a
  // buff that lands mid-channel does not rewrite a beam already burning.
  const tick = Math.max(1, Math.round(use.flat + use.coef * p.spellPower));
  ctx.applyAura(p, {
    id: TRINKET_AURA.gutteredGlare,
    name: 'Guttered Glare',
    kind: 'internal_cd',
    remaining: use.duration,
    duration: use.duration,
    value: tick,
    // Where the channel was planted: moving away from it breaks the beam.
    value2: p.pos.x,
    value3: p.pos.z,
    tickInterval: use.every,
    tickTimer: use.every,
    sourceId: p.id,
    school: 'arcane',
  });
  selfCue(ctx, p, 'arcane', 'trinket_guttered_eye');
  return true;
}

/** The enemies a beam from `from`, facing `facing`, crosses: nearest first, at most
 *  `max`, each within `halfWidth` (plus its own body) of the line and `length` along it.
 *  Pure geometry over the candidate list, so a test can drive it with plain points. */
export function glareLineHits<
  T extends { id: number; pos: { x: number; z: number }; scale?: number },
>(
  from: { x: number; z: number },
  facing: number,
  candidates: readonly T[],
  length: number,
  halfWidth: number,
  max: number,
): T[] {
  const dx = Math.sin(facing);
  const dz = Math.cos(facing);
  const hits: { e: T; along: number }[] = [];
  for (const e of candidates) {
    const rx = e.pos.x - from.x;
    const rz = e.pos.z - from.z;
    const along = rx * dx + rz * dz;
    if (along < 0 || along > length) continue;
    const across = Math.abs(rx * dz - rz * dx);
    if (across > halfWidth + 0.5 * (e.scale ?? 1)) continue;
    hits.push({ e, along });
  }
  hits.sort((a, b) => a.along - b.along || a.e.id - b.e.id);
  return hits.slice(0, max).map((hit) => hit.e);
}

/** One tick of the glare (auras.ts): break it if the eye's owner can no longer hold it,
 *  else burn every enemy in the line the owner faces NOW, so turning sweeps it. */
export function tickGutteredGlare(ctx: SimContext, p: Entity, aura: Aura): void {
  const spec = balgathUse(ctx, p, 'gutteredGlare');
  const drifted =
    aura.value2 !== undefined &&
    aura.value3 !== undefined &&
    Math.hypot(p.pos.x - aura.value2, p.pos.z - aura.value3) > GUTTERED_GLARE_DRIFT;
  if (!spec || p.dead || isStunned(p) || drifted || p.castingAbility) {
    removeOwnAura(ctx, p, TRINKET_AURA.gutteredGlare);
    return;
  }
  const candidates = ctx
    .hostilesInRadius(p, p.pos, spec.length + 2)
    .filter((e) => !e.dead && ctx.hasLineOfSight(p, e));
  const hits = glareLineHits(
    p.pos,
    p.facing,
    candidates,
    spec.length,
    spec.halfWidth,
    spec.maxTargets,
  );
  for (const target of hits) {
    if (target.dead) continue;
    ctx.dealDamage(p, target, aura.value, false, 'arcane', 'Guttered Glare', 'hit');
  }
}

/** The worn trinket's use of `kind`, if the wearer still wears it. */
function balgathUse<K extends TrinketUse['kind']>(
  ctx: SimContext,
  p: Entity,
  kind: K,
): UseOf<K> | null {
  const worn = wornSpec(ctx, p);
  return worn?.use.kind === kind ? (worn.use as UseOf<K>) : null;
}

function wornSpec(ctx: SimContext, p: Entity) {
  if (p.kind !== 'player') return null;
  return balgathSpecs(ctx.players.get(p.id)?.equipment?.trinket ?? null);
}

// ---- Muster Grapnel: the haul -------------------------------------------------------------------

/** Why an ally cannot be hauled right now, or null when they can. Server-side only. */
function grapnelRefusal(
  ctx: SimContext,
  p: Entity,
  target: Entity | null,
  use: UseOf<'grapnel'>,
): string | null {
  // The thrower needs their own feet under them: not mid-leap, aboard a ship, in a
  // vehicle seat or in a mount race.
  const own = ctx.players.get(p.id);
  if (p.leap || p.ferryRide || own?.vehicle || own?.mountRace) return 'You are busy.';
  if (!target || target.id === p.id || target.kind !== 'player') return 'You must target an ally.';
  const party = ctx.partyOf(p.id);
  if (!party || !party.members.includes(target.id)) return 'You must target an ally.';
  if (target.dead || target.ghost) return 'You must target an ally.';
  if (Math.hypot(target.pos.x - p.pos.x, target.pos.z - p.pos.z) > use.range)
    return 'Out of range.';
  if (!ctx.hasLineOfSight(p, target)) return 'Line of sight.';
  // Never across an instance wall: both in the open world, or both in the same slot.
  const inside = p.pos.x > DUNGEON_X_THRESHOLD;
  if (inside !== target.pos.x > DUNGEON_X_THRESHOLD) return 'Out of range.';
  if (inside) {
    const a = instanceInfoAt(ctx, p.pos);
    const b = instanceInfoAt(ctx, target.pos);
    if (!a || !b || a.slot !== b.slot || a.dungeonId !== b.dungeonId) return 'Out of range.';
  }
  const meta = ctx.players.get(target.id);
  // A body another mode owns stays where it is: a vehicle seat, a ship's deck, a leap or
  // a climb already under way, a braced pike, a mount race or riding lesson, a body that
  // refuses to be moved (the Mooring Stone's anchor, the Shape of the Foreman, a dev
  // anchor), a statue, or any hold that cannot be broken.
  if (
    meta?.vehicle ||
    meta?.mountRace ||
    meta?.mountTraining ||
    meta?.devAnchored ||
    isForemanShaped(target) ||
    target.auras.some((a) => a.id === TRINKET_AURA.anchor) ||
    target.ferryRide ||
    target.leap ||
    target.climb ||
    target.valkyrsCalling ||
    meta?.lance ||
    target.auras.some((a) => a.kind === 'stasis')
  )
    return "They can't be moved right now.";
  if (target.auras.some((a) => a.unbreakableControl === true && a.kind !== 'slow'))
    return "They can't be moved right now.";
  return null;
}

function throwGrapnel(
  ctx: SimContext,
  meta: PlayerMeta,
  p: Entity,
  use: UseOf<'grapnel'>,
): boolean {
  const target = p.targetId === null ? null : (ctx.entities.get(p.targetId) ?? null);
  const refusal = grapnelRefusal(ctx, p, target, use);
  if (refusal || !target) {
    ctx.error(meta.entityId, refusal ?? 'You must target an ally.');
    return false;
  }
  // Land beside the thrower, on whatever ground the swept line reaches first (a wall or a
  // cliff stops the haul short, exactly like a Heroic Leap would stop).
  const rightX = Math.cos(p.facing);
  const rightZ = -Math.sin(p.facing);
  const aim = {
    x: p.pos.x + rightX * GRAPNEL_SIDE + Math.sin(p.facing) * GRAPNEL_AHEAD,
    y: p.pos.y,
    z: p.pos.z + rightZ * GRAPNEL_SIDE + Math.cos(p.facing) * GRAPNEL_AHEAD,
  };
  if (target.mountKey) forceDismount(ctx, target);
  const landing = sweptLanding(ctx, target, aim);
  target.chargeTargetId = null;
  target.chargePath = [];
  target.leap = {
    from: { ...target.pos },
    to: landing,
    elapsed: 0,
    duration: use.flight,
    apex: use.apex,
    // No blast on landing (heroic_leap.ts skips a zero radius entirely).
    landingAoe: { min: 0, max: 0, radius: 0 },
    abilityName: 'Grapnel Pull',
    abilityId: 'trinket_muster_grapnel',
    school: 'physical',
    landingHeal: {
      sourceId: p.id,
      amount: Math.max(1, Math.round(use.heal + use.coef * p.healPower)),
      name: 'Muster Grapnel',
    },
  };
  ctx.emit({
    type: 'spellfx',
    sourceId: p.id,
    targetId: target.id,
    school: 'physical',
    fx: 'projectile',
    ability: 'trinket_muster_grapnel',
  });
  return true;
}

// ---- Barrowstone Heart: the statue ------------------------------------------------------------

function stoneHeartOf(
  ctx: SimContext,
  p: Entity,
): Extract<TrinketPassive, { kind: 'stoneHeart' }> | null {
  const worn = wornSpec(ctx, p);
  return worn?.passive?.kind === 'stoneHeart' ? worn.passive : null;
}

/**
 * Called by dealDamage for a hit about to land. When it would kill a player who wears a
 * ready Barrowstone Heart, the wearer turns to stone instead and the hit is cut to leave
 * them at 1 health; returns that amount, or null when the Heart does not fire.
 *
 * It is the LAST save asked (damage.ts): a guardian ward, Cauterize and a talent's
 * deathward all get their turn first and leave nothing lethal for it. A duelist's killing
 * blow is clamped before any save is asked, and it never fires inside an arena match
 * (whatever the blow's source), so ranked play ends at the killing blow. It does fire in
 * battlegrounds and open-world PvP, like the deathward talent. Its internal cooldown is the trinket's use cooldown key, so it survives death
 * and relog and the 30 sec on-equip lockout (combat/trinkets.ts onTrinketEquipped) keeps
 * a swap from arming a fresh Heart mid-fight.
 */
export function barrowstoneSave(ctx: SimContext, target: Entity, amount: number): number | null {
  if (target.kind !== 'player' || target.dead || amount < target.hp) return null;
  if (ctx.arenaMatches.has(target.id)) return null;
  const heart = stoneHeartOf(ctx, target);
  if (!heart) return null;
  const itemId = ctx.players.get(target.id)?.equipment?.trinket;
  if (!itemId) return null;
  const key = trinketCooldownKey(itemId);
  if ((target.cooldowns.get(key) ?? 0) > 0) return null;
  ctx.applyAura(target, {
    id: TRINKET_AURA.stoneStatue,
    name: 'Stone Statue',
    kind: 'stasis',
    remaining: heart.statue,
    duration: heart.statue,
    value: heart.restore,
    // One tick at the very end of its life (auras.ts): the wearer comes back.
    tickInterval: heart.statue,
    tickTimer: heart.statue,
    sourceId: target.id,
    school: 'physical',
    unbreakableControl: true,
  });
  // No statue, no save: a body that refused the stasis is not left at 1 health with the
  // Heart spent and nothing to bring it back.
  if (!target.auras.some((a) => a.id === TRINKET_AURA.stoneStatue)) return null;
  target.cooldowns.set(key, balgathSpecs(itemId)?.cooldown ?? 0);
  selfCue(ctx, target, 'physical', 'trinket_barrowstone_heart');
  ctx.emit({
    type: 'log',
    pid: target.id,
    text: 'Your Barrowstone Heart turns you to stone!',
    color: '#ffd100',
  });
  return Math.max(0, target.hp - 1);
}

/** The statue's end (auras.ts, its one tick): back on your feet at the Heart's share of
 *  your maximum health. */
export function releaseStoneStatue(ctx: SimContext, e: Entity, aura: Aura): void {
  if (e.dead) return;
  const restored = Math.max(e.hp, Math.round(e.maxHp * aura.value));
  const healed = restored - e.hp;
  e.hp = restored;
  if (healed > 0) ctx.emit({ type: 'heal', targetId: e.id, amount: healed });
  selfCue(ctx, e, 'physical', 'trinket_barrowstone_heart_release');
}

function balgathSpecs(itemId: string | null) {
  return itemId ? (TRINKET_SPECS[itemId] ?? null) : null;
}
