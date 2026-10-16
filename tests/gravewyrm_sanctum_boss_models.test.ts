// The Gravewyrm Sanctum bosses' Blender bodies in game (render/characters/
// sanctum_boss_looks.ts, render/gravewyrm_sanctum_bosses/boss_model_core.ts):
// each boss template draws its own body, at its authored size, and every bar
// the sim casts plays its own clip with its contact frame on the bar's end.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyClipPositionDrops } from '../src/render/characters/clip_track_drops';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import {
  SANCTUM_BOSS_LOOKS,
  SANCTUM_BOSS_MOB_KEYS,
} from '../src/render/characters/sanctum_boss_looks';
import {
  bossLookHeight,
  bossModelScale,
  contactRate,
  KORGATH_BODY,
  KORZUL_BODY,
  KORZUL_FROZEN_STANCE,
  VELKHAR_BODY,
} from '../src/render/gravewyrm_sanctum_bosses/boss_model_core';
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
import type { Entity } from '../src/sim/types';

function glbAnimations(url: string): string[] {
  const b = readFileSync(path.join('public', url));
  const len = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + len).toString('utf8')) as {
    animations?: { name: string }[];
    nodes: { name?: string }[];
  };
  return (json.animations ?? []).map((a) => a.name);
}

describe('the Sanctum bosses draw their own bodies', () => {
  it('maps each boss template to its look', () => {
    for (const [mob, key] of Object.entries(SANCTUM_BOSS_MOB_KEYS)) {
      expect(visualKeyFor({ kind: 'mob', templateId: mob } as unknown as Entity)).toBe(key);
      expect(VISUALS[key]).toBe(SANCTUM_BOSS_LOOKS[key]);
    }
  });

  it('pins each body sim scale to its template', () => {
    expect(MOBS.korgath_the_bound.scale).toBe(KORGATH_BODY.simScale);
    expect(MOBS.grand_necromancer_velkhar.scale).toBe(VELKHAR_BODY.simScale);
    expect(MOBS.korzul_the_gravewyrm.scale).toBe(KORZUL_BODY.simScale);
  });

  it('draws them at their authored size (Korgath four knights, Korzul a great wyrm)', () => {
    const knight = 2.6;
    const drawn = (b: typeof KORGATH_BODY) => bossLookHeight(b) * b.simScale;
    expect(drawn(KORGATH_BODY) / knight).toBeGreaterThan(3.5);
    expect(drawn(VELKHAR_BODY) / knight).toBeGreaterThan(1.8);
    expect(drawn(KORZUL_BODY) / knight).toBeGreaterThan(8);
    for (const b of [KORGATH_BODY, VELKHAR_BODY, KORZUL_BODY])
      expect(bossModelScale(b, b.simScale)).toBeCloseTo(1, 6);
  });

  it('plays a clip of its own for every bar the sim casts, timed to the bar', () => {
    const korgath = SANCTUM_BOSS_LOOKS.sanctum_korgath.clips;
    for (const id of [
      KORGATH_STRAIN,
      KORGATH_STOMP,
      KORGATH_MAUL_ARC,
      KORGATH_CHAIN_FLAIL,
      KORGATH_THRESHOLD_CHARGE,
      KORGATH_BELLOW,
    ]) {
      expect(korgath.castByAbility?.[id]).toBeTruthy();
      expect(korgath.castTimeScaleByAbility?.[id]).toBeGreaterThan(0.5);
    }
    const velkhar = SANCTUM_BOSS_LOOKS.sanctum_velkhar.clips;
    for (const id of [VELKHAR_SOULFIRE_TRENCH, VELKHAR_SHADOW_VOLLEY])
      expect(velkhar.castByAbility?.[id]).toBeTruthy();
    const korzul = SANCTUM_BOSS_LOOKS.sanctum_korzul.clips;
    for (const id of [
      KORZUL_GRAVE_BREATH,
      KORZUL_TAIL_SWEEP,
      KORZUL_GRAVE_INFERNO,
      KORZUL_WING_GALE,
      KORZUL_PLUNGING_FIRE,
      KORZUL_CRASHING_DESCENT,
    ])
      expect(korzul.castByAbility?.[id]).toBeTruthy();
    // Doused cuts the Inferno: it never finishes as a play-out.
    expect(korzul.castPlayOut).not.toContain('GraveInferno');
    expect(contactRate(2, 2)).toBe(1);
    expect(contactRate(0.95, 1.2)).toBeCloseTo(0.79, 2);
  });

  it('names only clips the shipped GLBs carry', () => {
    for (const def of Object.values(SANCTUM_BOSS_LOOKS)) {
      const have = new Set(glbAnimations(def.url));
      const c = def.clips;
      const named = [
        c.idle,
        c.walk,
        c.run,
        c.death,
        c.cast,
        c.jump,
        c.fall,
        ...(c.attack ?? []),
        ...(c.hit ?? []),
        ...Object.values(c.castByAbility ?? {}),
        ...Object.values(c.attackByAbility ?? {}),
        ...Object.values(def.phaseClips ?? {}).flatMap((p) => [p.enter, p.clips.idle]),
      ].filter((n): n is string => typeof n === 'string');
      for (const n of named) expect(have.has(n), `${def.url} ${n}`).toBe(true);
    }
  });

  it('holds Korzul frozen in the ice until his pull, then breaks him free', () => {
    const def = SANCTUM_BOSS_LOOKS.sanctum_korzul;
    expect(def.phaseClips?.[KORZUL_FROZEN_STANCE].clips.idle).toBe('Frozen');
    expect(def.phaseClips?.[KORZUL_BREAK_FREE].clips.idle).toBe('Idle');
    expect(def.clips.castByAbility?.[KORZUL_BREAK_FREE]).toBe('BreakFree');
    expect(def.flight).toBe(true);
  });

  it('lets the sim own his flight height (the hover clips lose their Root climb)', () => {
    const drops = SANCTUM_BOSS_LOOKS.sanctum_korzul.clipPositionDrops ?? {};
    for (const clip of ['TakeOff', 'FlyIdle', 'FlyForward', 'BreathAir', 'Land'])
      expect(drops[clip]).toEqual(['Root']);
    const clips = new Map<string, THREE.AnimationClip>([
      [
        'FlyIdle',
        new THREE.AnimationClip('FlyIdle', 1, [
          new THREE.VectorKeyframeTrack('Root.position', [0, 1], [0, 6, 0, 0, 6, 0]),
          new THREE.QuaternionKeyframeTrack('Root.quaternion', [0], [0, 0, 0, 1]),
        ]),
      ],
    ]);
    applyClipPositionDrops(clips, drops);
    expect(clips.get('FlyIdle')?.tracks.map((t) => t.name)).toEqual(['Root.quaternion']);
  });
});

describe('Korzul in the ice: one dragon on screen', () => {
  it('his own body hides until the face collapses or he is pulled', async () => {
    const core = await import('../src/render/gravewyrm_sanctum_bosses/boss_model_core');
    expect(core.korzulBodyHidden(0, false, false)).toBe(true);
    expect(core.korzulBodyHidden(7, false, false)).toBe(true);
    expect(core.korzulBodyHidden(8, false, false)).toBe(false);
    expect(core.korzulBodyHidden(3, true, false)).toBe(false);
    expect(core.korzulBodyHidden(3, false, true)).toBe(false);
    const look = VISUALS.sanctum_korzul;
    expect(look.meshToggles).toEqual([
      { nodes: ['*'], hideNow: core.KORZUL_HIDE_GESTURE, showNow: core.KORZUL_SHOW_GESTURE },
    ]);
  });
});

describe('Korzul breaking free: the body appears only at the face, on the burst', () => {
  it('stays hidden through Break Free until the ice bursts, then shows (a body once seen is never hidden again)', async () => {
    const core = await import('../src/render/gravewyrm_sanctum_bosses/boss_model_core');
    const plan = await import('../src/sim/encounters/gravewyrm_sanctum/korzul_emerge_plan');
    // The burst beat: the clip's own burst at the bar's play rate, inside the bar.
    expect(core.KORZUL_BURST_AT).toBeCloseTo(
      (core.KORZUL_CLIP.breakFreeBurst * plan.KORZUL_EMERGE.burst) / core.KORZUL_CLIP.breakFreeSlam,
      9,
    );
    expect(core.KORZUL_BURST_AT).toBeGreaterThan(1);
    expect(core.KORZUL_BURST_AT).toBeLessThan(plan.KORZUL_EMERGE.burst);
    const v = core.korzulBodyView;
    expect(v(7, false, false, false, null)).toBe('frozen');
    // Pulled out of the ice: hidden until the burst beat, shown from it.
    expect(v(8, true, false, true, 0)).toBe('bursting');
    expect(v(8, true, false, true, core.KORZUL_BURST_AT - 0.01)).toBe('bursting');
    expect(v(8, true, false, true, core.KORZUL_BURST_AT)).toBe('shown');
    // Past the bar (rise, arc, landing): shown.
    expect(v(8, true, false, true, null)).toBe('shown');
    // A body already seen (a re-pull with the ice gone) is never hidden again.
    expect(v(8, true, false, false, 0)).toBe('shown');
    expect(v(8, false, true, true, 0)).toBe('shown');
  });

  it('lands with the Land clip, its impact on the touchdown of the sim timeline', async () => {
    const core = await import('../src/render/gravewyrm_sanctum_bosses/boss_model_core');
    const plan = await import('../src/sim/encounters/gravewyrm_sanctum/korzul_emerge_plan');
    const clips = VISUALS.sanctum_korzul.clips;
    expect(clips.attackByAbility?.[core.KORZUL_EMERGE_LAND_GESTURE]).toBe('Land');
    const rate = clips.attackTimeScaleByAbility?.[core.KORZUL_EMERGE_LAND_GESTURE] ?? 0;
    expect(core.KORZUL_CLIP.landImpact / rate).toBeCloseTo(plan.KORZUL_EMERGE.land, 9);
    // The burst bar keeps its slam on the bar's end.
    expect(clips.castByAbility?.sanctum_korzul_break_free).toBe('BreakFree');
    expect(clips.castTimeScaleByAbility?.sanctum_korzul_break_free).toBeCloseTo(
      contactRate(core.KORZUL_CLIP.breakFreeSlam, plan.KORZUL_EMERGE.burst),
      9,
    );
    // The landing clip's own height track is dropped: the sim's fall carries it.
    expect(VISUALS.sanctum_korzul.clipPositionDrops?.Land).toEqual(['Root']);
  });
});
