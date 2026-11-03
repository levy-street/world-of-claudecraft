// The Hammer Council's Mountain's Rush (encounters/smith_heart/council_rush.ts),
// a part of CouncilFx: through the Guardian's bar the lane it will charge down,
// from its body to the marked player at the sim's own width (the mark's value2,
// else COUNCIL_TUNING.rushHalfWidth), filling with the bar through the shared
// floor telegraph in the lethal colour on EVERY tier (the mark's ring round the
// player is the host's, COUNCIL_MARK_SPECS); the dash's stop (rushImpact: a shock
// ring, rock and dust); and the mythic Quarry Collapse's blows (a rock falling
// out of the dark onto each player, its chunks and dust). Built in the
// constructor under the host's root (one gated attach), one pooled lane, no
// light, no per-frame allocation; the Guardian is found at the host's scan pace.

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
import type { CouncilFxHost } from './council_pillars_fx';
import type { CouncilTelegraphKind } from './painted_telegraph_core';
import type { PaintedFan } from './painted_telegraphs';

const _lane = { yaw: 0, length: 0, half: 0 };
const _paint = { fill: 0, clock: 0, range: 0 };
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

function auraById(e: Entity, id: string): Aura | undefined {
  const auras = e.auras;
  for (let i = 0; i < auras.length; i++) if (auras[i].id === id) return auras[i];
  return undefined;
}

export class CouncilRushFx {
  private readonly lane: TelegraphLane;
  private readonly lanePaint: PaintedFan<CouncilTelegraphKind>;
  private guardianId = -1;
  private scanGuardian = -1;
  /** Where the lane was last draped (NaN: not yet), both ends. */
  private drapedGX = Number.NaN;
  private drapedGZ = Number.NaN;
  private drapedTX = Number.NaN;
  private drapedTZ = Number.NaN;

  constructor(private readonly h: CouncilFxHost) {
    this.lane = h.kit.lane(13);
    this.lane.group.visible = false;
    this.lanePaint = h.paints.dress(this.lane, 'rush');
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

  update(): void {
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

  private hideLane(): void {
    this.lane.group.visible = false;
    this.drapedGX = Number.NaN;
    this.drapedGZ = Number.NaN;
    this.drapedTX = Number.NaN;
    this.drapedTZ = Number.NaN;
  }

  /** `heart_mountains_rush_impact`: the dash stops here (radius = the lane's
   *  half width): a shock ring, thrown rock, a dust wall. */
  impactAt(x: number, z: number, radius: number): void {
    const y = this.h.groundY(x, z);
    this.hideLane();
    this.h.particles.shockRing(x, z, C.rush, radius + 3, 0.35);
    this.h.particles.shockRing(x, z, 0x5a3820, radius + 6, 0.9);
    const n = Math.round(24 * this.h.density * (this.h.reducedMotion() ? 0.5 : 1));
    for (let i = 0; i < n; i++) {
      const a = this.h.rand() * Math.PI * 2;
      const sp = 5 + this.h.rand() * 9;
      this.h.debris.throw(
        x + Math.sin(a),
        y + 1,
        z + Math.cos(a),
        Math.sin(a) * sp,
        4 + this.h.rand() * 7,
        Math.cos(a) * sp,
        0.3 + this.h.rand() * 0.7,
      );
    }
    this.h.particles.puff(x, y + 0.8, z, 18, {
      speed: 5,
      up: 1,
      life: 1.4,
      size: [1.5, 4.5],
      color: C.dust,
      alpha: 0.5,
      drag: 1.6,
      radius: radius,
    });
    this.h.particles.puff(x, y + 1.2, z, 8, {
      speed: 3,
      life: 0.3,
      size: [1.6, 3.4],
      color: [1, 0.55, 0.35],
      alpha: 0.75,
      pool: 'glow',
    });
    this.h.shakeNear(x, z, 0.6, 40);
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
