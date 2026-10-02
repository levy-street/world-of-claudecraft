// Fire and Fly bowling: a body flying fast and low (a corpse included) knocks the
// grounded monsters it passes through. Contacts are solved on the closed-form
// segments, earliest first across every pair of a pass, so a knock that slows the
// flyer or launches the struck body is seen by every later contact of the same
// window (a struck body flies on and can knock in turn). Each knock replans both
// bodies from the contact. A tick runs two passes, on the segments as they stood
// and then on the pairs its transitions renewed; the order holds within a pass
// only (a second-pass contact can predate a first-pass knock), a deterministic
// approximation. Pure: no rng, no clock; tuning rides the plan.

import { TURRET_PHYSICS, TURRET_WEAPON } from '../content/turret_defense';
import {
  type FlySegment,
  flyContact,
  planFlight,
  positionAt,
  type ThrowProbe,
  velocityAt,
} from './thrown_body';
import type {
  TurretDefenseState,
  TurretEvent,
  TurretMonster,
  TurretMonsterState,
} from './turret_defense';

/** Grounded, living states a flyer can knock over (corpses on the ground never move). */
const KNOCKABLE: ReadonlySet<TurretMonsterState> = new Set(['march', 'windup', 'down', 'rise']);

/**
 * A backstop only: a knock turns a knockable body into a flyer and nothing lands
 * inside a pass, so a pass already strikes each knockable body at most once.
 */
const MAX_KNOCKS_PER_PASS = 64;

interface Contact {
  flyer: TurretMonster;
  seg: FlySegment;
  struck: TurretMonster;
  tick: number;
}

/**
 * Resolves every knock between the ticks `from` and `to`, earliest first. Only
 * pairs where either segment started after `bornAfter` take part (the pass that
 * follows a tick's transitions checks only the pairs those transitions renewed:
 * a bounce, a knock, a body come to rest or back on its feet).
 */
export function resolveTurretBowling(
  state: TurretDefenseState,
  from: number,
  to: number,
  bornAfter: number,
  probe: ThrowProbe,
  events: TurretEvent[],
): void {
  if (!state.plan.bowling.enabled) return;
  for (let n = 0; n < MAX_KNOCKS_PER_PASS; n++) {
    const contact = earliestContact(state, from, to, bornAfter, probe);
    if (!contact) return;
    knock(state, contact, probe, events);
  }
}

function earliestContact(
  state: TurretDefenseState,
  from: number,
  to: number,
  bornAfter: number,
  probe: ThrowProbe,
): Contact | null {
  const { kinds, bowling } = state.plan;
  let best: Contact | null = null;
  for (const flyer of state.monsters) {
    const seg = flyer.seg;
    if (flyer.state !== 'fly' || seg.kind !== 'fly') continue;
    if (!(Math.hypot(seg.vx, seg.vz) > bowling.minSpeed)) continue;
    const fresh = seg.start > bornAfter;
    const flyerKind = kinds[flyer.kind];
    for (const struck of state.monsters) {
      if (struck === flyer || struck.hp <= 0 || !KNOCKABLE.has(struck.state)) continue;
      if (!fresh && !(struck.seg.start > bornAfter)) continue;
      if (flyer.knocked.includes(struck.id)) continue;
      const kind = kinds[struck.kind];
      const top = struck.state === 'down' ? kind.height * bowling.lyingHeight : kind.height;
      const tick = flyContact(
        seg,
        struck.seg,
        (flyerKind.radius + kind.radius) * bowling.reachScale,
        top,
        from,
        to,
        probe,
        TURRET_PHYSICS.substeps,
      );
      if (tick !== null && (!best || tick < best.tick)) best = { flyer, seg, struck, tick };
    }
  }
  return best;
}

function knock(
  state: TurretDefenseState,
  { flyer, seg, struck, tick }: Contact,
  probe: ThrowProbe,
  events: TurretEvent[],
): void {
  const { kinds, waves, bowling } = state.plan;
  const flyerKind = kinds[flyer.kind];
  const kind = kinds[struck.kind];
  const from = positionAt(seg, tick, probe);
  const at = positionAt(struck.seg, tick, probe);
  const fv = velocityAt(seg, tick);
  const speed = Math.hypot(fv.x, fv.z);
  const dir = contactNormal(at.x - from.x, at.z - from.z, fv.x / speed, fv.z / speed);
  const across = Math.min(
    bowling.transfer * Math.sqrt(flyerKind.mass / kind.mass) * speed,
    TURRET_WEAPON.maxLaunchSpeed,
  );
  const v = {
    x: dir.x * across,
    y: Math.min(bowling.pop / Math.sqrt(kind.mass), TURRET_WEAPON.maxLaunchLift),
    z: dir.z * across,
  };
  const wave = waves[Math.min(state.wave, waves.length - 1)];
  const damage = Math.max(1, Math.round((wave ? wave.coreDamage : 0) * bowling.damageShare));
  struck.hp = Math.max(0, struck.hp - damage);
  struck.state = 'fly';
  struck.seg = planFlight(tick, at.x, at.y, at.z, v, kind.radius, probe, TURRET_PHYSICS);
  struck.airSince = tick;
  struck.throwX = at.x;
  struck.throwZ = at.z;
  struck.throwOpen = true;
  struck.facing = Math.atan2(-dir.x, -dir.z);
  struck.knocked = [flyer.id];
  const keep = bowling.flyerKeep;
  flyer.seg = planFlight(
    tick,
    from.x,
    from.y,
    from.z,
    { x: fv.x * keep, y: fv.y, z: fv.z * keep },
    flyerKind.radius,
    probe,
    TURRET_PHYSICS,
  );
  flyer.knocked.push(struck.id);
  state.stats.bowled++;
  state.rev++;
  events.push({
    type: 'bowled',
    flyerId: flyer.id,
    struckId: struck.id,
    x: at.x,
    y: at.y,
    z: at.z,
    speed,
    damage,
  });
  events.push({
    type: 'launched',
    id: struck.id,
    x: at.x,
    y: at.y,
    z: at.z,
    vx: v.x,
    vy: v.y,
    vz: v.z,
  });
  if (struck.hp <= 0) {
    state.stats.kills++;
    events.push({ type: 'killed', id: struck.id, x: at.x, y: at.y, z: at.z });
  }
}

/**
 * The struck body leaves along the line from the flyer to it, so a head-on knock
 * sends it straight on and an off-center one scatters it sideways; along the
 * flyer's own heading when the two centers coincide.
 */
function contactNormal(dx: number, dz: number, ux: number, uz: number): { x: number; z: number } {
  const len = Math.hypot(dx, dz);
  return len > 1e-9 ? { x: dx / len, z: dz / len } : { x: ux, z: uz };
}
