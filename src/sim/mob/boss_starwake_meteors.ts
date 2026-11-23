// Star Debris: the meteor shower Balgath's Wake of the Fallen Star calls down when the fen
// erupts (mob/boss_starwake.ts).
//
// Every meteor is Ignivar's Falling Cinders, reused rather than re-authored: the placement
// and spacing (ignivar_meteors.ts `ignivarMeteorTargetOrder` + `ignivarMeteorPattern`,
// Normal range and minimum separation), the collision footprint (`pointInIgnivarMeteor`),
// the telegraph and reveal delay, and the two events (`meteorFall` with a persistent
// warning id, then `meteorImpact` on that id), so the renderer draws the raid's own red
// circle, falling meteor and landing unchanged.
//
// What is his own is the rhythm. Ignivar drops one volley every 17 s; the crater erupting
// opens the sky instead: from the eruption, for `meteors.seconds`, a WAVE of
// `perWaveMin..perWaveMax` meteors comes down every `waveMin..waveMax` seconds, each wave
// laid by Ignivar's pattern round anchors spread over the whole fight:
//   - on even waves, one player in `range` of him and inside the shower's arena
//     (round-robin in Ignivar's target order, the tank last), at where they stand NOW,
//     so standing still is what gets you hit;
//   - then points along the eruption's cracks and round the star (inside the arena);
//   - the rest are Ignivar's own untargeted ring round the arena origin.
// A wave's meteors never overlap (Ignivar's minimum separation), so a player takes at most
// one per wave, and a player who keeps moving outruns every anchored circle.
//
// The arena origin is where he stood at the eruption, so the shower stays on the fight
// even if he sets off mid-way. The hit is a flat roll (starwake.meteors) instead of the
// raid's share of max health, and it splashes muster soldiers and wildlife in the fight
// round him exactly as the fissures do. The command camp (MobTemplate.keepOut) stays
// clear: a player inside it is never an anchor, and a meteor whose circle would reach into
// it is dropped from its wave.
//
// Rng: placement spends none (hash2 on the shower's cast key, as Ignivar does); each
// landing draws one per player struck, in `ctx.players` order.

import { MOBS } from '../data';
import {
  IGNIVAR_METEOR_MAX_RANGE,
  IGNIVAR_METEOR_RADIUS,
  IGNIVAR_METEOR_REVEAL_DELAY_SECONDS,
  IGNIVAR_METEOR_TELEGRAPH_SECONDS,
  type IgnivarMeteorPoint,
  type IgnivarMeteorTarget,
  ignivarMeteorPattern,
  ignivarMeteorTargetOrder,
  ignivarMeteorWarningId,
  pointInIgnivarMeteor,
} from '../ignivar_meteors';
import { hash2 } from '../rng';
import type { SimContext } from '../sim_context';
import type { Aura, Entity, MobTemplate, StarwakeShowerState } from '../types';
import { CAST_COMPLETE_EPS, DT, dist2d } from '../types';
import { splashNearbyMobs } from './boss_collateral';
import { levelScaledMechanicDamage } from './mechanic_level_scale';

type StarwakeDef = NonNullable<MobTemplate['starwake']>;

/**
 * The landing's recording: the Meteor impact already in the manifest (the one the HUD
 * warms on every meteorFall). Ignivar's own landings carry none; here one per landing
 * wave, on its first meteor, so a wave reads as one heavy crash rather than three stacked.
 */
export const STARWAKE_METEOR_SFX = 'meteor';

/** Seconds from a wave being called to its meteors landing: Ignivar's own telegraph. */
export const STARWAKE_METEOR_TELEGRAPH_SECONDS = IGNIVAR_METEOR_TELEGRAPH_SECONDS;

/** Anchors along the cracks and round the star stay this far inside the arena rim. */
const ANCHOR_RIM_MARGIN = 2;
/** A star anchor lands within this many yards of the star's centre. */
const STAR_SCATTER = 8;
const FALLING_STRIDE = 4;
const LINE_STRIDE = 5;

/** The shower's cast key, built the way Ignivar builds his (tick and boss id). */
export function starwakeMeteorCastKey(tickCount: number, bossId: number): number {
  return (Math.imul(tickCount, 0x9e3779b1) ^ bossId) >>> 0;
}

/** One wave's own pattern key, derived from the shower's (no rng). */
export function starwakeWaveKey(showerKey: number, wave: number): number {
  return (Math.imul(showerKey ^ Math.imul(wave + 1, 0x85ebca6b), 0x9e3779b1) ^ wave) >>> 0;
}

/** Meteors in wave `wave`: perWaveMin..perWaveMax, from the shower key. */
export function starwakeWaveCount(def: StarwakeDef['meteors'], key: number, wave: number): number {
  const span = def.perWaveMax - def.perWaveMin + 1;
  return def.perWaveMin + Math.min(span - 1, Math.floor(hash2(key, wave, 0x5d7a11) * span));
}

/** Seconds from wave `wave` to the next: waveMin..waveMax, from the shower key. */
export function starwakeWaveGap(def: StarwakeDef['meteors'], key: number, wave: number): number {
  return def.waveMin + hash2(key, wave, 0x9a9e11) * (def.waveMax - def.waveMin);
}

/** Whether a shower is calling waves or has meteors still falling. */
export function starwakeShowerActive(mob: Entity): boolean {
  return mob.starwakeShower !== undefined;
}

/** The meteors falling right now, decoded (position, seconds left, warning index). */
export function starwakeMeteorsOf(
  mob: Entity,
): (IgnivarMeteorPoint & { remaining: number; serial: number })[] {
  const flat = mob.starwakeShower?.falling ?? [];
  const out: (IgnivarMeteorPoint & { remaining: number; serial: number })[] = [];
  for (let i = 0; i + FALLING_STRIDE - 1 < flat.length; i += FALLING_STRIDE) {
    out.push({ x: flat[i], z: flat[i + 1], remaining: flat[i + 2], serial: flat[i + 3] });
  }
  return out;
}

function livingPlayers(ctx: SimContext): Entity[] {
  const out: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (p && !p.dead) out.push(p);
  }
  return out;
}

function insideKeepOut(mob: Entity, x: number, z: number, margin: number): boolean {
  const circles = MOBS[mob.templateId]?.keepOut ?? [];
  return circles.some((c) => Math.hypot(x - c.x, z - c.z) < c.radius + margin);
}

/**
 * A point `u` (0..1) of the way along the part of a fissure that lies inside the circle
 * (`origin`, `reach`), or null when none of it does. Solves |o + d*dir - origin| <= reach.
 */
export function pointAlongInside(
  line: { originX: number; originZ: number; dirX: number; dirZ: number; length: number },
  origin: IgnivarMeteorPoint,
  reach: number,
  u: number,
): IgnivarMeteorPoint | null {
  const ox = line.originX - origin.x;
  const oz = line.originZ - origin.z;
  const b = ox * line.dirX + oz * line.dirZ;
  const c = ox * ox + oz * oz - reach * reach;
  const disc = b * b - c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const from = Math.max(0, -b - root);
  const to = Math.min(line.length, -b + root);
  if (to <= from) return null;
  const d = from + (to - from) * u;
  return { x: line.originX + line.dirX * d, z: line.originZ + line.dirZ * d };
}

/**
 * Lay one wave: its anchors (a player on even waves, then the cracks and the star by
 * turns), then Ignivar's Normal pattern round them, cut to the wave's count and kept out
 * of the command camp. Pure: no rng, no clock.
 */
export function starwakeWavePoints(
  def: StarwakeDef,
  shower: Pick<StarwakeShowerState, 'key' | 'originX' | 'originZ' | 'lines'>,
  wave: number,
  players: readonly IgnivarMeteorTarget[],
  tankId: number | null,
  keepOut: (x: number, z: number, margin: number) => boolean = () => false,
): IgnivarMeteorPoint[] {
  const m = def.meteors;
  // Ignivar's Normal pattern lays IGNIVAR_METEOR_COUNT_NORMAL; a wave is a cut of it, so
  // content never asks for more (tests/balgath_starwake.test.ts pins perWaveMax).
  const key = starwakeWaveKey(shower.key, wave);
  const count = starwakeWaveCount(m, shower.key, wave);
  const origin = { x: shower.originX, z: shower.originZ };
  const reach = IGNIVAR_METEOR_MAX_RANGE - ANCHOR_RIM_MARGIN;
  const anchors: IgnivarMeteorPoint[] = [];
  // Only players inside the arena: Ignivar's pattern clamps an anchor to its rim, and a
  // meteor dragged onto the rim is not on anyone.
  const eligible = players.filter(
    (p) =>
      !keepOut(p.x, p.z, 0) &&
      Math.hypot(p.x - origin.x, p.z - origin.z) <= IGNIVAR_METEOR_MAX_RANGE,
  );
  if (wave % 2 === 0 && eligible.length > 0) {
    const order = ignivarMeteorTargetOrder(shower.key, eligible, tankId, eligible.length);
    anchors.push(order[(wave / 2) % order.length]);
  }
  const lineCount = Math.floor(shower.lines.length / LINE_STRIDE);
  for (let slot = anchors.length; slot < count; slot++) {
    const kind = (wave + slot) % 3;
    if (kind === 0 && lineCount > 0) {
      const li = Math.min(lineCount - 1, Math.floor(hash2(key, slot, 0x11e5ac) * lineCount));
      const at = li * LINE_STRIDE;
      const p = pointAlongInside(
        {
          originX: shower.lines[at],
          originZ: shower.lines[at + 1],
          dirX: shower.lines[at + 2],
          dirZ: shower.lines[at + 3],
          length: shower.lines[at + 4],
        },
        origin,
        reach,
        hash2(key, slot, 0x7a1d3e),
      );
      if (p) anchors.push(p);
    } else if (kind === 1) {
      const ang = hash2(key, slot, 0x57a55e) * Math.PI * 2;
      const r = Math.sqrt(hash2(key, slot, 0x2c47e2)) * STAR_SCATTER;
      const p = { x: def.star.x + Math.sin(ang) * r, z: def.star.z + Math.cos(ang) * r };
      if (Math.hypot(p.x - origin.x, p.z - origin.z) <= reach) anchors.push(p);
    }
    // Anything else (and a crack or star point outside the arena) is left to Ignivar's
    // own untargeted ring round the origin.
  }
  const targets = anchors.map((p, i) => ({ id: i, x: p.x, z: p.z }));
  return ignivarMeteorPattern(key, origin, 'normal', targets)
    .slice(0, count)
    .filter((p) => !keepOut(p.x, p.z, IGNIVAR_METEOR_RADIUS));
}

/**
 * Open the sky at the eruption: record the shower (its key, the origin where he stands,
 * the fissures that just burst) and call its first wave this same tick. Draws no rng.
 */
export function startStarwakeShower(
  ctx: SimContext,
  mob: Entity,
  def: StarwakeDef,
  fissures: readonly {
    originX: number;
    originZ: number;
    dirX: number;
    dirZ: number;
    length: number;
  }[],
): void {
  const lines: number[] = [];
  for (const f of fissures) lines.push(f.originX, f.originZ, f.dirX, f.dirZ, f.length);
  mob.starwakeShower = {
    key: starwakeMeteorCastKey(ctx.tickCount, mob.id),
    originX: mob.pos.x,
    originZ: mob.pos.z,
    elapsed: 0,
    nextWave: 0,
    wave: 0,
    serial: 0,
    lines,
    falling: [],
  };
  callDueWaves(ctx, mob, def, mob.starwakeShower);
}

function callDueWaves(
  ctx: SimContext,
  mob: Entity,
  def: StarwakeDef,
  shower: StarwakeShowerState,
): void {
  const m = def.meteors;
  while (shower.nextWave <= CAST_COMPLETE_EPS && shower.elapsed < m.seconds - CAST_COMPLETE_EPS) {
    const players = livingPlayers(ctx)
      .filter((p) => dist2d(p.pos, mob.pos) <= m.range)
      .sort((a, b) => a.id - b.id)
      .map((p) => ({ id: p.id, x: p.pos.x, z: p.pos.z }));
    const points = starwakeWavePoints(
      def,
      shower,
      shower.wave,
      players,
      mob.aggroTargetId,
      (x, z, r) => insideKeepOut(mob, x, z, r),
    );
    for (const impact of points) {
      const serial = shower.serial++;
      shower.falling.push(impact.x, impact.z, STARWAKE_METEOR_TELEGRAPH_SECONDS, serial);
      ctx.emit({
        type: 'spellfxAt',
        x: impact.x,
        z: impact.z,
        school: 'fire',
        fx: 'meteorFall',
        ability: m.name,
        radius: IGNIVAR_METEOR_RADIUS,
        duration: STARWAKE_METEOR_TELEGRAPH_SECONDS,
        warningLead: IGNIVAR_METEOR_REVEAL_DELAY_SECONDS,
        persistentId: ignivarMeteorWarningId(mob.id, shower.key, serial),
        sourceId: mob.id,
      });
    }
    shower.nextWave += starwakeWaveGap(m, shower.key, shower.wave);
    shower.wave++;
  }
}

/**
 * Advance a shower one tick: land every meteor whose fall is over (one hit per player
 * inside any of them, the fight's bystanders splashed like the fissures splash them, one
 * `meteorImpact` each), then call any wave now due. Ends the shower once the waves are
 * spent and the last meteor is down.
 */
export function tickStarwakeShower(
  ctx: SimContext,
  mob: Entity,
  def: StarwakeDef,
  collateralReach: number,
): void {
  const shower = mob.starwakeShower;
  if (!shower) return;
  const m = def.meteors;
  shower.elapsed += DT;
  shower.nextWave -= DT;
  const landing: (IgnivarMeteorPoint & { serial: number })[] = [];
  const kept: number[] = [];
  const flat = shower.falling;
  for (let i = 0; i + FALLING_STRIDE - 1 < flat.length; i += FALLING_STRIDE) {
    const remaining = Math.max(0, flat[i + 2] - DT);
    if (remaining <= CAST_COMPLETE_EPS) {
      landing.push({ x: flat[i], z: flat[i + 1], serial: flat[i + 3] });
    } else kept.push(flat[i], flat[i + 1], remaining, flat[i + 3]);
  }
  shower.falling = kept;
  if (landing.length > 0) land(ctx, mob, def, shower.key, landing, collateralReach);
  callDueWaves(ctx, mob, def, shower);
  if (shower.falling.length === 0 && shower.elapsed >= m.seconds - CAST_COMPLETE_EPS) {
    mob.starwakeShower = undefined;
  }
}

function land(
  ctx: SimContext,
  mob: Entity,
  def: StarwakeDef,
  key: number,
  meteors: readonly (IgnivarMeteorPoint & { serial: number })[],
  collateralReach: number,
): void {
  const school = def.school as Aura['school'];
  const m = def.meteors;
  const mult = mob.mechanicDamageMult ?? 1;
  for (const p of livingPlayers(ctx)) {
    if (!meteors.some((meteor) => pointInIgnivarMeteor(meteor, p.pos))) continue;
    const dmg = Math.round(ctx.rng.range(m.min, m.max) * mult);
    ctx.dealDamage(
      mob,
      p,
      levelScaledMechanicDamage(mob, p, dmg),
      false,
      school,
      m.name,
      'hit',
      true,
    );
  }
  for (const meteor of meteors) {
    splashNearbyMobs(
      ctx,
      mob,
      meteor,
      IGNIVAR_METEOR_RADIUS,
      m.min,
      m.max,
      school,
      m.name,
      (e) => pointInIgnivarMeteor(meteor, e.pos) && dist2d(mob.pos, e.pos) <= collateralReach,
    );
  }
  meteors.forEach((impact, i) => {
    ctx.emit({
      type: 'spellfxAt',
      x: impact.x,
      z: impact.z,
      school: 'fire',
      fx: 'meteorImpact',
      ability: m.name,
      persistentId: ignivarMeteorWarningId(mob.id, key, impact.serial),
      sourceId: mob.id,
      ...(i === 0 ? { sfxKey: STARWAKE_METEOR_SFX } : {}),
    });
  });
}

/** Drop a shower (the pull reset, a respawn). */
export function resetStarwakeShower(mob: Entity): void {
  mob.starwakeShower = undefined;
}
