// The Hammer Council's Mountain's Rush (encounters/smith_heart/council_rush.ts),
// a part of CouncilFx:
//  - through the Guardian's bar, the lane it will charge down, from its body
//    to the marked player at the sim's own width (the mark's value2, else
//    COUNCIL_TUNING.rushHalfWidth), filling with the bar through the shared
//    floor telegraph in the lethal colour on EVERY tier (the mark's ring round
//    the player is the host's, COUNCIL_MARK_SPECS);
//  - the wind-up (COUNCIL_CUES.rushWindup, at the Guardian's feet with the
//    fixed line): the lane stays lit at full along the line the sim fixed, the
//    Guardian slams the ground (its body's own attack, through the renderer's
//    gesture seam), a star of cracks splits open under it, dust boils off its
//    feet and grit hops, a low rumble in the camera;
//  - the run: dust and grit thrown up behind its body, the floor torn open
//    down the line behind it (council_rush_scar.ts), a thud in the camera with
//    every stride near the player;
//  - the stop (COUNCIL_CUES.rushImpact): a white flash, shock rings, rock and a
//    dust wall, a star of cracks, a hard shake near the player; on a pillar
//    (the cursed one's break or a sheltering one's fall the same instant) the
//    stone bursts away down the line;
//  - the mythic Quarry Collapse's blows (a rock falling out of the dark onto
//    each player, its chunks and dust).
// The lanes, the scar and the stars draw on every tier; dust, grit, rock and
// the shakes thin on the low tier and under reduced motion. Built in the
// constructor under the host's root (one gated attach), one pooled lane, no
// light, no per-frame allocation; the Guardian is found at the host's scan
// pace, the run's line comes with the wind-up's cue.

import { COUNCIL_TUNING as T } from '../../sim/encounters/smith_heart/council_ids';
import type { Aura, Entity } from '../../sim/types';
import { fxAnchor, needsRedrape } from '../attached_fx_anchor';
import type { TelegraphLane } from '../floor_telegraph';
import {
  COUNCIL_FX_COLORS as C,
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  markFill,
  rushLane,
} from './council_fx_core';
import {
  RUSH_TRACE_SECONDS,
  type RushPhaseName,
  rushPhase,
  rushScar,
} from './council_mechanic_look_core';
import type { CouncilFxHost } from './council_pillars_fx';
import { RUSH_STAR, RushScar } from './council_rush_scar';
import type { CouncilTelegraphKind } from './painted_telegraph_core';
import type { PaintedFan } from './painted_telegraphs';

const _lane = { yaw: 0, length: 0, half: 0 };
const _paint = { fill: 0, clock: 0, range: 0 };
const _phase = { phase: 'over' as RushPhaseName, k: 0 };
const _scar = { reveal: 0, heat: 0, fade: 0 };
/** A blow of the collapse: the stone dust shaken down with it. */
const COLLAPSE_DUST = {
  speed: 1.2,
  up: -2,
  life: 1.2,
  size: [1, 2.6] as const,
  color: C.dustDark,
  alpha: 0.5,
  drag: 1.4,
};
/** The wind-up's dust boiling off the Guardian's feet. */
const PLANT_DUST = {
  speed: 2.6,
  up: 0.8,
  life: 1.3,
  size: [1.6, 4.2] as const,
  color: C.dust,
  alpha: 0.55,
  drag: 1.8,
  radius: 3,
};
/** The run's dust, thrown up and back behind the body. */
const TRAIL_DIR: [number, number, number] = [0, 0.5, 0];
const TRAIL_DUST = {
  speed: 3.4,
  up: 1.2,
  life: 1.5,
  size: [1.6, 4.2] as const,
  color: C.dust,
  alpha: 0.46,
  drag: 1.5,
  dir: TRAIL_DIR,
  spread: 0.7,
  radius: 1.6,
};
/** The stop's white flash. */
const STOP_FLASH = {
  speed: 2,
  life: 0.3,
  size: [3.5, 7] as const,
  color: [1, 0.86, 0.6] as const,
  alpha: 0.9,
  pool: 'glow' as const,
};
/** The stop's dust wall. */
const STOP_DUST = {
  speed: 6,
  up: 1,
  life: 1.8,
  size: [2, 5.5] as const,
  color: C.dust,
  alpha: 0.55,
  drag: 1.5,
  radius: 2,
};
/** A struck pillar's stone dust, flung on down the line. */
const PILLAR_DIR: [number, number, number] = [0, 0.4, 0];
const PILLAR_DUST = {
  speed: 8,
  up: 1.5,
  life: 1.7,
  size: [1.6, 4.4] as const,
  color: C.dust,
  alpha: 0.6,
  drag: 1.3,
  dir: PILLAR_DIR,
  spread: 0.55,
  radius: 1.5,
};
/** Seconds between two strides' thuds through the run. */
const STRIDE = 0.26;

/** A Rush seen from its wind-up's cue to its trace's fade. */
interface RushRun {
  guardianId: number;
  fromX: number;
  fromZ: number;
  dirX: number;
  dirZ: number;
  /** The run's yards and seconds (the sim's stop: from + dir * length). */
  length: number;
  seconds: number;
  /** The host clock at the cue; at the stop (NaN: still going). */
  t0: number;
  stoppedAt: number;
  stopX: number;
  stopZ: number;
  nextStride: number;
  rumble: number;
}

function auraById(e: Entity, id: string): Aura | undefined {
  const auras = e.auras;
  for (let i = 0; i < auras.length; i++) if (auras[i].id === id) return auras[i];
  return undefined;
}

export class CouncilRushFx {
  private readonly lane: TelegraphLane;
  private readonly lanePaint: PaintedFan<CouncilTelegraphKind>;
  private readonly scar: RushScar;
  private guardianId = -1;
  private scanGuardian = -1;
  /** Where the lane was last draped (NaN: not yet), both ends. */
  private drapedGX = Number.NaN;
  private drapedGZ = Number.NaN;
  private drapedTX = Number.NaN;
  private drapedTZ = Number.NaN;
  /** The Rush from its wind-up to its trace's fade, or null. */
  private run: RushRun | null = null;
  /** The locked lane is draped for the run in flight. */
  private lockedDrape = false;

  constructor(
    private readonly h: CouncilFxHost,
    private readonly gesture?: (entityId: number, gesture: string) => void,
  ) {
    this.lane = h.kit.lane(13);
    this.lane.group.visible = false;
    this.lanePaint = h.paints.dress(this.lane, 'rush');
    this.scar = new RushScar(h);
  }

  beginScan(): void {
    this.scanGuardian = -1;
  }

  /** The living Guardian the host's scan found. */
  seeGuardian(e: Entity): void {
    this.scanGuardian = e.id;
  }

  endScan(): void {
    this.guardianId = this.scanGuardian;
  }

  /** `heart_mountains_rush_windup`: the line is fixed (from the Guardian's
   *  feet along dir, `seconds` of run at `speed`); it plants and slams. */
  windup(
    guardianId: number | undefined,
    x: number,
    z: number,
    dirX: number,
    dirZ: number,
    speed: number,
    seconds: number,
  ): void {
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-6) return;
    const id = guardianId ?? this.guardianId;
    const length = Math.max(0, speed * seconds);
    const now = this.h.now();
    const dx = dirX / len;
    const dz = dirZ / len;
    this.run = {
      guardianId: id,
      fromX: x,
      fromZ: z,
      dirX: dx,
      dirZ: dz,
      length,
      seconds: Math.max(0, seconds),
      t0: now,
      stoppedAt: Number.NaN,
      stopX: x + dx * length,
      stopZ: z + dz * length,
      nextStride: now + T.rushWindup,
      rumble: now,
    };
    this.lockedDrape = false;
    this.scar.lay(x, z, dx, dz, Math.max(1, length));
    if (id >= 0) this.gesture?.(id, 'heart_mountains_rush_windup');
    const y = this.h.groundY(x, z);
    this.h.particles.shockRing(x, z, C.rush, RUSH_STAR.plant, 0.5);
    this.h.particles.puff(x, y + 0.4, z, 16, PLANT_DUST);
    this.hopGrit(x, y, z, 10, 2.4);
    this.h.shakeNear(x, z, 0.2, 30);
  }

  update(dt = 0): void {
    if (this.run && this.updateRun(this.run, dt)) return;
    const g = this.guardianId >= 0 ? this.h.entity(this.guardianId) : undefined;
    const t =
      g && !g.dead && g.castingAbility === COUNCIL_CASTS.rush && g.castTargetId !== null
        ? this.h.entity(g.castTargetId)
        : undefined;
    if (!g || !t || t.dead) {
      this.hideLane();
      return;
    }
    const ga = fxAnchor(g);
    const gx = ga.x;
    const gz = ga.z;
    const ta = fxAnchor(t);
    const half = auraById(t, COUNCIL_AURAS.rushMark)?.value2 ?? 0;
    const lane = rushLane(gx, gz, ta.x, ta.z, half, _lane);
    if (!lane) {
      this.hideLane();
      return;
    }
    // Re-drape over the floor once either end has moved far enough.
    if (
      needsRedrape(gx, gz, this.drapedGX, this.drapedGZ) ||
      needsRedrape(ta.x, ta.z, this.drapedTX, this.drapedTZ)
    ) {
      this.h.kit.drapeLane(
        this.lane,
        this.h.groundY,
        gx,
        this.h.groundY(gx, gz),
        gz,
        lane.yaw,
        lane.length,
        lane.half,
        { color: C.rush, accent: C.ochre },
      );
      this.drapedGX = gx;
      this.drapedGZ = gz;
      this.drapedTX = ta.x;
      this.drapedTZ = ta.z;
    }
    const fill = markFill(g.castRemaining, g.castTotal);
    _paint.fill = fill;
    _paint.clock = this.h.now();
    _paint.range = lane.length;
    this.h.kit.paintLane(this.lane, _paint);
    this.h.paints.live(this.lanePaint, 0.6 * fill * fill);
    this.lane.group.visible = true;
  }

  /** The wind-up, the run and the trace. True while the locked lane owns
   *  the lane (the bar's own lane waits). */
  private updateRun(r: RushRun, dt: number): boolean {
    const now = this.h.now();
    const since = now - r.t0;
    // A run the stop's cue never closed (the Guardian fell, a wipe, an
    // evade): it ends a little after its planned stop, with no burst.
    if (Number.isNaN(r.stoppedAt) && since > T.rushWindup + r.seconds + 1.5) r.stoppedAt = now;
    const ended = Number.isNaN(r.stoppedAt) ? null : now - r.stoppedAt;
    if (ended !== null && ended > RUSH_TRACE_SECONDS) {
      this.scar.hide();
      this.run = null;
      return false;
    }
    const ph = rushPhase(since, r.seconds, _phase);
    // The trace: the scar torn behind the body, then cooling and fading from
    // the stop; the stars at the plant and at the stop.
    if (ended === null) rushScar(since, Math.max(r.seconds, 1e-3), _scar);
    else {
      rushScar(T.rushWindup + 1e-3 + ended, 1e-3, _scar);
      _scar.reveal = 1;
    }
    this.scar.paint(_scar.reveal, _scar.heat, _scar.fade);
    const plantGrow = ph.phase === 'windup' ? 0.25 + 0.75 * ph.k * ph.k : 1;
    const plantHeat = ended === null ? 1 : _scar.heat;
    this.scar.star(0, r.fromX, r.fromZ, RUSH_STAR.plant, plantGrow, plantHeat, _scar.fade);
    if (ended !== null)
      this.scar.star(
        1,
        r.stopX,
        r.stopZ,
        RUSH_STAR.stop,
        Math.min(1, ended / 0.18),
        _scar.heat,
        _scar.fade,
      );
    else this.scar.star(1, r.stopX, r.stopZ, RUSH_STAR.stop, 0, 0, 0);
    if (ended !== null) return false;
    // The locked lane, full and lethal, along the line the sim fixed.
    if (!this.lockedDrape) {
      this.h.kit.drapeLane(
        this.lane,
        this.h.groundY,
        r.fromX,
        this.h.groundY(r.fromX, r.fromZ),
        r.fromZ,
        Math.atan2(r.dirX, r.dirZ),
        Math.max(1, r.length),
        T.rushHalfWidth,
        { color: C.rush, accent: C.ochre },
      );
      this.lockedDrape = true;
      this.drapedGX = Number.NaN;
    }
    _paint.fill = 1;
    _paint.clock = now;
    _paint.range = Math.max(1, r.length);
    this.h.kit.paintLane(this.lane, _paint);
    this.h.paints.live(this.lanePaint, 0.75 + 0.25 * Math.sin(now * 14));
    this.lane.group.visible = true;
    if (ph.phase === 'windup') {
      // Dust boiling off its feet, grit hopping, a growing rumble.
      const y = this.h.groundY(r.fromX, r.fromZ);
      if (this.h.rand() < dt * 16) this.h.particles.puff(r.fromX, y + 0.3, r.fromZ, 3, PLANT_DUST);
      if (this.h.rand() < dt * 8) this.hopGrit(r.fromX, y, r.fromZ, 2, 2);
      // The brace: a beat of lethal light out of its feet, quicker and wider
      // as the run comes, with the rumble.
      if (now >= r.rumble) {
        r.rumble = now + 0.26 - 0.1 * ph.k;
        this.h.shakeNear(r.fromX, r.fromZ, 0.05 + 0.1 * ph.k, 26);
        this.h.particles.shockRing(r.fromX, r.fromZ, C.rush, 2.5 + 2.5 * ph.k, 0.3);
      }
      return true;
    }
    // The run: dust and grit thrown up behind the body, a thud per stride.
    const g = r.guardianId >= 0 ? this.h.entity(r.guardianId) : undefined;
    const at = g && !g.dead ? fxAnchor(g) : null;
    const k = ph.phase === 'run' ? ph.k : 1;
    const bx = at ? at.x : r.fromX + r.dirX * r.length * k;
    const bz = at ? at.z : r.fromZ + r.dirZ * r.length * k;
    const by = this.h.groundY(bx, bz);
    TRAIL_DIR[0] = -r.dirX * 0.6;
    TRAIL_DIR[2] = -r.dirZ * 0.6;
    const n = dt * 30;
    const whole = Math.floor(n) + (this.h.rand() < n - Math.floor(n) ? 1 : 0);
    if (whole > 0)
      this.h.particles.puff(bx - r.dirX * 1.5, by + 0.5, bz - r.dirZ * 1.5, whole, TRAIL_DUST);
    if (this.h.rand() < dt * 18 * this.h.density) {
      const side = this.h.rand() < 0.5 ? -1 : 1;
      const out = 2 + this.h.rand() * 4;
      this.h.debris.throw(
        bx + r.dirZ * side * 1.2,
        by + 0.6,
        bz - r.dirX * side * 1.2,
        r.dirZ * side * out - r.dirX * 2,
        3 + this.h.rand() * 5,
        -r.dirX * side * out - r.dirZ * 2,
        0.2 + this.h.rand() * 0.35,
      );
    }
    if (now >= r.nextStride) {
      r.nextStride = now + STRIDE;
      this.h.shakeNear(bx, bz, 0.22, 18);
      this.h.particles.shockRing(bx, bz, 0x5a3820, 3, 0.4);
    }
    return true;
  }

  /** Grit hopping off the ground round (x, z). */
  private hopGrit(x: number, y: number, z: number, n: number, reach: number): void {
    const k = Math.round(n * this.h.density * (this.h.reducedMotion() ? 0.5 : 1));
    for (let i = 0; i < k; i++) {
      const a = this.h.rand() * Math.PI * 2;
      const d = this.h.rand() * reach;
      this.h.debris.throw(
        x + Math.sin(a) * d,
        y + 0.2,
        z + Math.cos(a) * d,
        Math.sin(a) * 0.8,
        2.5 + this.h.rand() * 2.5,
        Math.cos(a) * 0.8,
        0.12 + this.h.rand() * 0.18,
      );
    }
  }

  private hideLane(): void {
    this.lane.group.visible = false;
    this.drapedGX = Number.NaN;
    this.drapedGZ = Number.NaN;
    this.drapedTX = Number.NaN;
    this.drapedTZ = Number.NaN;
    this.lockedDrape = false;
  }

  /** `heart_mountains_rush_impact`: the dash stops here (radius = the lane's
   *  half width): a white flash, shock rings, thrown rock, a dust wall, a
   *  star of cracks, a hard shake near the player. */
  impactAt(x: number, z: number, radius: number): void {
    const y = this.h.groundY(x, z);
    this.hideLane();
    const r = this.run;
    if (r && Number.isNaN(r.stoppedAt)) {
      r.stoppedAt = this.h.now();
      r.stopX = x;
      r.stopZ = z;
    }
    this.h.particles.puff(x, y + 1.6, z, 3, STOP_FLASH);
    this.h.particles.shockRing(x, z, 0xfff0d0, radius + 2, 0.25);
    this.h.particles.shockRing(x, z, C.rush, radius + 4, 0.4);
    this.h.particles.shockRing(x, z, 0x5a3820, radius + 8, 1);
    const n = Math.round(30 * this.h.density * (this.h.reducedMotion() ? 0.5 : 1));
    for (let i = 0; i < n; i++) {
      const a = this.h.rand() * Math.PI * 2;
      const sp = 5 + this.h.rand() * 10;
      this.h.debris.throw(
        x + Math.sin(a),
        y + 1,
        z + Math.cos(a),
        Math.sin(a) * sp,
        4 + this.h.rand() * 8,
        Math.cos(a) * sp,
        0.3 + this.h.rand() * 0.8,
      );
    }
    this.h.particles.puff(x, y + 0.8, z, 22, STOP_DUST);
    this.h.particles.puff(x, y + 1.2, z, 8, {
      speed: 3,
      life: 0.35,
      size: [1.6, 3.6],
      color: [1, 0.6, 0.35],
      alpha: 0.8,
      pool: 'glow',
    });
    this.h.shakeNear(x, z, 0.9, 45);
  }

  /** A pillar broke where the Rush just stopped (the cursed one's break, a
   *  sheltering one's fall): its stone bursts on down the line, a second
   *  flash in the cursed pillar's colour or the stone's. */
  pillarStruck(x: number, z: number, cursed: boolean): void {
    const r = this.run;
    if (!r || Number.isNaN(r.stoppedAt)) return;
    if (this.h.now() - r.stoppedAt > 0.35) return;
    if (Math.hypot(x - r.stopX, z - r.stopZ) > 8) return;
    const y = this.h.groundY(x, z);
    PILLAR_DIR[0] = r.dirX;
    PILLAR_DIR[2] = r.dirZ;
    this.h.particles.puff(x, y + 2, z, 20, PILLAR_DUST);
    const n = Math.round(26 * this.h.density * (this.h.reducedMotion() ? 0.5 : 1));
    for (let i = 0; i < n; i++) {
      const spread = (this.h.rand() - 0.5) * 1.4;
      const sp = 9 + this.h.rand() * 12;
      const vx = r.dirX + r.dirZ * spread;
      const vz = r.dirZ - r.dirX * spread;
      this.h.debris.throw(
        x,
        y + 1 + this.h.rand() * 5,
        z,
        vx * sp,
        3 + this.h.rand() * 7,
        vz * sp,
        0.45 + this.h.rand() * 0.9,
      );
    }
    this.h.particles.shockRing(x, z, cursed ? 0xd8327e : 0xfff0d0, 9, 0.6);
    this.h.particles.puff(x, y + 2.5, z, 4, {
      speed: 3,
      life: 0.4,
      size: [3, 6.5],
      color: cursed ? [1, 0.45, 0.75] : [1, 0.85, 0.55],
      alpha: 0.85,
      pool: 'glow',
    });
    this.h.shakeNear(x, z, 0.5, 45);
  }

  /** Mythic `heart_quarry_collapse`: a blow of the Quarry's ceiling on a
   *  player: chunks of rock falling out of the dark, dust shaken down, a
   *  small ring where they land. */
  collapseAt(x: number, z: number): void {
    const y = this.h.groundY(x, z);
    const n = Math.round(10 * this.h.density * (this.h.reducedMotion() ? 0.5 : 1)) + 2;
    for (let i = 0; i < n; i++) {
      const a = this.h.rand() * Math.PI * 2;
      const r = this.h.rand() * 1.6;
      this.h.debris.throw(
        x + Math.sin(a) * r,
        y + 7 + this.h.rand() * 4,
        z + Math.cos(a) * r,
        Math.sin(a) * 1.2,
        -6 - this.h.rand() * 6,
        Math.cos(a) * 1.2,
        0.25 + this.h.rand() * 0.5,
      );
    }
    this.h.particles.puff(x, y + 6, z, 6, COLLAPSE_DUST);
    this.h.particles.shockRing(x, z, C.danger, 2.4, 0.35);
    this.h.shakeNear(x, z, 0.18, 12);
  }
}
