// The Masterless Strength's Hammer quarter (design doc 7.5) and the boss's own
// Weight of the Anvil, the fight's only group soak. (The quarter's star, Wake
// the Stone, is final_pillars.ts.)
//
//   Tremor Crack         every 13 s (first 6 s into the quarter) the floor
//                        cracks under three hashed players (four on Heroic);
//                        2.5 s later each crack erupts (4 yd): step out.
//   Weight of the Anvil  the boss's OWN since the rework of 2026-11-18: all
//                        fight (each tier's anvilEvery: 50 s on every tier
//                        since Jose's playtest of 2026-11-20; first 30 s
//                        in), wherever it stands (its clock is the coordinator's),
//                        a 6 s bar on a hashed player: a 6 yd circle that FOLLOWS
//                        them (the anvil mark on them, their personal arrow)
//                        until 1 s before it falls, then plants. When it lands
//                        its whole blow is split between everyone under it
//                        (half as much again each with fewer than three); with
//                        nobody under it the whole raid takes a heavy blow.
//                        The fight's ONLY group damage share.
//   Stone Shell          Heroic, every 20 s (first 8 s in): stone closes on
//                        three hashed players, absorbing their next 600
//                        healing.
//   The turning Anvil    Mythic: the Anvil's mark turns round the boss through
//                        its bar (11 yd out, 25 degrees a second) instead of
//                        following anyone: the soakers walk with it.
//
// Deterministic: every pick is hashed (pickPlayers); the only rng draws are
// the damage rolls, in player order.

import { HEART_QUARTERS } from '../../content/smith_heart_quarters';
import { DT, type Entity } from '../../types';
import { clearCastIf } from '../sunken_bastion/claim';
import {
  anvilShare,
  FINAL_AURAS,
  FINAL_CASTS,
  FINAL_CUES,
  FINAL_NAMES,
  FINAL_OBJECTS,
  finalTimed,
  FINAL_TUNING as T,
} from './final_ids';
import {
  at,
  beginBar,
  cueAt,
  cueOn,
  dropAura,
  dropFightObject,
  type FinalScope,
  type FPoint,
  facingTo,
  hit,
  livePlayers,
  local,
  moveFightObject,
  onFloor,
  pickPlayers,
  punishMult,
  putMarker,
  roll,
  spawnFightObject,
} from './final_scope';

// ---- Tremor Cracks -------------------------------------------------------------------------

/** The floor cracks under hashed players. Returns who. */
export function crackTremors(s: FinalScope): Entity[] {
  const st = s.st;
  st.kit.tremor = T.tremorEvery;
  const under = pickPlayers(s, s.rules.tremors, st.casts + 901);
  st.casts++;
  for (const p of under) {
    const q = at(s, p);
    const obj = spawnFightObject(
      s.ctx,
      s.inst,
      finalTimed(FINAL_OBJECTS.tremorPrefix, T.tremorWarn),
      FINAL_NAMES.tremor,
      q.x,
      q.z,
      T.tremorR,
    );
    st.tremors.push({ objectId: obj.id, x: q.x, z: q.z, left: T.tremorWarn });
  }
  return under;
}

/** One tick of the cracks: each erupts at its time. */
export function stepTremors(s: FinalScope): void {
  const st = s.st;
  if (st.tremors.length === 0) return;
  const keep: typeof st.tremors = [];
  for (const c of st.tremors) {
    c.left -= DT;
    if (c.left > 1e-9) {
      keep.push(c);
      continue;
    }
    dropFightObject(s.ctx, s.inst, c.objectId);
    cueAt(s, FINAL_CUES.tremor, c.x, c.z, T.tremorR, 'physical');
    for (const p of livePlayers(s)) {
      const q = at(s, p);
      if (Math.hypot(q.x - c.x, q.z - c.z) > T.tremorR) continue;
      hit(s, p, roll(s, T.tremorMin, T.tremorMax), FINAL_NAMES.tremor, 'physical');
    }
  }
  st.tremors = keep;
}

// ---- Weight of the Anvil -------------------------------------------------------------------

/** Where the Anvil's mark stands for a bearing round the boss (Mythic). */
function orbitSpot(s: FinalScope, angle: number): FPoint {
  const b = local(s.ctx, s.inst, s.boss);
  // With a quarter fallen it turns tight round the boss, over the ring only.
  const r = s.st.phase.fallenMask !== 0 ? HEART_QUARTERS.ringR - 5 : T.anvilOrbitR;
  return onFloor({ x: b.x + Math.sin(angle) * r, z: b.z + Math.cos(angle) * r }, T.anvilR);
}

/** Begin Weight of the Anvil on a hashed player's spot (or `forced`).
 *  Exported for the dev trigger. */
export function startAnvil(s: FinalScope, forced?: FPoint, forcedOn?: Entity): boolean {
  const st = s.st;
  st.anvilClock = s.rules.anvilEvery;
  let aim: FPoint | null = forced ?? null;
  let victim: Entity | null = forcedOn ?? null;
  if (!aim) {
    [victim] = pickPlayers(s, 1, st.casts + 1001);
    if (!victim) return false;
    aim = at(s, victim);
  }
  // Mythic's mark turns round the boss: it follows nobody.
  if (s.rules.rotatingAnvil) victim = null;
  const b = local(s.ctx, s.inst, s.boss);
  const angle = facingTo(b, aim);
  const spot = s.rules.rotatingAnvil ? orbitSpot(s, angle) : onFloor(aim, T.anvilR * 0.5);
  const obj = spawnFightObject(
    s.ctx,
    s.inst,
    finalTimed(FINAL_OBJECTS.anvilPrefix, T.anvilCast),
    FINAL_NAMES.anvil,
    spot.x,
    spot.z,
    T.anvilR,
  );
  st.anvil = {
    objectId: obj.id,
    x: spot.x,
    z: spot.z,
    angle,
    left: T.anvilCast,
    targetId: victim?.id ?? 0,
  };
  if (victim)
    putMarker(victim, FINAL_AURAS.anvilMark, FINAL_NAMES.anvil, T.anvilCast, s.boss.id, {
      school: 'physical',
    });
  beginBar(s, FINAL_CASTS.anvil, T.anvilCast, angle);
  return true;
}

/** One tick of the mark: it follows its player until it locks (Mythic: it
 *  turns round the boss instead). */
export function stepAnvil(s: FinalScope): void {
  const a = s.st.anvil;
  if (!a) return;
  // Its bar is what lands it: a mark whose bar is gone (taken by another bar)
  // can never fall, so it goes rather than strand on the floor (Jose's
  // playtest of 2026-11-20).
  if (s.st.bar?.castId !== FINAL_CASTS.anvil) {
    clearAnvil(s);
    return;
  }
  a.left = Math.max(0, a.left - DT);
  let spot: FPoint;
  if (s.rules.rotatingAnvil) {
    a.angle += ((T.anvilOrbitDegPerSec * Math.PI) / 180) * DT;
    spot = orbitSpot(s, a.angle);
  } else {
    if (a.targetId === 0 || a.left <= T.anvilLock + 1e-9) return;
    const p = s.ctx.entities.get(a.targetId);
    // Its player fell or left: the circle plants where it is.
    if (!p || p.dead || !livePlayers(s).includes(p)) {
      a.targetId = 0;
      return;
    }
    spot = onFloor(at(s, p), T.anvilR * 0.5);
  }
  a.x = spot.x;
  a.z = spot.z;
  const obj = s.ctx.entities.get(a.objectId);
  if (obj) moveFightObject(s.ctx, s.inst, obj, spot.x, spot.z);
}

/** Its player's mark goes (the fall, a wipe, a stride). */
function dropAnvilMark(s: Pick<FinalScope, 'ctx'>, targetId: number): void {
  const p = targetId ? s.ctx.entities.get(targetId) : undefined;
  if (p) dropAura(p, FINAL_AURAS.anvilMark);
}

/** The Anvil's circle and its player's mark gone, unfallen (a wipe, a stride,
 *  a dropped bar). */
export function clearAnvil(s: Pick<FinalScope, 'ctx' | 'inst' | 'st'>): void {
  const a = s.st.anvil;
  if (!a) return;
  dropFightObject(s.ctx, s.inst, a.objectId);
  dropAnvilMark(s, a.targetId);
  s.st.anvil = null;
}

/** The Anvil falls: split evenly between everyone under it, or the whole
 *  raid when nobody stands there. Returns who shared it. */
export function landAnvil(s: FinalScope): Entity[] {
  const st = s.st;
  const a = st.anvil;
  if (!a) return [];
  st.anvil = null;
  dropFightObject(s.ctx, s.inst, a.objectId);
  dropAnvilMark(s, a.targetId);
  cueAt(s, FINAL_CUES.anvil, a.x, a.z, T.anvilR, 'physical');
  const under = livePlayers(s).filter((p) => {
    const q = at(s, p);
    return Math.hypot(q.x - a.x, q.z - a.z) <= T.anvilR;
  });
  if (under.length === 0) {
    for (const p of livePlayers(s))
      hit(
        s,
        p,
        roll(s, s.rules.anvilMissMin, s.rules.anvilMissMax, punishMult(s)),
        FINAL_NAMES.anvil,
        'physical',
      );
    return [];
  }
  for (const p of under) {
    const share = anvilShare(under.length, s.rules.anvilTotal);
    hit(s, p, roll(s, share * 0.95, share * 1.05, punishMult(s)), FINAL_NAMES.anvil, 'physical');
  }
  return under;
}

// ---- Stone Shell ---------------------------------------------------------------------------

/** Heroic: stone closes on three hashed players. Returns who. */
export function stoneShell(s: FinalScope): Entity[] {
  const st = s.st;
  st.kit.shell = T.shellEvery;
  const marked = pickPlayers(s, T.shellMarks, st.casts + 1101);
  st.casts++;
  for (const p of marked) {
    s.ctx.applyAura(p, {
      id: FINAL_AURAS.shell,
      name: FINAL_NAMES.shell,
      kind: 'heal_absorb',
      remaining: T.shellSeconds,
      duration: T.shellSeconds,
      value: Math.round(T.shellAbsorb * s.rules.damageMult),
      sourceId: s.boss.id,
      school: 'physical',
      encounterOwned: true,
    });
    cueOn(s, p, FINAL_CUES.shell, 'physical');
  }
  return marked;
}

/** Every Hammer footprint gone (the fight's end). */
export function clearHammer(
  s: Pick<FinalScope, 'ctx' | 'inst' | 'st' | 'boss'>,
  players: readonly Entity[],
): void {
  const st = s.st;
  for (const c of st.tremors) dropFightObject(s.ctx, s.inst, c.objectId);
  st.tremors = [];
  clearAnvil(s);
  clearCastIf(s.boss, FINAL_CASTS.anvil);
  for (const p of players) {
    dropAura(p, FINAL_AURAS.anvilMark);
    dropAura(p, FINAL_AURAS.shell);
  }
}
