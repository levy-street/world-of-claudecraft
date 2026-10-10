// What Korgath's and Velkhar's art-guide clips DO, read from the shipped GLBs
// (render/gravewyrm_sanctum_bosses/boss_model_core.ts): every blow and bar has
// its weight before its speed and plays at 1x (the auto attacks land on frame
// 18 of 1.5 s clips, each bar's blow on the bar's end), the harness anchors
// sit where the chains are drawn from, and each death ends lying on the floor
// with the weapon dropped flat (Reuben 2026-10-11: a natural fall, nothing
// floating or kneeling in a heap).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SANCTUM_BOSS_LOOKS } from '../src/render/characters/sanctum_boss_looks';
import {
  KORGATH_ANCHOR_REST,
  KORGATH_ANCHORS,
  KORGATH_BODY,
  KORGATH_BROKEN_CHAIN_MESH,
  KORGATH_CLIP,
  VELKHAR_BODY,
  VELKHAR_CLIP,
} from '../src/render/gravewyrm_sanctum_bosses/boss_model_core';
import {
  KORGATH_BELLOW,
  KORGATH_CHAIN_FLAIL,
  KORGATH_MAUL_ARC,
  KORGATH_STOMP,
  KORGATH_STRAIN,
  KORGATH_THRESHOLD_CHARGE,
  VELKHAR_SHADOW_VOLLEY,
  VELKHAR_SOULFIRE_TRENCH,
} from '../src/sim/encounters/gravewyrm_sanctum/boss_ids';
import { clipLength, posedNodes } from './helpers/posed_glb';

const glb = (url: string) => `public/${url}`;

function meshNames(url: string): string[] {
  const b = readFileSync(glb(url));
  const len = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + len).toString('utf8')) as {
    meshes?: { name?: string }[];
  };
  return (json.meshes ?? []).map((m) => m.name ?? '');
}

describe('the Sanctum bosses strike with their weight behind them', () => {
  it('Korgath lands each maul blow on frame 18 of a 1.5 s clip, at 1x', async () => {
    const def = SANCTUM_BOSS_LOOKS.sanctum_korgath;
    expect(def.attackTimeScale).toBe(1);
    expect(def.clips.contacts).toEqual({
      HammerSlam: [KORGATH_CLIP.slam],
      HammerSweep: [KORGATH_CLIP.sweep],
    });
    expect(KORGATH_CLIP.slam).toBeCloseTo(17 / 30, 3);
    for (const clip of ['HammerSlam', 'HammerSweep'])
      expect(await clipLength(glb(KORGATH_BODY.url), clip), clip).toBeCloseTo(1.5, 2);
  });

  it('Korgath plays every bar at 1x, its blow on the bar end', () => {
    const rates = SANCTUM_BOSS_LOOKS.sanctum_korgath.clips.castTimeScaleByAbility ?? {};
    for (const id of [
      KORGATH_STRAIN,
      KORGATH_STOMP,
      KORGATH_MAUL_ARC,
      KORGATH_CHAIN_FLAIL,
      KORGATH_THRESHOLD_CHARGE,
      KORGATH_BELLOW,
    ])
      expect(rates[id], id).toBeCloseTo(1, 6);
  });

  it('Velkhar lands his staff on frame 18 and launches the trench and the volley on their bars', async () => {
    const def = SANCTUM_BOSS_LOOKS.sanctum_velkhar;
    expect(def.attackTimeScale).toBe(1);
    expect(def.clips.contacts).toEqual({ Attack: [VELKHAR_CLIP.attackLand] });
    expect(await clipLength(glb(VELKHAR_BODY.url), 'Attack')).toBeCloseTo(1.5, 2);
    const rates = def.clips.castTimeScaleByAbility ?? {};
    expect(rates[VELKHAR_SOULFIRE_TRENCH]).toBeCloseTo(1, 6);
    expect(rates[VELKHAR_SHADOW_VOLLEY]).toBeCloseTo(1, 6);
  });
});

describe("Korgath's harness", () => {
  it('rides each chain from its anchor bone, where the far bake stands it in', async () => {
    const names = Object.values(KORGATH_ANCHORS);
    const idle = await posedNodes(glb(KORGATH_BODY.url), 'Idle', 0.5, names);
    for (const [tool, bone] of Object.entries(KORGATH_ANCHORS)) {
      const rest = KORGATH_ANCHOR_REST[tool as keyof typeof KORGATH_ANCHOR_REST];
      const p = idle[bone].pos;
      expect(Math.hypot(p[0] - rest.x, p[1] - rest.y, p[2] - rest.z), bone).toBeLessThan(0.2);
    }
  });

  it('ships the broken chains a break reveals', () => {
    const meshes = meshNames(KORGATH_BODY.url);
    for (const name of Object.values(KORGATH_BROKEN_CHAIN_MESH))
      expect(meshes, name).toContain(name);
  });
});

const BOSSES = [
  { name: 'Korgath', url: KORGATH_BODY.url, prop: 'hammer' },
  { name: 'Velkhar', url: VELKHAR_BODY.url, prop: 'staff' },
] as const;

describe('the Sanctum bosses die lying on the floor', () => {
  for (const b of BOSSES) {
    it(`${b.name} ends his Death lying down, the ${b.prop} dropped flat`, async () => {
      const names = ['hips', 'chest', 'head', b.prop];
      const stand = await posedNodes(glb(b.url), 'Idle', 0, names);
      const end = await clipLength(glb(b.url), 'Death');
      const dead = await posedNodes(glb(b.url), 'Death', end, names);
      const tall = stand.head.pos[1];
      for (const n of ['hips', 'chest', 'head'] as const)
        expect(dead[n].pos[1], `${n} at rest`).toBeLessThan(0.25 * tall);
      const run = [0, 1, 2].map((i) => dead.chest.pos[i] - dead.hips.pos[i]);
      expect(
        Math.abs(run[1]) / Math.hypot(run[0], run[1], run[2]),
        'the torso lies flat',
      ).toBeLessThan(0.35);
      expect(Math.abs(dead[b.prop].up[1]), `the ${b.prop} lies flat`).toBeLessThan(0.3);
      // the haft's axis, a head's radius up when the head rests on the floor (a giant's maul
      // head is over two yards across)
      expect(dead[b.prop].pos[1], `the ${b.prop} is on the floor`).toBeLessThan(0.15 * tall);
      expect(dead[b.prop].pos[1], `the ${b.prop} fell`).toBeLessThan(stand[b.prop].pos[1]);
    });
  }
});
