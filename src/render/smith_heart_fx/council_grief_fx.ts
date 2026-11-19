// The Hammer Council's Grief of the Stone on its survivor (sim:
// encounters/smith_heart/council_grief.ts, COUNCIL_AURAS.enraged), a part of
// CouncilFx. The fallen one's strength streams across the Quarry (the
// inheritance's river of beads, CouncilFx's own) and as it lands the survivor
// burns with it for the rest of the pull:
//  - the moment it lands (COUNCIL_CUES.grief): a white-gold flare on its chest,
//    embers flung up and out, two shock rings racing over the floor, a thud
//    near it;
//  - while it wears Enraged: a halo of molten light breathing round its chest
//    (one glow puff a beat, never thinned: the body's rage reads on every tier,
//    as the aura on its frame does), embers streaming up off it (thinned on the
//    low tier) and a slow throb ring at its feet.
// Reduced motion: the halo holds still, the swell stays small, no thud (the
// host's shake honours it), the bursts shrink (the pool's own rule).
// A tell, never a telegraph: the actionable read is the Enraged aura on the
// boss's frame. Everything rides the host's pooled particles and shock rings:
// no material, geometry or light of its own, nothing allocated a frame.

import { type CouncilRole, councilRoleOf } from '../../sim/encounters/smith_heart/council_ids';
import type { Entity } from '../../sim/types';
import { fxAnchor } from '../attached_fx_anchor';
import { COUNCIL_AURAS } from './council_fx_core';
import {
  GRIEF_COLORS,
  GRIEF_EMBERS,
  GRIEF_HALO_AT,
  GRIEF_HALO_BEAT,
  GRIEF_ONSET_RINGS,
  GRIEF_THROB_EVERY,
  GRIEF_THROB_REACH,
  type GriefHaloLook,
  griefBodyHeight,
  griefHaloLook,
} from './council_grief_core';
import type { CouncilFxHost } from './council_pillars_fx';

interface GriefSlot {
  /** The enraged body (-1: none). */
  id: number;
  seen: boolean;
  /** The host clock of its onset (-Infinity: never seen land). */
  onset: number;
  /** Accumulators: the halo's beat, the embers, the throb ring. */
  halo: number;
  ember: number;
  throb: number;
}

const ROLES: readonly CouncilRole[] = ['guardian', 'singer'];

export class CouncilGriefFx {
  private readonly slots: Record<CouncilRole, GriefSlot> = {
    guardian: { id: -1, seen: false, onset: -Infinity, halo: 0, ember: 0, throb: 0 },
    singer: { id: -1, seen: false, onset: -Infinity, halo: 0, ember: 0, throb: 0 },
  };
  private readonly look: GriefHaloLook = { size: 0, grow: 0, alpha: 0 };

  constructor(private readonly host: CouncilFxHost) {}

  /** The host's scan: which member wears Enraged now. */
  beginScan(): void {
    for (const r of ROLES) this.slots[r].seen = false;
  }

  see(e: Entity, role: CouncilRole): void {
    if (e.dead || !e.auras.some((a) => a.id === COUNCIL_AURAS.enraged)) return;
    const s = this.slots[role];
    if (s.id !== e.id) {
      s.id = e.id;
      s.halo = 0;
      s.ember = 0;
      s.throb = 0;
    }
    s.seen = true;
  }

  endScan(): void {
    for (const r of ROLES) {
      const s = this.slots[r];
      if (!s.seen) s.id = -1;
    }
  }

  /** The grief lands on `id` (its cue): the flare, the rings, the thud. */
  onset(id: number): void {
    const e = this.host.entity(id);
    const role = e ? councilRoleOf(e.templateId) : null;
    if (!e || role === null) return;
    const s = this.slots[role];
    s.id = id;
    s.onset = this.host.now();
    s.throb = 0;
    const h = griefBodyHeight(role);
    const at = fxAnchor(e);
    const floor = this.host.groundY(at.x, at.z);
    const y = floor + h * GRIEF_HALO_AT;
    const p = this.host.particles;
    p.puff(at.x, y, at.z, 36, {
      speed: 6,
      up: 1.5,
      life: 1,
      size: [h * 0.25, h * 0.6],
      color: GRIEF_COLORS.flare,
      alpha: 0.85,
      pool: 'glow',
    });
    p.puff(at.x, y, at.z, 40, {
      speed: 7,
      up: 7,
      gravity: 6,
      life: 1.8,
      size: [0.7, 0.2],
      color: GRIEF_COLORS.ember,
      alpha: 0.95,
      pool: 'glow',
      floor: floor - 0.4,
    });
    p.shockRing(at.x, at.z, GRIEF_COLORS.ringHot, GRIEF_ONSET_RINGS.hot, 0.7);
    p.shockRing(at.x, at.z, GRIEF_COLORS.ring, GRIEF_ONSET_RINGS.wide, 1.3, {
      wake: 0.6,
      crest: 0.18,
      strength: 0.85,
    });
    this.host.shakeNear(at.x, at.z, 0.35, 45);
  }

  update(dt: number): void {
    const now = this.host.now();
    const p = this.host.particles;
    for (const r of ROLES) {
      const s = this.slots[r];
      if (s.id < 0) continue;
      const e = this.host.entity(s.id);
      if (!e || e.dead) continue;
      const h = griefBodyHeight(r);
      const at = fxAnchor(e);
      const floor = this.host.groundY(at.x, at.z);
      const y = floor + h * GRIEF_HALO_AT;
      const look = griefHaloLook(now, now - s.onset, h, this.host.reducedMotion(), this.look);
      // The halo: one puff a beat, whatever the density.
      s.halo += dt;
      while (s.halo >= GRIEF_HALO_BEAT) {
        s.halo -= GRIEF_HALO_BEAT;
        p.puff(at.x, y, at.z, 1, {
          speed: 0.5,
          up: 0.4,
          life: 0.9,
          size: [look.size, look.grow],
          color: GRIEF_COLORS.halo,
          alpha: look.alpha,
          pool: 'glow',
          radius: h * 0.1,
        });
      }
      // The embers off it, thinned by the tier.
      s.ember += dt * GRIEF_EMBERS * this.host.density;
      while (s.ember >= 1) {
        s.ember -= 1;
        p.puff(at.x, y - h * 0.25, at.z, 1, {
          speed: 1.5,
          up: 4,
          life: 1.6,
          size: [0.7, 0.2],
          color: GRIEF_COLORS.ember,
          alpha: 0.95,
          pool: 'glow',
          radius: h * 0.25,
        });
      }
      // A throb of rage at its feet.
      s.throb += dt;
      if (s.throb >= GRIEF_THROB_EVERY) {
        s.throb -= GRIEF_THROB_EVERY;
        p.shockRing(at.x, at.z, GRIEF_COLORS.ring, h * GRIEF_THROB_REACH, 1.1, {
          wake: 0.45,
          crest: 0.3,
          strength: 0.9,
        });
      }
    }
  }
}
