// The Guardian of the Heat's pass-4 looks, pinned to the sim: the Molten
// Swells' wall stands exactly in the box the sim strikes (heat_geometry.ts
// inWave) at every front, its scorched trail fades once its lane is gone; the
// thrown Hearthseeds' meteors leave the hands on the Throw clip's release and
// land exactly on their seed's spot at the sim's landing time (seedFlight),
// the clip itself ships in the guardian's GLB beside its nine.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HEAT_BODY_CLIP, HEAT_BODY_CLIPS } from '../src/render/smith_heart_fx/heat_body_core';
import {
  HEAT_METEOR,
  meteorArc,
  meteorCraterLook,
  meteorFlightSeconds,
  meteorLook,
} from '../src/render/smith_heart_fx/heat_meteor_core';
import { HEAT_TUNING as T } from '../src/sim/encounters/smith_heart';

const ROOT = join(__dirname, '..');

describe('the thrown Hearthseeds: the meteors are the seeds', () => {
  it('leave the hands on the clip release and land on the sim beat', () => {
    expect(HEAT_METEOR.release).toBeCloseTo(HEAT_BODY_CLIP.throwRelease, 9);
    expect(HEAT_METEOR.land).toBe(T.seedFlight);
    expect(HEAT_METEOR.gather).toBeLessThan(HEAT_METEOR.release);
    expect(HEAT_METEOR.release).toBeLessThan(HEAT_METEOR.land);
    expect(HEAT_BODY_CLIP.throwEnd).toBeGreaterThan(HEAT_METEOR.land);
    expect(meteorFlightSeconds()).toBeCloseTo(T.seedFlight - HEAT_BODY_CLIP.throwRelease, 9);
    const before = meteorLook(HEAT_METEOR.release - 0.01);
    expect(before.flight).toBe(-1);
    expect(before.gather).toBeGreaterThan(0.9);
    expect(meteorLook(0).gather).toBe(0);
    const mid = meteorLook((HEAT_METEOR.release + HEAT_METEOR.land) / 2);
    expect(mid.flight).toBeCloseTo(0.5, 6);
    expect(mid.landed).toBe(false);
    expect(meteorLook(HEAT_METEOR.land).landed).toBe(true);
  });

  it('arcs high and lands exactly on the spot', () => {
    const from = { x: 0, y: 18, z: 0 };
    const to = { x: 30, y: 0, z: -12 };
    const end = meteorArc(from, to, 1);
    expect(end.x).toBeCloseTo(to.x, 9);
    expect(end.y).toBeCloseTo(to.y, 9);
    expect(end.z).toBeCloseTo(to.z, 9);
    const start = meteorArc(from, to, 0);
    expect(start).toEqual(from);
    const top = meteorArc(from, to, 0.5);
    expect(top.y).toBeGreaterThan(from.y);
    // Past the end it stays on the spot.
    expect(meteorArc(from, to, 1.4).x).toBeCloseTo(to.x, 9);
  });

  it('leaves a crater that flashes and cools to nothing', () => {
    expect(meteorCraterLook(0).flash).toBe(1);
    expect(meteorCraterLook(0).glow).toBe(1);
    expect(meteorCraterLook(1).flash).toBe(0);
    expect(meteorCraterLook(HEAT_METEOR.craterSeconds).glow).toBe(0);
    expect(meteorCraterLook(-1).glow).toBe(0);
  });

  it('ships the Throw clip in the GLB beside every other clip', () => {
    const b = readFileSync(join(ROOT, 'public/models/creatures/smith_heart_heat_guardian.glb'));
    const len = b.readUInt32LE(12);
    const json = JSON.parse(b.subarray(20, 20 + len).toString('utf8')) as {
      animations: { name: string }[];
      extensionsUsed: string[];
    };
    const names = json.animations.map((a) => a.name);
    expect(HEAT_BODY_CLIPS).toContain('Throw');
    for (const c of HEAT_BODY_CLIPS) expect(names, c).toContain(c);
    expect(json.extensionsUsed).toContain('KHR_texture_basisu');
    expect(json.extensionsUsed).toContain('EXT_meshopt_compression');
  });

  it('binds the Throw gesture on the body and holds it against a swing', () => {
    const src = readFileSync(join(ROOT, 'src/render/characters/smith_heart_boss_looks.ts'), 'utf8');
    expect(src).toMatch(/\[HEAT_BODY_GESTURES\.throw\]: 'Throw'/);
    expect(src).toMatch(/oneShotsHoldAttacks: \[[^\]]*'Throw'/);
  });
});
