// The Sunken Bastion boss visuals' pure plan (render/sunken_bastion/
// bastion_boss_fx_core.ts): the pieces and lanes it draws must be the ones the
// sim resolves, so a player dodges the edge the sim tests.

import { describe, expect, it } from 'vitest';
import {
  beamReveal,
  buttressAt,
  buttressCrash,
  buttressPiece,
  chainPoints,
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
  it('latches the reveal full the moment the beam catches a figure, then fades slowly', () => {
    expect(revealGlow(0, true, 1 / 60)).toBe(1);
    let k = 1;
    for (let t = 0; t < 1; t += 1 / 60) k = revealGlow(k, false, 1 / 60);
    // A second after the beam passed, the tell still burns at about half.
    expect(k).toBeGreaterThan(0.4);
    for (let t = 0; t < 2; t += 1 / 60) k = revealGlow(k, false, 1 / 60);
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
