// What the Gravewyrm Sanctum bosses' art-guide clips DO, read from the shipped
// GLBs (render/gravewyrm_sanctum_bosses/boss_model_core.ts and
// gravewyrm_sanctum_fx/tusker_model_core.ts): every blow and bar has its weight
// before its speed and plays at 1x (the auto attacks land on frame 18 of 1.5 s
// clips, each bar's blow on the bar's end), Korgath's harness anchors sit
// where the chains are drawn from, the gaits play near 1x at the sim's
// speeds, and each death ends lying on the floor, the weapons dropped flat,
// Korzul's wings laid over his flanks and the Tusker on its side (Reuben
// 2026-10-11: a natural fall, nothing floating or kneeling in a heap).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SANCTUM_BOSS_LOOKS } from '../src/render/characters/sanctum_boss_looks';
import { SANCTUM_SLEDGE_TUSKER_LOOK } from '../src/render/characters/sanctum_creature_looks';
import {
  KORGATH_ANCHOR_REST,
  KORGATH_ANCHORS,
  KORGATH_BODY,
  KORGATH_BROKEN_CHAIN_MESH,
  KORGATH_CLIP,
  KORZUL_BODY,
  KORZUL_CLIP,
  KORZUL_EMERGE_LAND_GESTURE,
  KORZUL_RUN_REF,
  KORZUL_TAKEOFF_GESTURE,
  VELKHAR_BODY,
  VELKHAR_CLIP,
} from '../src/render/gravewyrm_sanctum_bosses/boss_model_core';
import {
  chargeClipRate,
  sweepClipRate,
  TUSKER_CLIP,
  TUSKER_MODEL,
  trampleClipRate,
} from '../src/render/gravewyrm_sanctum_fx/tusker_model_core';
import { MOBS } from '../src/sim/data';
import {
  KORGATH_BELLOW,
  KORGATH_CHAIN_FLAIL,
  KORGATH_MAUL_ARC,
  KORGATH_STOMP,
  KORGATH_STRAIN,
  KORGATH_THRESHOLD_CHARGE,
  KORZUL_BREAK_FREE,
  KORZUL_CRASHING_DESCENT,
  KORZUL_GRAVE_BREATH,
  KORZUL_GRAVE_INFERNO,
  KORZUL_PLUNGING_FIRE,
  KORZUL_TAIL_SWEEP,
  KORZUL_WING_GALE,
  VELKHAR_SHADOW_VOLLEY,
  VELKHAR_SOULFIRE_TRENCH,
} from '../src/sim/encounters/gravewyrm_sanctum/boss_ids';
import { SLEDGE_TUSKER_ID } from '../src/sim/encounters/gravewyrm_sanctum/ids';
import { clipLength, posedNodes } from './helpers/posed_glb';

const glb = (url: string) => `public/${url}`;

interface GlbHead {
  meshes?: { name?: string }[];
  materials?: { name?: string; emissiveTexture?: unknown }[];
}

function glbHead(url: string): GlbHead {
  const b = readFileSync(glb(url));
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8')) as GlbHead;
}

function meshNames(url: string): string[] {
  return (glbHead(url).meshes ?? []).map((m) => m.name ?? '');
}

const FRAME_18 = 17 / 30;

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

describe('Korzul strikes with his weight behind him', () => {
  const def = SANCTUM_BOSS_LOOKS.sanctum_korzul;

  it('lands the bite and the claw on frame 18 of 1.5 s clips, at 1x', async () => {
    expect(def.attackTimeScale).toBe(1);
    expect(def.clips.attack).toEqual(['Bite', 'Claw']);
    expect(def.clips.contacts).toEqual({
      Bite: [KORZUL_CLIP.biteHit],
      Claw: [KORZUL_CLIP.clawHit],
    });
    for (const t of [KORZUL_CLIP.biteHit, KORZUL_CLIP.clawHit]) expect(t).toBeCloseTo(FRAME_18, 3);
    for (const clip of ['Bite', 'Claw'])
      expect(await clipLength(glb(KORZUL_BODY.url), clip), clip).toBeCloseTo(1.5, 2);
  });

  it('plays every bar, the takeoff and the drop at 1x, each blow on its end', async () => {
    const rates = def.clips.castTimeScaleByAbility ?? {};
    for (const id of [
      KORZUL_GRAVE_BREATH,
      KORZUL_TAIL_SWEEP,
      KORZUL_GRAVE_INFERNO,
      KORZUL_WING_GALE,
      KORZUL_PLUNGING_FIRE,
      KORZUL_CRASHING_DESCENT,
      KORZUL_BREAK_FREE,
    ])
      expect(rates[id], id).toBeCloseTo(1, 6);
    const gestures = def.clips.attackTimeScaleByAbility ?? {};
    expect(gestures[KORZUL_TAKEOFF_GESTURE]).toBeCloseTo(1, 6);
    expect(gestures[KORZUL_EMERGE_LAND_GESTURE]).toBeCloseTo(1, 6);
    // Crashing Descent dives on its own clip (the hang, the dive, the slam on the 3 s bar's
    // end); Break Free's 1.4 s drop keeps Land.
    expect(def.clips.castByAbility?.[KORZUL_CRASHING_DESCENT]).toBe('Descent');
    expect(def.clips.castPlayOut).toContain('Descent');
    expect(def.clipPositionDrops?.Descent).toEqual(['Root']);
    const url = glb(KORZUL_BODY.url);
    expect(await clipLength(url, 'TakeOff')).toBeCloseTo(KORZUL_CLIP.takeOffLength, 2);
    expect(await clipLength(url, 'Descent')).toBeGreaterThan(KORZUL_CLIP.descentImpact);
    expect(await clipLength(url, 'Land')).toBeGreaterThan(KORZUL_CLIP.landImpact);
    expect(await clipLength(url, 'BreakFree')).toBeCloseTo(KORZUL_CLIP.breakFreeLength, 2);
  });

  it('runs down the raid on his own Run, near 1x at his speed', async () => {
    expect(def.clips.run).toBe('Run');
    expect(await clipLength(glb(KORZUL_BODY.url), 'Run')).toBeGreaterThan(1);
    const rate = (MOBS.korzul_the_gravewyrm.moveSpeed ?? 0) / (def.runRef ?? 1);
    expect(rate).toBeGreaterThan(0.8);
    expect(rate).toBeLessThan(1.2);
    expect(def.runRef).toBeCloseTo(KORZUL_RUN_REF, 6);
  });

  it('carries the heart shard glow map its heartbeat pulses', () => {
    const body = (glbHead(KORZUL_BODY.url).materials ?? []).find((m) => m.name === 'KorzulBody');
    expect(body?.emissiveTexture).toBeTruthy();
  });
});

describe('the Sledge Tusker strikes with its weight behind it', () => {
  const def = SANCTUM_SLEDGE_TUSKER_LOOK;

  it('lands the gore on frame 18 of a 1.5 s clip, at 1x', async () => {
    expect(def.attackTimeScale).toBe(1);
    expect(def.clips.contacts).toEqual({ Attack: [TUSKER_CLIP.attackHit] });
    expect(TUSKER_CLIP.attackHit).toBeCloseTo(FRAME_18, 3);
    expect(await clipLength(glb(TUSKER_MODEL.url), 'Attack')).toBeCloseTo(1.5, 2);
  });

  it('plays the sweep and the trample warning at 1x, each on its bar end', () => {
    expect(sweepClipRate()).toBeCloseTo(1, 6);
    expect(trampleClipRate()).toBeCloseTo(1, 6);
    // The charge runs one stride cycle down the lane's 0.8 s.
    expect(chargeClipRate()).toBeCloseTo(TUSKER_CLIP.charge / 0.8, 6);
  });

  it('hauls and chases near 1x at the sim speeds', () => {
    // The patrol's haul (2.7) and the chase (its move speed).
    const walk = 2.7 / (def.walkRef ?? 1);
    expect(walk).toBeGreaterThan(0.85);
    expect(walk).toBeLessThan(1.15);
    const run = (MOBS[SLEDGE_TUSKER_ID]?.moveSpeed ?? 0) / (def.runRef ?? 1);
    expect(run).toBeGreaterThan(0.85);
    expect(run).toBeLessThan(1.15);
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

describe('Korzul and the Sledge Tusker die lying on the floor', () => {
  it('Korzul ends his Death on his belly, the skull on the ice, the wings over his flanks', async () => {
    const url = glb(KORZUL_BODY.url);
    const names = ['hips', 'chest', 'head', 'wing.2.l', 'wing.2.r'];
    const stand = await posedNodes(url, 'Idle', 0, names);
    const dead = await posedNodes(url, 'Death', await clipLength(url, 'Death'), names);
    const tall = stand.head.pos[1];
    expect(dead.head.pos[1], 'the skull on the ice').toBeLessThan(0.3 * tall);
    for (const n of ['hips', 'chest']) expect(dead[n].pos[1], n).toBeLessThan(0.45 * tall);
    // The wings fold and droop over his flanks: no spar left standing.
    for (const n of ['wing.2.l', 'wing.2.r'])
      expect(dead[n].pos[1], n).toBeLessThan(0.5 * stand[n].pos[1]);
  });

  it('the Tusker ends its Death on its left side, the lantern on the ground', async () => {
    const url = glb(TUSKER_MODEL.url);
    const names = ['hips', 'chest', 'head', 'lantern'];
    const stand = await posedNodes(url, 'Idle', 0, names);
    const dead = await posedNodes(url, 'Death', await clipLength(url, 'Death'), names);
    for (const n of ['hips', 'chest', 'head'])
      expect(dead[n].pos[1], n).toBeLessThan(0.5 * stand[n].pos[1]);
    expect(dead.lantern.pos[1], 'the lantern').toBeLessThan(0.3 * stand.lantern.pos[1]);
    // Rolled onto its left (+x), where the death's dust falls.
    expect(dead.hips.pos[0]).toBeCloseTo(TUSKER_MODEL.deathRollLeft, 1);
    const run = [0, 1, 2].map((i) => dead.chest.pos[i] - dead.hips.pos[i]);
    expect(
      Math.abs(run[1]) / Math.hypot(run[0], run[1], run[2]),
      'the body lies level',
    ).toBeLessThan(0.2);
  });
});
