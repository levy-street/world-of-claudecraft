// The Drakelands dragonkin brood (v0.35 rework): eggs, whelps, and the
// broodlord support kit, behind the SimContext seam.
//
// What lives here:
//  - The per-tick brood pass (`updateDragonkinBrood`, a tick phase): cracks
//    eggs a player walks onto (proximity ambush), ripples a break to the
//    neighboring eggs on a stagger (the chain cascade), hatches a whelp out
//    of every cracked egg with the pounce + priority-targeting behavior, and
//    runs the whelp upkeep (pounce speed-burst expiry, the one-hit ward
//    strip) and the broodlord counter-stun retaliation.
//  - The broodlord engage-shout support (`dragonkinEngageShout`): the shout
//    spellfx, cracking every egg in radius awake, and tagging those eggs so
//    their hatchlings come out warded.
//  - The shared burn applier (`applyBroodBurn`): every brood mechanic burn
//    (pounce landing, front-arc cleave, fire breath) rides the same
//    refreshing dot aura the venom/cinder on-hit family uses.
//
// Egg corpses are the OPEN SHELLS: a cracked egg dies through the normal
// death path (the renderer swaps its visual from the closed to the open
// shell on death) and decays/respawns on the ordinary camp cadence, so the
// clutch re-forms over time.
//
// Determinism: the pass draws rng ONLY when an egg hatches (the whelp's
// level-band roll, mirroring spawnBossAdds), so a world with no cracked eggs
// draws nothing here. Iteration follows the entities map (insertion order,
// deterministic across hosts).

import { MOBS } from '../data';
import { createMob } from '../entity';
import type { SimContext } from '../sim_context';
import { addThreat } from '../threat';
import {
  type Aura,
  dist2d,
  type Entity,
  type MobBurnSpec,
  type MobTemplate,
  type Vec3,
} from '../types';

// One-hit ward: the absorb is sized far past any single player hit, and the
// upkeep pass strips it the tick after it soaks ANYTHING, so exactly one hit
// is eaten whole (two hits landing the same tick both soak; acceptable).
const WARD_ABSORB = 9999;
const WARD_AURA_ID = 'brood_ward';
// How far from a cracking egg the hatchling looks for prey (and the shout /
// proximity ambush hand it a victim to pounce).
const HATCH_TARGET_RANGE = 24;
// Threat the hatch seeds on its chosen victim: enough that proximity aggro
// off other players does not immediately re-roll the pick, small enough that
// a taunt or a big heal peels it (the counterplay).
const HATCH_THREAT = 60;
// The pounce is a CALCULATED leap: it never runs shorter than this (a
// point-blank hatch still reads as a hop, and the render one-shot needs its
// windup), and loose whelps that re-acquire a player may pounce again after
// this cooldown, so the jump attack stays their signature past the hatch.
const LEAP_MIN_SECONDS = 0.4;
const REPOUNCE_COOLDOWN = 8;
// Beyond melee contact but inside broodWhelp.leapRange: the re-pounce window.
const REPOUNCE_MIN_DIST = 5;

/** Launch the whelp's pounce at `victim`: duration derives from the LIVE
 *  distance at launch (speed = authored moveSpeed x leapSpeedMult, capped at
 *  leapSeconds), the landing owes the burn, and the renderer plays the
 *  JumpAttack one-shot off the flourish cue. Draws no rng. */
function startPounce(
  ctx: SimContext,
  whelp: Entity,
  def: NonNullable<MobTemplate['broodWhelp']>,
  victim: Entity,
): void {
  const tmplSpeed = MOBS[whelp.templateId]?.moveSpeed ?? whelp.moveSpeed;
  const speed = tmplSpeed * def.leapSpeedMult;
  const dist = dist2d(whelp.pos, victim.pos);
  const duration = Math.min(def.leapSeconds, Math.max(LEAP_MIN_SECONDS, dist / Math.max(speed, 1)));
  whelp.aggroTargetId = victim.id;
  whelp.aiState = 'chase';
  addThreat(whelp, victim.id, HATCH_THREAT);
  whelp.leapUntil = ctx.time + duration;
  whelp.leapReadyAt = ctx.time + REPOUNCE_COOLDOWN;
  whelp.leapBurnPending = true;
  whelp.moveSpeed = speed;
  ctx.emit({
    type: 'spellfx',
    sourceId: whelp.id,
    targetId: victim.id,
    school: 'fire',
    fx: 'flourish',
  });
}

function burnAuraId(spec: MobBurnSpec): string {
  // Shared name -> shared debuff row (cleave + breath both refresh 'Seared
  // Scales'); distinct names stack separately (the whelp's Hatchling Burn).
  return `brood_burn_${spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

/** Apply a brood mechanic burn: a refreshing fire-school dot, the same aura
 *  seam the on-hit venom/cinder family rides. Draws no rng. */
export function applyBroodBurn(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  spec: MobBurnSpec,
): void {
  if (target.dead) return;
  ctx.applyAura(target, {
    id: burnAuraId(spec),
    name: spec.name,
    kind: 'dot',
    remaining: spec.duration,
    duration: spec.duration,
    value: Math.max(1, Math.round(spec.perTick)),
    tickInterval: spec.interval,
    tickTimer: spec.interval,
    sourceId: source.id,
    school: (spec.school as Aura['school']) ?? 'fire',
  });
}

/** Pick the hatchling's victim near `pos`: any living, unstealthed player in
 *  range, preferring a healer, then a damage-dealer, then whoever is
 *  closest (the brood smells soft targets; only a lone tank gets pounced by
 *  default). Distance breaks ties inside each band. Draws no rng. */
function pickWhelpVictim(ctx: SimContext, pos: Vec3): Entity | null {
  let best: Entity | null = null;
  let bestBand = 3;
  let bestD = Infinity;
  for (const meta of ctx.players.values()) {
    const pe = ctx.entities.get(meta.entityId);
    if (!pe || pe.dead || pe.stealthed) continue;
    const d = dist2d(pe.pos, pos);
    if (d > HATCH_TARGET_RANGE) continue;
    const role = meta.talentMods.role;
    const band = role === 'healer' ? 0 : role === 'dps' ? 1 : 2;
    if (band < bestBand || (band === bestBand && d < bestD)) {
      best = pe;
      bestBand = band;
      bestD = d;
    }
  }
  return best;
}

/** Crack a living egg open NOW through the normal death path (the renderer
 *  swaps closed -> open shell on the death event; xpMult 0 pays no XP). The
 *  next brood pass sees the corpse and hatches the whelp.
 *
 *  Draws no rng, and what carries that is the NULL killer, not xpMult: with no
 *  killer and no tapper, handleDeath's creditId resolves to null and the whole
 *  credited-kill block is skipped, rollLoot included (combat/damage.ts). xpMult
 *  0 only zeroes the XP INSIDE that block. Giving chain/shout/ambush cracks a
 *  killer would start drawing shared rng per egg and drift every seeded roll
 *  downstream, so that change owes this comment a second look. */
function crackEgg(ctx: SimContext, egg: Entity): void {
  if (egg.dead) return;
  ctx.dealDamage(null, egg, Math.max(1, egg.hp), false, 'physical', 'Brood Ripple', 'hit', true);
}

/** Hatch the whelp out of a freshly-dead egg: burst FX, the level-band roll
 *  (the one rng draw, mirroring spawnBossAdds), the pounce at a
 *  priority-picked victim, and the one-hit ward when the broodlord's shout
 *  cracked this egg. */
function hatchEgg(ctx: SimContext, egg: Entity, def: NonNullable<MobTemplate['broodEgg']>): void {
  egg.broodHatched = true;
  const template = MOBS[def.hatchMobId];
  if (!template) return;
  ctx.emit({
    type: 'spellfxAt',
    x: egg.pos.x,
    z: egg.pos.z,
    school: 'fire',
    fx: 'burst',
    radius: 2,
  });
  const level = ctx.rng.int(template.minLevel, template.maxLevel);
  const whelp = createMob(ctx.nextId++, template, level, { ...egg.pos });
  // Slain whelps unravel with their corpse instead of respawning where they
  // hatched (the summoned-add rule; mob/locomotion.ts). The egg's own camp
  // respawn re-clutches the nest and with it the next generation.
  whelp.summonedAdd = true;
  // Inherit the egg's off-stream contract: a hatchling left un-engaged idles
  // like any other brood mob, and its wander must not drift the shared stream
  // either (see Entity.offStreamRng).
  if (egg.offStreamRng) whelp.offStreamRng = true;
  ctx.addEntity(whelp);

  // The broodlord's shout wards the hatchlings of the eggs IT cracked: the
  // first player hit is fully absorbed (upkeep strips the ward after it
  // soaks). Chain-broken eggs beyond the shout radius hatch unwarded.
  if (egg.broodWardOnHatch) {
    const ward = egg.broodWardOnHatch;
    ctx.applyAura(whelp, {
      id: WARD_AURA_ID,
      name: ward.name,
      kind: 'absorb',
      remaining: ward.duration,
      duration: ward.duration,
      value: WARD_ABSORB,
      sourceId: whelp.id,
      school: 'fire',
    });
    whelp.wardOneHit = true;
  }

  // The pounce: pick a victim (healer > dps > closest), seed threat so the
  // pick sticks, and leap the calculated distance; the first landed swing
  // owes the pounce burn (mob_swing's broodWhelp arm applies and clears it).
  const wDef = MOBS[def.hatchMobId]?.broodWhelp;
  const victim = pickWhelpVictim(ctx, egg.pos);
  if (victim && wDef && dist2d(victim.pos, egg.pos) <= wDef.leapRange) {
    startPounce(ctx, whelp, wDef, victim);
  }
}

/** The broodlord/matriarch engage shout (combat_profile fires it once per
 *  pull): the shout cue for the renderer, then crack every egg in radius
 *  awake, tagging them so their hatchlings come out warded. */
export function dragonkinEngageShout(
  ctx: SimContext,
  mob: Entity,
  shout: NonNullable<MobTemplate['engageShout']>,
): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: mob.id,
    school: 'fire',
    fx: 'shout',
  });
  if (!shout.breakEggsRadius) return;
  for (const e of ctx.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    if (!MOBS[e.templateId]?.broodEgg) continue;
    if (dist2d(e.pos, mob.pos) > shout.breakEggsRadius) continue;
    if (shout.wardWhelps) e.broodWardOnHatch = shout.wardWhelps;
    crackEgg(ctx, e);
  }
}

/** The per-tick brood pass (a tick phase; see sim.ts `tick()`):
 *  eggs (hatch the freshly dead, spring proximity ambushes, fire due chain
 *  ripples), whelps (pounce expiry, ward strip), and the broodlord
 *  counter-stun retaliation. Draws rng only via hatchEgg. */
export function updateDragonkinBrood(ctx: SimContext): void {
  for (const e of ctx.entities.values()) {
    if (e.kind !== 'mob') continue;
    const tmpl = MOBS[e.templateId];
    if (!tmpl) continue;

    const eggDef = tmpl.broodEgg;
    if (eggDef) {
      if (e.dead) {
        // Freshly cracked (by a hit, the ripple, the shout, or the ambush):
        // hatch once. Gated on broodCracked (set only by the real damage
        // path in handleDeath), so a corpse fiat-flagged dead outside combat
        // (test silencing, admin sweeps) stays inert. The corpse stays as
        // the open shell until camp respawn.
        if (e.broodCracked && !e.broodHatched) {
          hatchEgg(ctx, e, eggDef);
          // The break ripples outward: every still-whole egg nearby cracks
          // after the stagger, so a clutch cascades hop by hop.
          for (const other of ctx.entities.values()) {
            if (other.id === e.id || other.kind !== 'mob' || other.dead) continue;
            if (!MOBS[other.templateId]?.broodEgg) continue;
            if (other.broodChainAt !== undefined) continue;
            if (dist2d(other.pos, e.pos) > eggDef.chainRadius) continue;
            other.broodChainAt = ctx.time + eggDef.chainDelay;
          }
        }
      } else if (e.broodChainAt !== undefined) {
        if (ctx.time >= e.broodChainAt) {
          e.broodChainAt = undefined;
          crackEgg(ctx, e);
        }
      } else {
        // Proximity ambush: a player stepping into the clutch springs it.
        ctx.playerGrid.forEachInRadius(e.pos.x, e.pos.z, eggDef.proximityRadius, (pl) => {
          if (e.dead || pl.kind !== 'player' || pl.dead || pl.stealthed) return;
          if (dist2d(pl.pos, e.pos) > eggDef.proximityRadius) return;
          crackEgg(ctx, e);
        });
      }
      continue;
    }

    if (tmpl.broodWhelp && !e.dead) {
      // Pounce expiry: the burst restores to authored template speed.
      if (e.leapUntil !== undefined && ctx.time >= e.leapUntil) {
        e.leapUntil = undefined;
        e.moveSpeed = tmpl.moveSpeed;
      }
      // Re-pounce: a loose whelp that has (re)acquired a player launches the
      // jump attack again once the cooldown clears and the victim sits in
      // the leap window (past melee contact, inside leapRange), so the
      // signature move survives the hatch moment. Draws no rng.
      if (
        e.leapUntil === undefined &&
        e.aggroTargetId !== null &&
        ctx.time >= (e.leapReadyAt ?? 0)
      ) {
        const victim = ctx.entities.get(e.aggroTargetId);
        if (victim && !victim.dead && victim.kind === 'player') {
          const d = dist2d(victim.pos, e.pos);
          if (d >= REPOUNCE_MIN_DIST && d <= tmpl.broodWhelp.leapRange) {
            startPounce(ctx, e, tmpl.broodWhelp, victim);
          }
        }
      }
      // One-hit ward strip: the tick after the absorb soaks ANY damage, it
      // shatters, so exactly one hit is eaten whole.
      if (e.wardOneHit) {
        const idx = e.auras.findIndex((a) => a.id === WARD_AURA_ID);
        if (idx < 0) {
          e.wardOneHit = false;
        } else if (e.auras[idx].value < WARD_ABSORB) {
          const [ward] = e.auras.splice(idx, 1);
          e.wardOneHit = false;
          ctx.emit({ type: 'aura', targetId: e.id, name: ward.name, gained: false });
        }
      }
    }

    // Counter-stun: a player's hard stun on a counterStun carrier is answered
    // with a tail hammer (both end up stunned), at most once per cooldown.
    const cs = tmpl.counterStun;
    if (cs && !e.dead && ctx.time >= (e.counterStunReadyAt ?? 0)) {
      const stun = e.auras.find(
        (a) => a.kind === 'stun' && a.sourceId !== undefined && a.sourceId !== e.id,
      );
      if (stun && stun.sourceId !== undefined) {
        const src = ctx.entities.get(stun.sourceId);
        if (src && !src.dead && src.kind === 'player') {
          e.counterStunReadyAt = ctx.time + cs.cooldown;
          ctx.applyAura(src, {
            id: 'brood_counter_stun',
            name: cs.name,
            kind: 'stun',
            remaining: cs.seconds,
            duration: cs.seconds,
            value: 0,
            sourceId: e.id,
            school: 'physical',
          });
          // 'windup' + ability: the renderer plays the authored Stun tail
          // slam via the visual's attackByAbility map.
          ctx.emit({
            type: 'spellfx',
            sourceId: e.id,
            targetId: src.id,
            school: 'physical',
            fx: 'windup',
            ability: 'brood_stun',
          });
          if (!tmpl.quietMechanics)
            ctx.emit({
              type: 'log',
              text: `${e.name} unleashes ${cs.name}!`,
              color: '#ff9933',
              entityId: e.id,
            });
        }
      }
    }
  }
}
