// What the Wildheart Basin bosses' art-guide clips DO, read from the shipped
// GLBs: every blow lands on frame 18 of a 1.5 s clip at 1x (contacts), every
// bar's blow on the bar's end at 1x, and each death ends lying on the floor
// (Reuben 2026-10-11: a natural fall, nothing floating or kneeling in a heap),
// the trolls' weapons dropped flat.

import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import {
  WILDHEART_BEASTMASTER_LOOK,
  WILDHEART_GORGEBLOOM_LOOK,
  WILDHEART_GREAT_JAGUAR_LOOK,
  WILDHEART_ZULGAR_LOOK,
} from '../src/render/characters/wildheart_creature_looks';
import {
  BEASTMASTER_CLIP,
  BEASTMASTER_MODEL,
  beastmasterQuakeRate,
  ZULGAR_CLIP,
  ZULGAR_MODEL,
} from '../src/render/wildheart_basin/basin_trash_model_core';
import {
  GORGE_RATE,
  SEED_RAIN_RATE,
  VINE_LASH_RATE,
} from '../src/render/wildheart_basin/gorgebloom_fx_core';
import {
  GORGEBLOOM_CLIP,
  GORGEBLOOM_MODEL,
} from '../src/render/wildheart_basin/gorgebloom_model_core';
import { JAGUAR_CLIP, JAGUAR_MODEL } from '../src/render/wildheart_basin/jaguar_model_core';
import {
  BEAST_PIT_QUAKE,
  BEAST_TUNING,
  ZULGAR_PULSE,
  ZULGAR_SPIRIT_HUNT,
} from '../src/sim/encounters/wildheart_basin/ids';
import { clipLength, posedNodes } from './helpers/posed_glb';

const glb = (url: string) => `public/${url}`;
const FRAME_18 = 17 / 30;

describe('the Basin bosses strike with their weight behind them', () => {
  const blows = [
    {
      name: 'the Beastmaster',
      def: WILDHEART_BEASTMASTER_LOOK,
      url: BEASTMASTER_MODEL.url,
      clips: ['Attack', 'Attack2'],
    },
    {
      name: 'Zulgar',
      def: WILDHEART_ZULGAR_LOOK,
      url: ZULGAR_MODEL.url,
      clips: ['Attack', 'Attack2'],
    },
    {
      name: 'the Great Jaguar',
      def: WILDHEART_GREAT_JAGUAR_LOOK,
      url: JAGUAR_MODEL.url,
      clips: ['Bite', 'Claw'],
    },
    {
      name: 'the Gorgebloom',
      def: WILDHEART_GORGEBLOOM_LOOK,
      url: GORGEBLOOM_MODEL.url,
      clips: ['Attack'],
    },
  ] as const;
  for (const b of blows) {
    it(`${b.name} lands each blow on frame 18 of a 1.5 s clip, at 1x`, async () => {
      expect(b.def.attackTimeScale).toBe(1);
      expect(b.def.clips.attack).toEqual([...b.clips]);
      for (const clip of b.clips) {
        expect(b.def.clips.contacts?.[clip], clip).toEqual([expect.closeTo(FRAME_18, 3)]);
        expect(await clipLength(glb(b.url), clip), clip).toBeCloseTo(1.5, 2);
      }
    });
  }

  it('the contract beats are the clips own frame 18', () => {
    for (const t of [
      BEASTMASTER_CLIP.attackHit,
      ZULGAR_CLIP.attackHit,
      JAGUAR_CLIP.biteClose,
      JAGUAR_CLIP.clawRake,
      GORGEBLOOM_CLIP.attackBite,
    ])
      expect(t).toBeCloseTo(FRAME_18, 3);
  });

  it('plays every bar at 1x, its blow on the bar end', () => {
    expect(beastmasterQuakeRate(BEAST_TUNING.quakeCast)).toBeCloseTo(1, 9);
    expect(WILDHEART_BEASTMASTER_LOOK.clips.castTimeScaleByAbility?.[BEAST_PIT_QUAKE]).toBeCloseTo(
      1,
      9,
    );
    const z = WILDHEART_ZULGAR_LOOK.clips;
    expect(z.castByAbility?.[ZULGAR_PULSE]).toBe('Pulse');
    expect(z.castByAbility?.[ZULGAR_SPIRIT_HUNT]).toBe('SpiritHunt');
    expect(z.castTimeScaleByAbility?.[ZULGAR_PULSE]).toBeCloseTo(1, 9);
    expect(z.castTimeScaleByAbility?.[ZULGAR_SPIRIT_HUNT]).toBeCloseTo(1, 9);
    for (const rate of [SEED_RAIN_RATE, VINE_LASH_RATE, GORGE_RATE]) expect(rate).toBeCloseTo(1, 9);
  });

  it('Zulgar wears his own body and still vanishes for the Ambush', () => {
    expect(VISUALS.mob_wildheart_high_priest).toBe(WILDHEART_ZULGAR_LOOK);
    expect(WILDHEART_ZULGAR_LOOK.meshToggles?.[0]?.nodes).toEqual(['*']);
  });
});

describe('the Basin bosses die lying on the floor', () => {
  for (const b of [
    { name: 'the Beastmaster', url: BEASTMASTER_MODEL.url, head: 'head', prop: 'Weapon' },
    { name: 'Zulgar', url: ZULGAR_MODEL.url, head: 'head', prop: 'staff' },
  ] as const) {
    it(`${b.name} ends his Death lying down, the ${b.prop} dropped flat`, async () => {
      const names = ['hips', 'chest', b.head, b.prop];
      const stand = await posedNodes(glb(b.url), 'Idle', 0, names);
      const dead = await posedNodes(
        glb(b.url),
        'Death',
        await clipLength(glb(b.url), 'Death'),
        names,
      );
      const tall = stand[b.head].pos[1];
      for (const n of ['hips', 'chest', b.head])
        expect(dead[n].pos[1], `${n} at rest`).toBeLessThan(0.25 * tall);
      const run = [0, 1, 2].map((i) => dead.chest.pos[i] - dead.hips.pos[i]);
      expect(
        Math.abs(run[1]) / Math.hypot(run[0], run[1], run[2]),
        'the torso lies flat',
      ).toBeLessThan(0.35);
      expect(Math.abs(dead[b.prop].up[1]), `the ${b.prop} lies flat`).toBeLessThan(0.3);
      expect(dead[b.prop].pos[1], `the ${b.prop} is on the floor`).toBeLessThan(0.12 * tall);
    });
  }

  it('the Great Jaguar ends its Death on its side, body and head on the ground', async () => {
    const url = glb(JAGUAR_MODEL.url);
    const names = ['hips', 'chest', 'head'];
    const stand = await posedNodes(url, 'Idle', 0, names);
    const dead = await posedNodes(url, 'Death', await clipLength(url, 'Death'), names);
    for (const n of names) expect(dead[n].pos[1], n).toBeLessThan(0.6 * stand[n].pos[1]);
    const run = [0, 1, 2].map((i) => dead.chest.pos[i] - dead.hips.pos[i]);
    expect(
      Math.abs(run[1]) / Math.hypot(run[0], run[1], run[2]),
      'the body lies level',
    ).toBeLessThan(0.3);
  });

  it('the Gorgebloom ends its Death wilted flat on the water, its maw face down', async () => {
    const url = glb(GORGEBLOOM_MODEL.url);
    const petals = ['FL', 'FR', 'L', 'R', 'B'].map((k) => `Petal_${k}2`);
    const dead = await posedNodes(url, 'Death', await clipLength(url, 'Death'), [
      'MawAnchor',
      ...petals,
    ]);
    expect(dead.MawAnchor.pos[1]).toBeLessThan(0.1 * GORGEBLOOM_MODEL.idleTop);
    for (const p of petals) expect(dead[p].pos[1], p).toBeLessThan(0.3 * GORGEBLOOM_MODEL.idleTop);
  });
});
