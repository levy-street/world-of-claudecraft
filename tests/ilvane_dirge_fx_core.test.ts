// Cantor Ilvane's Dirge of the Hollow, its pure plan (src/render/hollow_crypt/
// ilvane_dirge_fx_core.ts): the swell builds through the bar, the shock of
// sound races out to the sim's own radius, the silence mark lives as long as
// the silence, the organ's pipes stand on the organ, and the sight cue agrees
// with the sim: measured over the sim's own sight test from her spot, the
// spot the Ilvane suite hides behind a choir pillar lies in the hatched
// shadow and the spot it stands in plain sight is lit.

import { describe, expect, it } from 'vitest';
import {
  DIRGE_RADIUS,
  DIRGE_WAVE_LINGER,
  DIRGE_WAVE_SECONDS,
  dirgeSwell,
  dirgeWave,
  ORGAN_PIPES,
  ORGAN_SPOT,
  silenceMark,
  silenceMarkScale,
  voiceSpiral,
} from '../src/render/hollow_crypt/ilvane_dirge_fx_core';
import { NOVA_RAYS, sightReach } from '../src/render/trash_engine_fx/trash_engine_fx_core';
import { lineOfSightClear } from '../src/sim/colliders';
import { HOLLOW_CRYPT_FIELD } from '../src/sim/content/hollow_crypt_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { ILVANE_TUNING } from '../src/sim/encounters/hollow_crypt/ilvane_ids';
import { groundHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

describe('the Dirge plan: build-up and release', () => {
  it('reaches exactly as far as the sim strikes', () => {
    expect(DIRGE_RADIUS).toBe(ILVANE_TUNING.dirgeRadius);
    expect(dirgeWave(DIRGE_WAVE_SECONDS).front).toBeCloseTo(DIRGE_RADIUS, 9);
    expect(dirgeWave(0).front).toBe(0);
    expect(dirgeWave(DIRGE_WAVE_SECONDS * 0.5).front).toBeGreaterThan(DIRGE_RADIUS * 0.5);
    expect(dirgeWave(DIRGE_WAVE_SECONDS * 0.5).alpha).toBe(1);
    expect(dirgeWave(DIRGE_WAVE_SECONDS + DIRGE_WAVE_LINGER + 0.01).alpha).toBe(0);
  });

  it('swells through the bar: wider, taller, stronger, a denser choir', () => {
    let prev = dirgeSwell(0);
    for (let f = 0.1; f <= 1.0001; f += 0.1) {
      const s = dirgeSwell(f);
      expect(s.radius).toBeGreaterThanOrEqual(prev.radius);
      expect(s.height).toBeGreaterThanOrEqual(prev.height);
      expect(s.power).toBeGreaterThanOrEqual(prev.power);
      expect(s.voiceEvery).toBeLessThanOrEqual(prev.voiceEvery);
      prev = s;
    }
    expect(dirgeSwell(1).power).toBe(1);
    expect(dirgeSwell(0).power).toBeLessThan(0.4);
    // Clamped outside the bar.
    expect(dirgeSwell(-1)).toEqual(dirgeSwell(0));
    expect(dirgeSwell(2)).toEqual(dirgeSwell(1));
  });

  it('winds the voices up round her, apart from each other', () => {
    const a = voiceSpiral(0.5, 0, 4);
    const b = voiceSpiral(0.5, 1, 4);
    expect(b.angle - a.angle).toBeCloseTo(Math.PI / 2, 9);
    expect(voiceSpiral(1, 0, 4).height).toBeGreaterThan(voiceSpiral(0, 0, 4).height);
  });

  it('marks the silenced for exactly as long as the silence holds', () => {
    const d = ILVANE_TUNING.dirgeSilence;
    expect(silenceMark(d, d)).toBe(0);
    expect(silenceMark(d - 0.5, d)).toBe(1);
    expect(silenceMark(0.5, d)).toBeCloseTo(0.5, 9);
    expect(silenceMark(0, d)).toBe(0);
    expect(silenceMarkScale(d, d)).toBeCloseTo(0.4, 9);
    expect(silenceMarkScale(d - 1, d)).toBe(1);
  });

  it('stands the organ pipes on the Bone Organ, across its face', () => {
    const organ = HOLLOW_CRYPT_FIELD.props.find((p) => p.kind === 'hc_bone_organ');
    expect(organ).toBeDefined();
    if (!organ) return;
    expect(ORGAN_SPOT).toEqual({ x: organ.x, z: organ.z });
    expect(ORGAN_PIPES.length).toBeGreaterThan(5);
    for (const p of ORGAN_PIPES) {
      expect(Math.abs(p.x - organ.x)).toBeLessThan(organ.hw ?? 9);
      // In front of its face (it faces the loft, down -z), never inside it.
      expect(p.z).toBeLessThan(organ.z - (organ.hd ?? 1.4));
      expect(p.base + p.length).toBeLessThanOrEqual(organ.h ?? 12);
    }
  });
});

describe('the Dirge sight cue agrees with the sim', () => {
  it('lights the plain-sight spot and shades the one behind the (8, 158) pillar', () => {
    // The Ilvane suite's spots (tests/hollow_crypt_ilvane.test.ts): her place
    // on the loft, a player in plain sight, one hidden behind a choir pillar.
    const o = instanceOrigin(DUNGEONS.hollow_crypt.index, 0);
    const her = { x: o.x, y: groundHeight(o.x, o.z + 163, WORLD_SEED), z: o.z + 163 };
    const to = { x: 0, z: 0 };
    const reachToward = (lx: number, lz: number) => {
      const dx = o.x + lx - her.x;
      const dz = o.z + lz - her.z;
      const d = Math.hypot(dx, dz);
      // The nearest field ray (the field casts NOVA_RAYS of them).
      const ray = Math.round((Math.atan2(dx, dz) / (Math.PI * 2)) * NOVA_RAYS);
      const a = (ray / NOVA_RAYS) * Math.PI * 2;
      const reach = sightReach((r) => {
        to.x = her.x + Math.sin(a) * r;
        to.z = her.z + Math.cos(a) * r;
        return lineOfSightClear(WORLD_SEED, her, to, 0.05);
      }, DIRGE_RADIUS);
      return { reach, d };
    };
    const seen = reachToward(-4, 155);
    expect(seen.reach).toBeGreaterThan(seen.d);
    const hidden = reachToward(14, 154.25);
    expect(hidden.reach).toBeLessThan(hidden.d);
  });
});
