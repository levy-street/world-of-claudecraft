import { describe, expect, it } from 'vitest';
import {
  newTavernAmbienceMix,
  TAVERN_AMBIENCE_BLEND,
  TAVERN_AMBIENCE_CLEAR_HZ,
  TAVERN_AMBIENCE_DOOR_GAIN,
  TAVERN_AMBIENCE_DOOR_HZ,
  TAVERN_AMBIENCE_INSIDE_GAIN,
  TAVERN_AMBIENCE_RADIUS,
  TAVERN_AMBIENCE_SILENT,
  TAVERN_AMBIENCE_WALL_GAIN,
  TAVERN_AMBIENCE_WALL_HZ,
  TAVERN_AMBIENCE_WALL_RADIUS,
  tavernAmbienceMix,
} from '../src/game/tavern_ambience_core';
import {
  TAVERN_FLOOR_Y,
  TAVERN_HALL,
  TAVERN_TOWER,
  TAVERN_WING,
  tavernToWorld,
} from '../src/sim/content/mirefen_tavern';

// The Mirefen tavern's ambience bed (src/game/tavern_ambience_core.ts): its level and its
// lowpass from where the listener stands. Clear and full inside, muffled outside, loudest
// before the open door, fading out with distance, and never a step across the doorway.

/** The mix for a listener at local (lx, lz), `up` yards over the ground floor. */
function at(lx: number, lz: number, up = 4) {
  const w = tavernToWorld(lx, lz);
  return { ...tavernAmbienceMix(w.x, TAVERN_FLOOR_Y + up, w.z, newTavernAmbienceMix()) };
}

describe('tavern ambience core', () => {
  it('pins its levels and tones', () => {
    expect(TAVERN_AMBIENCE_INSIDE_GAIN).toBe(0.34);
    expect(TAVERN_AMBIENCE_DOOR_GAIN).toBe(0.12);
    expect(TAVERN_AMBIENCE_WALL_GAIN).toBe(0.045);
    expect(TAVERN_AMBIENCE_RADIUS).toBe(30);
    expect(TAVERN_AMBIENCE_WALL_RADIUS).toBe(16);
    expect(TAVERN_AMBIENCE_CLEAR_HZ).toBe(7200);
    expect(TAVERN_AMBIENCE_DOOR_HZ).toBe(1400);
    expect(TAVERN_AMBIENCE_WALL_HZ).toBe(650);
    expect(TAVERN_AMBIENCE_BLEND).toBe(2.5);
    // inside is louder than the door, the door louder than a wall, the tones in the same order
    expect(TAVERN_AMBIENCE_INSIDE_GAIN).toBeGreaterThan(TAVERN_AMBIENCE_DOOR_GAIN * 2);
    expect(TAVERN_AMBIENCE_DOOR_GAIN).toBeGreaterThan(TAVERN_AMBIENCE_WALL_GAIN * 2);
    expect(TAVERN_AMBIENCE_CLEAR_HZ).toBeGreaterThan(TAVERN_AMBIENCE_DOOR_HZ * 4);
    expect(TAVERN_AMBIENCE_DOOR_HZ).toBeGreaterThan(TAVERN_AMBIENCE_WALL_HZ);
  });

  it('plays full and clear anywhere in the rooms away from the door', () => {
    for (const [lx, lz] of [
      [0, 0], // the hearth
      [-12, 1], // the long table
      [9, -6], // the bar
      [-12, -11], // the stage
      [14, 12], // the front right corner, by the wall
      [TAVERN_TOWER.x, TAVERN_TOWER.z], // the nook
    ]) {
      const m = at(lx, lz);
      expect(m.gain, `${lx}, ${lz}`).toBeCloseTo(TAVERN_AMBIENCE_INSIDE_GAIN, 6);
      expect(m.cutoffHz, `${lx}, ${lz}`).toBeCloseTo(TAVERN_AMBIENCE_CLEAR_HZ, 3);
    }
  });

  it('is muffled and quieter on the porch than inside, and loudest outside before the door', () => {
    const inside = at(0, 6);
    const porch = at(0, 15.5);
    const beside = at(-TAVERN_HALL.x1 - 3, 0);
    const behind = at(8, TAVERN_WING.z0 - 4);
    expect(porch.gain).toBeCloseTo(TAVERN_AMBIENCE_DOOR_GAIN, 6);
    expect(porch.cutoffHz).toBeCloseTo(TAVERN_AMBIENCE_DOOR_HZ, 3);
    expect(inside.gain).toBeGreaterThan(porch.gain * 2);
    expect(inside.cutoffHz).toBeGreaterThan(porch.cutoffHz * 4);
    // through a wall it is quieter and darker than through the open door
    for (const m of [beside, behind]) {
      expect(m.gain).toBeLessThan(porch.gain);
      expect(m.gain).toBeGreaterThan(0);
      expect(m.cutoffHz).toBeLessThan(porch.cutoffHz);
      expect(m.cutoffHz).toBeGreaterThanOrEqual(TAVERN_AMBIENCE_WALL_HZ - 1e-6);
    }
  });

  it('fades in monotonically walking up the road to the door, silent far away', () => {
    let last = -1;
    for (let lz = TAVERN_HALL.z1 + 40; lz >= TAVERN_HALL.z1 + 0.5; lz -= 0.25) {
      const m = at(0, lz, 2.6);
      expect(m.gain, `${lz}`).toBeGreaterThanOrEqual(last - 1e-12);
      last = m.gain;
    }
    expect(at(0, TAVERN_HALL.z1 + TAVERN_AMBIENCE_RADIUS + 2, 2.6).gain).toBe(0);
    expect(at(0, TAVERN_HALL.z1 + TAVERN_AMBIENCE_RADIUS + 2).gain).toBeLessThan(
      TAVERN_AMBIENCE_SILENT,
    );
    // off to the side, far along the road, and far behind: silent
    expect(at(60, 20).gain).toBe(0);
    expect(at(0, -80).gain).toBe(0);
  });

  it('never steps across the doorway: in and out along the door, level and tone glide', () => {
    let prev = at(0, TAVERN_HALL.z1 + 6);
    let rise = 0;
    for (let lz = TAVERN_HALL.z1 + 6; lz >= TAVERN_HALL.z1 - 8; lz -= 0.02) {
      const m = at(0, lz);
      // a 2 cm step never moves the gain by more than a sliver, nor the tone by more than 2.5%
      expect(Math.abs(m.gain - prev.gain), `${lz}`).toBeLessThan(0.004);
      expect(Math.abs(Math.log(m.cutoffHz / prev.cutoffHz)), `${lz}`).toBeLessThan(0.025);
      expect(m.gain, `${lz}`).toBeGreaterThanOrEqual(prev.gain - 1e-9);
      rise += m.gain - prev.gain;
      prev = m;
    }
    expect(prev.gain).toBeCloseTo(TAVERN_AMBIENCE_INSIDE_GAIN, 6);
    expect(rise).toBeGreaterThan(0.2);
  });

  it('writes into the caller-owned result and returns it', () => {
    const out = newTavernAmbienceMix();
    const w = tavernToWorld(0, 0);
    expect(tavernAmbienceMix(w.x, TAVERN_FLOOR_Y + 3, w.z, out)).toBe(out);
    expect(out.gain).toBeCloseTo(TAVERN_AMBIENCE_INSIDE_GAIN, 6);
  });
});
