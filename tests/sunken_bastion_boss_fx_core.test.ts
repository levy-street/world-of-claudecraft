// The Sunken Bastion boss visuals' pure plan (render/sunken_bastion/
// bastion_boss_fx_core.ts): the pieces and lanes it draws must be the ones the
// sim resolves, so a player dodges the edge the sim tests.

import { describe, expect, it } from 'vitest';
import {
  beamReveal,
  buttressAt,
  buttressCrash,
  buttressPiece,
  CROWN_FLOOD_INNER,
  CROWN_FLOOD_OUTER,
  CROWN_PARAPET_INNER,
  CROWN_SILL_HEIGHT,
  CROWN_STAIR_MOUTH,
  chainPoints,
  crownFloodAlpha,
  crownFloodDepth,
  crownFloodKeep,
  HYMN_FLOOD_DEPTH,
  HYMN_FLOOD_LIFT,
  hookHeat,
  hymnFlood,
  oathLaneLength,
  pickVeilClaim,
  predictBeamYaw,
  revealGlow,
  standingButtressIds,
} from '../src/render/sunken_bastion/bastion_boss_fx_core';
import {
  BASTION_BUTTRESSES,
  BEACON_CROWN,
  BREACH_BASTION,
  FOGBEACON,
} from '../src/sim/content/sunken_bastion_layout';
import {
  BUTTRESS_TEMPLATES,
  FOG_SHADE_ID,
  oathLaneEnd,
  VAEL_ID,
  veilBeamYaw,
  veilSlots,
} from '../src/sim/encounters/sunken_bastion/ids';

describe('Sunken Bastion boss fx core', () => {
  it('draws each buttress state with its own kit piece and bursts only on a step toward broken', () => {
    expect(buttressPiece(BUTTRESS_TEMPLATES.intact)).toBe('Kit_Buttress');
    expect(buttressPiece(BUTTRESS_TEMPLATES.cracked)).toBe('Kit_ButtressCracked');
    expect(buttressPiece(BUTTRESS_TEMPLATES.broken)).toBe('Kit_ButtressBroken');
    expect(buttressPiece('dungeon_gate_closed')).toBeNull();
    expect(buttressCrash(BUTTRESS_TEMPLATES.intact, BUTTRESS_TEMPLATES.cracked)).toBe(true);
    expect(buttressCrash(BUTTRESS_TEMPLATES.intact, BUTTRESS_TEMPLATES.broken)).toBe(true);
    expect(buttressCrash(BUTTRESS_TEMPLATES.cracked, BUTTRESS_TEMPLATES.broken)).toBe(true);
    // A reset (broken back to intact) is no crash.
    expect(buttressCrash(BUTTRESS_TEMPLATES.broken, BUTTRESS_TEMPLATES.intact)).toBe(false);
  });

  it('finds each buttress by its object spot and turns it to the rim bearing', () => {
    for (const b of BASTION_BUTTRESSES) {
      expect(buttressAt(b.x + 0.3, b.z - 0.2)).toEqual({ id: b.id, yaw: b.yaw });
    }
    expect(buttressAt(BREACH_BASTION.x, BREACH_BASTION.z)).toBeNull();
  });

  it('counts only intact and cracked buttresses as standing', () => {
    const [nw, n, ne, e] = BASTION_BUTTRESSES;
    const ids = standingButtressIds([
      { lx: nw.x, lz: nw.z, templateId: BUTTRESS_TEMPLATES.intact },
      { lx: n.x, lz: n.z, templateId: BUTTRESS_TEMPLATES.cracked },
      { lx: ne.x, lz: ne.z, templateId: BUTTRESS_TEMPLATES.broken },
      { lx: e.x, lz: e.z, templateId: BUTTRESS_TEMPLATES.intact },
    ]);
    expect([...ids].sort()).toEqual(['e', 'n', 'nw']);
  });

  it('paints the charge lane the sim resolves: to the crash with the buttress up, to the rim with it down', () => {
    const north = BASTION_BUTTRESSES.find((b) => b.id === 'n');
    if (!north) throw new Error('no north buttress');
    const x = BREACH_BASTION.x;
    const z = BREACH_BASTION.z;
    const all = new Set(['nw', 'n', 'ne', 'e']);
    const up = oathLaneLength(x, z, 0, all);
    expect(up).toBeCloseTo(oathLaneEnd(x, z, 0, all).length, 6);
    expect(oathLaneEnd(x, z, 0, all).buttress).toBe('n');
    const down = oathLaneLength(x, z, 0, new Set(['nw', 'ne', 'e']));
    expect(down).toBeGreaterThan(up);
    expect(oathLaneEnd(x, z, 0, new Set(['nw', 'ne', 'e'])).buttress).toBeNull();
  });

  it('hangs the hook chain from the winch to the player, sagging between', () => {
    const out = new Float32Array(9 * 3);
    chainPoints(0, 4, 0, 10, 1, 0, 2, 9, out);
    expect([out[0], out[1], out[2]]).toEqual([0, 4, 0]);
    expect(out[8 * 3]).toBeCloseTo(10, 6);
    expect(out[8 * 3 + 1]).toBeCloseTo(1, 6);
    // The middle sits below the straight line by the sag.
    expect(out[4 * 3 + 1]).toBeCloseTo(2.5 - 2, 6);
    expect(hookHeat(8, 8)).toBe(0);
    expect(hookHeat(0, 8)).toBe(1);
    expect(hookHeat(4, 8)).toBeCloseTo(0.5, 6);
  });

  it('floods the crown from dry to full over the hymn, never falling', () => {
    let prev = -1;
    for (let rem = 18; rem >= 0; rem -= 0.5) {
      const f = hymnFlood(rem, 18);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
    expect(hymnFlood(18, 18)).toBe(0);
    expect(hymnFlood(0, 18)).toBeCloseTo(1, 6);
  });

  // The Hymn's flood used to rise 1.15 yd over the flags, past the parapet's
  // embrasure sills (1.08), on a disc that reached into the wall and ended in
  // a hard sheet of water over the stair top: it stood in every embrasure and
  // floated over the stair mouth. These pin the sheet inside the roof.
  it('keeps the flood under the embrasure sills and clear of the flags', () => {
    expect(HYMN_FLOOD_LIFT + HYMN_FLOOD_DEPTH).toBeLessThan(CROWN_SILL_HEIGHT - 0.2);
    // Never a skin on the flags: it starts clear of them and is shin-deep at full.
    expect(HYMN_FLOOD_LIFT).toBeGreaterThanOrEqual(0.05);
    expect(HYMN_FLOOD_DEPTH).toBeGreaterThan(0.5);
    expect(crownFloodAlpha(0)).toBe(0);
    expect(crownFloodDepth(0)).toBe(0);
    expect(crownFloodDepth(1)).toBeCloseTo(HYMN_FLOOD_DEPTH, 6);
    expect(crownFloodAlpha(1)).toBe(1);
    let prev = { depth: 0, alpha: 0 };
    for (let k = 0.05; k <= 1; k += 0.05) {
      const s = { depth: crownFloodDepth(k), alpha: crownFloodAlpha(k) };
      expect(s.depth).toBeGreaterThanOrEqual(prev.depth);
      expect(s.alpha).toBeGreaterThanOrEqual(prev.alpha);
      prev = s;
    }
  });

  it('fills the roof between the beacon foot and the parapet, tucked under the wall', () => {
    expect(CROWN_PARAPET_INNER).toBeCloseTo(BEACON_CROWN.r - 1, 6);
    // The rim hides under the wall body (a yard thick), never past its sea face.
    expect(CROWN_FLOOD_OUTER).toBeGreaterThan(CROWN_PARAPET_INNER);
    expect(CROWN_FLOOD_OUTER).toBeLessThan(CROWN_PARAPET_INNER + 0.6);
    // The hole hides under the Fogbeacon's foot.
    expect(CROWN_FLOOD_INNER).toBeLessThan(FOGBEACON.r);
    expect(CROWN_FLOOD_INNER).toBeGreaterThan(FOGBEACON.r - 1.5);
  });

  it('spills off the stair top instead of ending in a wall of water', () => {
    const m = CROWN_STAIR_MOUTH;
    // The crown stair comes up from the south-west.
    const deg = ((((m.yaw * 180) / Math.PI) % 360) + 360) % 360;
    expect(deg).toBeGreaterThan(195);
    expect(deg).toBeLessThan(225);
    expect(m.half).toBeGreaterThan(0.1);
    const at = (yaw: number, r: number) => crownFloodKeep(Math.sin(yaw) * r, Math.cos(yaw) * r);
    // Full depth over the roof and at the walled rim.
    expect(at(0, 15)).toBe(1);
    expect(at(0, CROWN_FLOOD_OUTER)).toBe(1);
    expect(at(m.yaw + Math.PI, CROWN_FLOOD_OUTER)).toBe(1);
    expect(at(m.yaw, 12)).toBe(1);
    // Down to the flags at the mouth's edge, shallowing toward it.
    expect(at(m.yaw, CROWN_FLOOD_OUTER)).toBe(0);
    const mid = at(m.yaw, CROWN_FLOOD_OUTER - 1.5);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    // And eases back to full at the mouth's flanks (no step in the surface).
    expect(at(m.yaw + m.half * 0.5, CROWN_FLOOD_OUTER)).toBeLessThan(0.05);
    expect(at(m.yaw + m.half + 0.2, CROWN_FLOOD_OUTER)).toBe(1);
  });

  it('predicts the beam the sim turns and reveals only the figure inside it', () => {
    const start = 1.1;
    for (const t of [0.25, 1, 2.5]) {
      expect(predictBeamYaw(veilBeamYaw(start, 0), t)).toBeCloseTo(veilBeamYaw(start, t), 6);
    }
    const slots = veilSlots(0);
    const b = FOGBEACON;
    const yawTo = (s: { x: number; z: number }) => Math.atan2(s.x - b.x, s.z - b.z);
    const lit = slots[0];
    const dark = slots[2];
    const yaw = yawTo(lit);
    expect(beamReveal(VAEL_ID, yaw, lit.x, lit.z)).toBe('real');
    expect(beamReveal(FOG_SHADE_ID, yaw, lit.x, lit.z)).toBe('shade');
    expect(beamReveal(VAEL_ID, yaw, dark.x, dark.z)).toBeNull();
    expect(beamReveal('drowned_watchman', yaw, lit.x, lit.z)).toBeNull();
  });
});

describe('the Fog Veil tell', () => {
  it('latches the reveal full while the tell is worn, then fades out in well under a second', () => {
    expect(revealGlow(0, true, 1 / 60)).toBe(1);
    let k = 1;
    for (let t = 0; t < 0.25; t += 1 / 60) k = revealGlow(k, false, 1 / 60);
    // A breath after the sim's tell lifts, the glow still burns...
    expect(k).toBeGreaterThan(0.5);
    // ... and is gone within a second, so the real one is lit only while the
    // beam has him (plus the sim's 1.5 s linger), never most of a sweep.
    for (let t = 0; t < 0.75; t += 1 / 60) k = revealGlow(k, false, 1 / 60);
    expect(k).toBe(0);
  });

  it('follows the veiled Vael and his own claim’s lamp when several claims exist', () => {
    const vaels = [
      { id: 10, slot: 0, veiled: false, dist: 5 },
      { id: 20, slot: 1, veiled: true, dist: 400 },
    ];
    const lamps = [
      { id: 11, slot: 0 },
      { id: 21, slot: 1 },
    ];
    expect(pickVeilClaim(vaels, lamps)).toEqual({ vaelId: 20, lampId: 21 });
    // No veil up: the nearest Vael, and his lamp, whatever the roster order.
    expect(
      pickVeilClaim(
        [
          { id: 20, slot: 1, dist: 400 },
          { id: 10, slot: 0, dist: 5 },
        ],
        lamps,
      ),
    ).toEqual({ vaelId: 10, lampId: 11 });
    expect(pickVeilClaim([], lamps).vaelId).toBe(-1);
  });
});
