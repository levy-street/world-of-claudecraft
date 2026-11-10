// The Guardian of the Breath's entrance on the client, "Calm before the
// storm" (render/smith_heart_fx/breath_entrance_core.ts, breath_entrance_fx.ts
// and its parts): the scene's clock read off the guardian's aura (a late
// joiner starts where the scene is, one that joins after sees it floating, a
// scene cut short bursts at once), every beat in order (the calm, the pull,
// the eye, the funnel's descent and touch, the strikes, the burst and its
// ring of gust, the great bolt), the plans (the hanging stone drawn up into
// the eye, the stone orbiting the funnel and flung out, the bolts' spines,
// the crawlers), the sounds, the entrance clips in their GLB and the look
// that binds them, the body's air held off while it is still the wind, and
// the painter over a fake world (the stances through the gesture seam, the
// Form once, the thuds, nothing replayed for a late joiner, every beat on
// the low tier, no thud and no flash and capped light under reduced motion).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createGlbIO, indexClip, samplePose } from '../scripts/anim/pose_blend.mjs';
import { SFX_FIXED_CATALOG_KEYS } from '../src/game/sfx_manifest.generated';
import {
  BREATH_ENTRANCE_ANIMS_URL,
  BREATH_ENTRANCE_CLIPS,
  SMITH_HEART_BOSS_LOOKS,
} from '../src/render/characters/smith_heart_boss_looks';
import { activateGfxProfile, GFX, getActiveGfxProfile } from '../src/render/gfx';
import { BreathEntranceFx } from '../src/render/smith_heart_fx';
import { BREATH_BODY_GESTURES } from '../src/render/smith_heart_fx/breath_body_core';
import {
  AWAKE,
  BOLT_POINTS,
  BREATH_ENTRANCE,
  BREATH_ENTRANCE_DRIFT,
  BREATH_ENTRANCE_GESTURES,
  BREATH_ENTRANCE_HOWL,
  BREATH_ENTRANCE_SOUNDS,
  BREATH_FORM_CLIP,
  BREATH_STORM_SHAPE,
  BREATH_STRIKES,
  boltPoint,
  breathEntranceClock,
  breathEntranceFlash,
  breathEntranceFlicker,
  breathEntranceLight,
  breathEntranceLook,
  breathEntrancePicks,
  breathEntranceShake,
  breathFormScale,
  CRAWLERS,
  crawlerArc,
  crossedBreathBeat,
  DORMANT,
  funnelRadius,
  HANGING_STONE,
  hangingAt,
  newBreathEntranceLook,
  newFlyingPiece,
  ORBIT_STONE,
  orbitAt,
  REDUCED_LIGHT_CAP,
  STONE_FLUNG_FOR,
  stepBreathEntranceTime,
  strikeLight,
} from '../src/render/smith_heart_fx/breath_entrance_core';
import { breathEntranceFor } from '../src/render/smith_heart_fx/breath_entrance_state';
import { BREATH, SMITH_HEART_BOSS_SPOTS } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { BREATH_AURAS, BREATH_GUARDIAN } from '../src/sim/encounters/smith_heart/breath_ids';
import {
  BREATH_INTRO,
  BREATH_INTRO_STAGES,
} from '../src/sim/encounters/smith_heart/breath_intro_plan';
import type { Entity } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const E = BREATH_ENTRANCE;
const G = BREATH_ENTRANCE_GESTURES;
const SH = BREATH_STORM_SHAPE;
const waking = (t: number) => ({
  id: BREATH_AURAS.intro,
  value: BREATH_INTRO_STAGES.waking,
  remaining: BREATH_INTRO.seconds - t,
  duration: BREATH_INTRO.seconds,
});
const asleep = {
  id: BREATH_AURAS.intro,
  value: BREATH_INTRO_STAGES.dormant,
  remaining: 3600,
  duration: 3600,
};
const look = (t: number) => breathEntranceLook(t);

describe('the clock', () => {
  it('reads dormant, waking with its time, or nothing off the guardian', () => {
    expect(breathEntranceClock([asleep]).stage).toBe('dormant');
    const w = breathEntranceClock([waking(4.25)]);
    expect(w.stage).toBe('waking');
    expect(w.t).toBeCloseTo(4.25, 6);
    expect(breathEntranceClock([]).stage).toBe('none');
    expect(breathEntranceClock([{ ...waking(3), id: 'other' }]).stage).toBe('none');
  });

  it('runs smooth on the aura, never backward, snaps on a drift, bursts at once when cut short, and a late joiner past it sees it floating', () => {
    const w = (t: number) => ({ stage: 'waking' as const, t });
    const none = { stage: 'none' as const, t: 0 };
    expect(stepBreathEntranceTime(AWAKE, 0.05, { stage: 'dormant', t: 0 })).toBe(DORMANT);
    // A late joiner starts where the scene is.
    expect(stepBreathEntranceTime(DORMANT, 0.05, w(5))).toBe(5);
    expect(stepBreathEntranceTime(AWAKE, 0.05, w(5))).toBe(5);
    expect(stepBreathEntranceTime(5, 0.05, w(5.05))).toBeCloseTo(5.05, 6);
    // Ahead of the aura by more than the drift: hold.
    expect(stepBreathEntranceTime(5.4, 0.05, w(5))).toBe(5.4);
    // Behind by more than the drift: snap.
    expect(stepBreathEntranceTime(5, 0.05, w(5 + BREATH_ENTRANCE_DRIFT + 0.2))).toBeCloseTo(
      5 + BREATH_ENTRANCE_DRIFT + 0.2,
      6,
    );
    // Cut short before the burst: the burst at once.
    expect(stepBreathEntranceTime(3, 0.05, none)).toBe(E.burstAt);
    // A seen scene runs on to its tail, then awake.
    expect(stepBreathEntranceTime(BREATH_INTRO.seconds, 0.05, none)).toBeCloseTo(
      BREATH_INTRO.seconds + 0.05,
      6,
    );
    expect(stepBreathEntranceTime(E.end - 0.01, 0.05, none)).toBe(AWAKE);
    // Never seen waking: awake.
    expect(stepBreathEntranceTime(AWAKE, 0.05, none)).toBe(AWAKE);
    expect(stepBreathEntranceTime(DORMANT, 0.05, none)).toBe(AWAKE);
  });

  it('a beat plays only for a scene seen crossing it', () => {
    expect(crossedBreathBeat(4.9, 5.0, 4.95)).toBe(true);
    expect(crossedBreathBeat(DORMANT, 5.0, 4.95)).toBe(false);
    expect(crossedBreathBeat(AWAKE, 5.0, 4.95)).toBe(false);
    expect(crossedBreathBeat(5.0, 5.1, 4.95)).toBe(false);
  });
});

describe('the beats', () => {
  it('runs calm, pull, eye, descent, touch, form, burst, strikes, great bolt in order inside 10 to 13 s', () => {
    expect(BREATH_INTRO.seconds).toBeGreaterThanOrEqual(10);
    expect(BREATH_INTRO.seconds).toBeLessThanOrEqual(13);
    expect(E.calmTo).toBeGreaterThan(1);
    expect(E.pullAt).toBeGreaterThanOrEqual(E.calmTo - 1e-9);
    expect(E.descendFrom).toBeGreaterThan(E.pullAt + 2);
    expect(E.touchAt).toBeGreaterThan(E.descendFrom);
    expect(E.formAt).toBeGreaterThan(E.touchAt);
    // Whole just before the burst (inside the funnel).
    expect(E.formAt + BREATH_FORM_CLIP.length).toBeLessThanOrEqual(E.burstAt + 1e-9);
    expect(E.burstAt).toBeGreaterThan(E.touchAt + 2);
    expect(E.finalAt).toBeGreaterThan(E.burstAt + 1.5);
    expect(E.finalAt).toBeLessThan(BREATH_INTRO.seconds - 0.5);
    // Every strike inside the scene, sorted; the great bolt the last.
    for (let i = 1; i < BREATH_STRIKES.length; i++)
      expect(BREATH_STRIKES[i].at).toBeGreaterThan(BREATH_STRIKES[i - 1].at);
    expect(BREATH_STRIKES.at(-1)?.kind).toBe('guardian');
    expect(BREATH_STRIKES.find((s) => s.kind === 'axis')?.at).toBe(E.touchAt);
    // Strikes round the guardian after the burst, before the great bolt.
    const finale = BREATH_STRIKES.filter((s) => s.at > E.burstAt && s.kind === 'ground');
    expect(finale.length).toBeGreaterThanOrEqual(3);
    for (const s of finale) expect(s.r).toBeGreaterThan(6);
  });

  it('every sound is a shipped Breath sample on a beat inside the scene (no voice), the howl a loop', () => {
    const keys = new Set<string>(SFX_FIXED_CATALOG_KEYS);
    for (const s of BREATH_ENTRANCE_SOUNDS) {
      expect(keys.has(s.key), s.key).toBe(true);
      expect(s.key.startsWith('heart_breath_')).toBe(true);
      expect(s.at).toBeGreaterThanOrEqual(0);
      expect(s.at).toBeLessThan(BREATH_INTRO.seconds);
    }
    expect(keys.has(BREATH_ENTRANCE_HOWL.key)).toBe(true);
    // A thunder on every strike onto the floor and the great bolt.
    for (const s of BREATH_STRIKES.filter((x) => x.kind !== 'axis'))
      expect(
        BREATH_ENTRANCE_SOUNDS.some((x) => x.at === s.at && x.key === 'heart_breath_strike'),
      ).toBe(true);
    expect(BREATH_ENTRANCE_SOUNDS.some((x) => x.at === E.burstAt)).toBe(true);
  });
});

describe('the look', () => {
  it('waiting: the dead calm, the hanging stone, a faint smudge in the sky, nothing of the guardian', () => {
    const l = look(DORMANT);
    expect(l.active).toBe(true);
    expect(l.dormant).toBe(true);
    expect(l.stance).toBe('gathered');
    expect(l.body).toBe(0);
    expect(l.calm).toBe(1);
    expect(l.eye).toBeGreaterThan(0.1);
    expect(l.eye).toBeLessThan(0.35);
    expect(l.eyeR).toBe(SH.eyeSmudgeR);
    expect(l.funnel).toBe(0);
    expect(l.howl).toBe(0);
    expect(l.flicker).toBe(0);
  });

  it('the pull: the calm breaks, the eye swells, the howl rises', () => {
    const a = look(E.pullAt - 0.1);
    const b = look(E.eyeFull);
    expect(a.calm).toBeGreaterThan(0.9);
    expect(look(E.pullAt + 1).calm).toBeLessThan(0.05);
    expect(b.eye).toBeGreaterThan(a.eye + 0.5);
    expect(b.eyeR).toBeCloseTo(SH.eyeR, 3);
    expect(look(E.descendFrom).howl).toBeGreaterThan(0.7);
    expect(look(E.pullAt + 0.5).howl).toBeLessThan(look(E.pullAt + 2).howl);
  });

  it('the funnel comes down onto the floor, crackling, the stone orbiting it, the guardian forming inside', () => {
    expect(look(E.descendFrom - 0.01).reach).toBe(0);
    const mid = look((E.descendFrom + E.touchAt) / 2);
    expect(mid.reach).toBeGreaterThan(0.2);
    expect(mid.reach).toBeLessThan(0.8);
    expect(look(E.touchAt).reach).toBeCloseTo(1, 6);
    expect(look(E.touchAt + 1).funnel).toBeCloseTo(1, 6);
    expect(look(E.touchAt + 1).orbit).toBeCloseTo(1, 6);
    let flick = 0;
    for (let t = E.touchAt + 0.1; t < E.burstAt; t += 0.05)
      flick = Math.max(flick, look(t).flicker);
    expect(flick).toBeGreaterThan(0.7);
    expect(look(E.formAt - 0.05).stance).toBe('gathered');
    expect(look(E.formAt + 0.05).stance).toBe('form');
    expect(look(E.formAt + 0.1).body).toBeLessThan(0.1);
    expect(look(E.burstAt).body).toBeCloseTo(1, 6);
  });

  it('the burst: the funnel blown apart, the ring of gust racing out past the raid, the flash; the howl cut', () => {
    const l = look(E.burstAt + E.burstFor);
    expect(l.burst).toBeCloseTo(1, 6);
    expect(l.funnel).toBeCloseTo(0, 6);
    expect(look(E.burstAt + 0.05).flash).toBeGreaterThan(0.5);
    // The ring reaches the climb's top where the raid stands.
    let maxR = 0;
    for (let t = E.burstAt; t < E.burstAt + E.ringFor; t += 0.05)
      maxR = Math.max(maxR, look(t).ringR);
    expect(maxR).toBeGreaterThan(BREATH_INTRO.reach);
    expect(look(E.burstAt + E.ringFor + 0.1).ring).toBe(0);
    expect(look(E.burstAt + 0.6).howl).toBe(0);
    expect(look(E.burstAt + 0.3).orbit).toBe(0);
  });

  it('the great bolt flashes on the guardian; the eye thins after; awake once the scene is over', () => {
    expect(look(E.finalAt + 0.05).flash).toBeGreaterThan(0.4);
    expect(look(E.finalAt + 0.05).flicker).toBeGreaterThan(0.7);
    expect(look(E.end - 0.1).eye).toBeLessThan(look(E.burstAt).eye);
    const l = look(AWAKE);
    expect(l.active).toBe(false);
    expect(l.body).toBe(1);
    expect(l.stance).toBe('stand');
    expect(look(E.end).active).toBe(false);
  });

  it('reduced motion: no thud and no flash, the added light capped; the thud falls off with distance', () => {
    const l = look(E.burstAt + 0.05);
    expect(breathEntranceFlash(l, false)).toBeGreaterThan(0.5);
    expect(breathEntranceFlash(l, true)).toBe(0);
    expect(breathEntranceLight(1.6, true)).toBe(REDUCED_LIGHT_CAP);
    expect(breathEntranceLight(0.3, true)).toBe(0.3);
    expect(breathEntranceShake(1, 10, true)).toBe(0);
    expect(breathEntranceShake(1, 10, false)).toBeGreaterThan(breathEntranceShake(1, 60, false));
    expect(breathEntranceShake(1, E.shakeReach, false)).toBe(0);
  });

  it('reduced motion: the cloud light never flickers (no crackle, no re-strike)', () => {
    // Count the light's rises over the scene: a flicker rises many times a
    // second; the steady envelope rises once per strike at most.
    const rises = (reduced: boolean) => {
      let n = 0;
      let prev = 0;
      for (let t = 0; t < BREATH_INTRO.seconds; t += 1 / 60) {
        const v = breathEntranceFlicker(look(t), reduced);
        if (v > prev + 0.05) n++;
        prev = v;
      }
      return n;
    };
    expect(rises(false)).toBeGreaterThan(BREATH_STRIKES.length * 2);
    expect(rises(true)).toBeLessThanOrEqual(BREATH_STRIKES.length);
    for (let t = 0; t < BREATH_INTRO.seconds; t += 0.05)
      expect(breathEntranceFlicker(look(t), true)).toBeLessThanOrEqual(REDUCED_LIGHT_CAP);
  });

  it('a strike re-strikes and fades within its life', () => {
    const s = BREATH_STRIKES[0];
    expect(strikeLight(s, s.at - 0.01)).toBe(0);
    expect(strikeLight(s, s.at)).toBeCloseTo(1, 6);
    expect(strikeLight(s, s.at + 0.6)).toBe(0);
  });

  it('is deterministic and allocation free in place', () => {
    const out = newBreathEntranceLook();
    const a = breathEntranceLook(7.3, out);
    expect(a).toBe(out);
    expect(JSON.stringify(breathEntranceLook(7.3))).toBe(JSON.stringify(a));
  });
});

describe('the plans', () => {
  it('the hanging stone lies over the Cornice off the guardian, and is drawn up into the eye and swallowed', () => {
    const mid = {
      x: BREATH.cornice.x - SMITH_HEART_BOSS_SPOTS.breath.x,
      z: BREATH.cornice.z - SMITH_HEART_BOSS_SPOTS.breath.z,
    };
    expect(HANGING_STONE.length).toBeGreaterThan(100);
    const out = newFlyingPiece();
    for (const p of HANGING_STONE) {
      expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(7);
      expect(
        Math.hypot((p.x - mid.x) / BREATH.cornice.rx, (p.z - mid.z) / BREATH.cornice.rz),
      ).toBeLessThan(1);
      // Hangs still in the calm.
      const calm = hangingAt(p, { t: 0, dormant: true }, 0, out);
      expect(calm.size).toBe(p.size);
      expect(calm.y).toBeGreaterThan(0.2);
      // Gone into the eye by the touch.
      const gone = hangingAt(p, { t: E.touchAt, dormant: false }, 0, out);
      expect(gone.size).toBeLessThan(0.02);
      // Halfway, it is higher and nearer the axis than it hung.
      const k = E.pullAt + p.delay + p.travel * 0.7;
      const mid2 = hangingAt(p, { t: k, dormant: false }, 0, out);
      expect(mid2.y).toBeGreaterThan(p.y + 3);
      expect(Math.hypot(mid2.x, mid2.z)).toBeLessThan(Math.hypot(p.x, p.z));
    }
  });

  it('the orbiting stone circles outside the funnel, then is flung out past it and gone', () => {
    const out = newFlyingPiece();
    for (const p of ORBIT_STONE) {
      const o = orbitAt(p, { t: E.touchAt + 1, orbit: 1, sinceBurst: -1 }, out);
      expect(Math.hypot(o.x, o.z)).toBeGreaterThan(funnelRadius(p.h));
      expect(o.size).toBeCloseTo(p.size, 6);
      const r0 = Math.hypot(o.x, o.z);
      const f = orbitAt(p, { t: E.burstAt + 0.8, orbit: 0, sinceBurst: 0.8 }, out);
      expect(Math.hypot(f.x, f.z)).toBeGreaterThan(r0 + 8);
      expect(orbitAt(p, { t: 20, orbit: 0, sinceBurst: STONE_FLUNG_FOR + 0.1 }, out).size).toBe(0);
    }
  });

  it('a bolt is pinned at both ends and jagged between; a re-strike is a new shape', () => {
    const a = { x: 0, y: 0, z: 0 };
    const first = boltPoint(7, 0, 1, 40, 2, 10, 0, 5, 0.13, a);
    expect([first.x, first.y, first.z]).toEqual([1, 40, 2]);
    const last = boltPoint(7, BOLT_POINTS - 1, 1, 40, 2, 10, 0, 5, 0.13, { ...a });
    expect(last.x).toBeCloseTo(10, 6);
    expect(last.y).toBeCloseTo(0, 6);
    const m1 = boltPoint(7, 10, 1, 40, 2, 10, 0, 5, 0.13, { ...a });
    const m2 = boltPoint(8, 10, 1, 40, 2, 10, 0, 5, 0.13, { ...a });
    expect(Math.hypot(m1.x - m2.x, m1.z - m2.z)).toBeGreaterThan(0.01);
  });

  it('the crawlers re-strike every beat on the funnel, inside its height', () => {
    const arc = { seed: 0, h0: 0, h1: 0, a0: 0, a1: 0, light: 0 };
    const seeds = new Set<number>();
    for (let c = 0; c < CRAWLERS; c++) {
      for (let t = 6; t < 8; t += 0.1) {
        crawlerArc(c, t, arc);
        expect(arc.h0).toBeGreaterThanOrEqual(0);
        expect(arc.h1).toBeLessThanOrEqual(1);
        expect(arc.h1).toBeGreaterThan(arc.h0);
        seeds.add(arc.seed);
      }
    }
    expect(seeds.size).toBeGreaterThan(CRAWLERS * 5);
  });

  it('the funnel widens from its foot to the eye', () => {
    expect(funnelRadius(0)).toBeCloseTo(SH.rBot, 6);
    expect(funnelRadius(1)).toBeCloseTo(SH.rTop, 6);
    expect(funnelRadius(0.5)).toBeGreaterThan(SH.rBot);
    expect(SH.funnelH).toBeLessThan(SH.eyeH);
  });

  it('the low tier keeps a whole share of every plan', () => {
    const low = breathEntrancePicks(HANGING_STONE.length, false);
    expect(low.length).toBeLessThan(HANGING_STONE.length);
    expect(low.length).toBeGreaterThan(20);
    expect(breathEntrancePicks(ORBIT_STONE.length, true)).toHaveLength(ORBIT_STONE.length);
  });
});

describe('the entrance clips', () => {
  it('ship in their own GLB (Gathered, Form), off the rig Idle, bound as its stances', async () => {
    const io = createGlbIO();
    const doc = await io.read(`public/${BREATH_ENTRANCE_ANIMS_URL}`);
    const root = doc.getRoot();
    expect(root.listAnimations().map((a) => a.getName())).toEqual([...BREATH_ENTRANCE_CLIPS]);
    expect(root.listMeshes()).toHaveLength(0);
    // Gathered: the root drawn down to a speck.
    const gathered = samplePose(indexClip(root, 'Gathered'), 0.5).get('root|scale') as number[];
    expect(gathered[0]).toBeLessThan(0.01);
    // Form: its length, growing from its first share to whole.
    const form = indexClip(root, 'Form');
    const scale = form.get('root|scale');
    expect(scale?.times.at(-1)).toBeCloseTo(BREATH_FORM_CLIP.length, 3);
    const s0 = (samplePose(form, 0).get('root|scale') as number[])[0];
    const s1 = (samplePose(form, BREATH_FORM_CLIP.length).get('root|scale') as number[])[0];
    expect(s0).toBeCloseTo(breathFormScale(0), 2);
    expect(s1).toBeCloseTo(1, 2);
    const look = SMITH_HEART_BOSS_LOOKS.smith_heart_breath_guardian;
    expect(look.animUrls).toContain(BREATH_ENTRANCE_ANIMS_URL);
    expect(look.phaseClips?.[G.gathered]?.clips.idle).toBe('Gathered');
    expect(look.phaseClips?.[G.form]?.enter).toBe('Form');
    expect(look.phaseClips?.[G.form]?.clips).toBe(look.clips);
    expect(look.oneShotsHoldAttacks).toContain('Form');
  });
});

describe('BreathEntranceFx over a fake world', () => {
  function rig(opts: { reduced?: boolean } = {}) {
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
    const spot = SMITH_HEART_BOSS_SPOTS.breath;
    const entity = (id: number, kind: string, templateId: string, x: number, z: number) =>
      ({
        id,
        kind,
        templateId,
        name: templateId,
        pos: { x: o.x + x, y: 0, z: o.z + z },
        prevPos: { x: o.x + x, y: 0, z: o.z + z },
        facing: -1.6,
        scale: 3.4,
        hp: 100,
        maxHp: 100,
        dead: false,
        auras: [] as Entity['auras'],
      }) as unknown as Entity;
    const entities = new Map<number, Entity>();
    const me = entity(1, 'player', 'warrior', spot.x - 50, spot.z - 2);
    const b = entity(2, 'mob', BREATH_GUARDIAN, spot.x, spot.z);
    for (const e of [me, b]) entities.set(e.id, e);
    const world = {
      entities,
      player: me,
      playerId: me.id,
      entityRosterVersion: 1,
    } as unknown as IWorld;
    const scene = new THREE.Scene();
    const shakes: number[] = [];
    const sent: { id: number; g: string }[] = [];
    const fx = new BreathEntranceFx(
      scene,
      () => 0,
      world,
      undefined,
      () => opts.reduced === true,
      (a) => shakes.push(a),
      (id, gesture) => sent.push({ id, g: gesture }),
    );
    const aura = (a: ReturnType<typeof waking> | typeof asleep | null) => {
      b.auras.length = 0;
      if (a) b.auras.push({ ...a } as unknown as Entity['auras'][number]);
    };
    return { scene, fx, b, aura, shakes, sent };
  }
  const visible = (scene: THREE.Scene, name: string) => {
    let v = false;
    scene.traverse((o) => {
      if (o.name !== name) return;
      let p: THREE.Object3D | null = o;
      let all = true;
      while (p && p !== scene) {
        if (!p.visible) all = false;
        p = p.parent;
      }
      v ||= all;
    });
    return v;
  };
  const NAMES = [
    'smithHeartBreathEntranceHanging',
    'smithHeartBreathEntranceEye',
    'smithHeartBreathEntranceEyeHigh',
    'smithHeartBreathEntranceFunnel',
    'smithHeartBreathEntranceFunnelHeart',
    'smithHeartBreathEntranceOrbit',
    'smithHeartBreathEntranceBolts',
    'smithHeartBreathEntranceBoltGlows',
    'smithHeartBreathEntranceGust',
    'smithHeartBreathEntranceFlash',
  ];
  function play(r: ReturnType<typeof rig>, from = 0, cut = Number.POSITIVE_INFINITY) {
    const seen = new Set<string>();
    let maxBolts = 0;
    let heldAsleep = false;
    if (from === 0) {
      r.aura(asleep);
      r.fx.update(0.3);
      r.fx.update(1 / 20);
      for (const n of NAMES) if (visible(r.scene, n)) seen.add(`asleep:${n}`);
      heldAsleep = breathEntranceFor(r.b.id)?.body === 0;
    }
    const dt = 1 / 20;
    let t = from;
    while (t < Math.min(cut, BREATH_INTRO.seconds) - 1e-6) {
      r.aura(waking(t));
      r.fx.update(dt);
      t += dt;
      maxBolts = Math.max(maxBolts, r.fx.bolts.liveBolts());
      for (const n of NAMES) if (visible(r.scene, n)) seen.add(n);
    }
    r.aura(null);
    for (let k = 0; k < (E.end + 1) / dt && r.fx.currentLook.active; k++) {
      r.fx.update(dt);
      maxBolts = Math.max(maxBolts, r.fx.bolts.liveBolts());
      for (const n of NAMES) if (visible(r.scene, n)) seen.add(n);
    }
    return { seen, maxBolts, heldAsleep };
  }
  const count = (r: ReturnType<typeof rig>, g: string) => r.sent.filter((x) => x.g === g).length;

  it('plays the whole scene: gathered (re-sent, its air held off), the Form once, the thuds, every piece, then its calm stance and awake', () => {
    const r = rig();
    const { seen, maxBolts, heldAsleep } = play(r);
    expect(seen.has('asleep:smithHeartBreathEntranceHanging')).toBe(true);
    expect(seen.has('asleep:smithHeartBreathEntranceEye')).toBe(true);
    expect(seen.has('asleep:smithHeartBreathEntranceFunnel')).toBe(false);
    expect(heldAsleep).toBe(true);
    expect(r.sent[0].g).toBe(G.gathered);
    expect(count(r, G.gathered)).toBeGreaterThan(10);
    expect(count(r, G.form)).toBe(1);
    const form = r.sent.findIndex((x) => x.g === G.form);
    expect(r.sent[form].id).toBe(r.b.id);
    expect(r.sent.slice(form).some((x) => x.g === G.gathered)).toBe(false);
    // Its own calm stance handed back once the scene is over.
    expect(r.sent.at(-1)?.g).toBe(BREATH_BODY_GESTURES.calm);
    // A strike and its forks at once, the crawlers.
    expect(maxBolts).toBeGreaterThanOrEqual(3);
    // The thuds: the touch, the strikes, the burst (the heaviest), the bolt.
    expect(Math.max(...r.shakes)).toBeGreaterThan(1);
    expect(r.shakes.length).toBeGreaterThanOrEqual(BREATH_STRIKES.length);
    for (const n of NAMES) expect(seen.has(n), n).toBe(true);
    expect(r.fx.currentLook.active).toBe(false);
    expect(breathEntranceFor(r.b.id)).toBeNull();
    expect(visible(r.scene, 'smithHeartBreathEntranceFunnel')).toBe(false);
    r.fx.dispose();
  });

  it('a joiner after the Form plays no Form and no thud it missed; one after the scene sees it floating', () => {
    const r = rig();
    play(r, E.burstAt + 0.3);
    expect(count(r, G.form)).toBe(0);
    expect(count(r, G.gathered)).toBe(0);
    // Only the thuds still ahead of it: the finale's strikes and the bolt.
    const ahead = BREATH_STRIKES.filter((s) => s.at > E.burstAt + 0.3).length;
    expect(r.shakes.length).toBe(ahead);
    r.fx.dispose();
    const late = rig();
    late.aura(null);
    for (let i = 0; i < 40; i++) late.fx.update(1 / 20);
    expect(late.sent).toHaveLength(0);
    expect(late.fx.currentLook.active).toBe(false);
    late.fx.dispose();
  });

  it('a scene cut short before the burst bursts at once (the Form sent, no storm before it)', () => {
    const r = rig();
    const { seen } = play(r, 0, 3);
    expect(count(r, G.form)).toBe(1);
    expect(seen.has('smithHeartBreathEntranceGust')).toBe(true);
    expect(seen.has('smithHeartBreathEntranceFunnel')).toBe(false);
    expect(r.fx.currentLook.active).toBe(false);
    r.fx.dispose();
  });

  it('under reduced motion the whole scene plays with no thud and no flash, its light capped', () => {
    const r = rig({ reduced: true });
    const { seen } = play(r);
    expect(r.shakes).toHaveLength(0);
    expect(seen.has('smithHeartBreathEntranceFlash')).toBe(false);
    for (const n of NAMES.filter((x) => x !== 'smithHeartBreathEntranceFlash'))
      expect(seen.has(n), n).toBe(true);
    expect(count(r, G.form)).toBe(1);
    r.fx.dispose();
    const calm = rig({ reduced: true });
    const uniforms = (name: string) =>
      ((calm.scene.getObjectByName(name) as THREE.Mesh).material as THREE.ShaderMaterial).uniforms;
    let t = E.touchAt - 0.2;
    let lit = 0;
    calm.aura(waking(t));
    calm.fx.update(0.3);
    while (t < E.burstAt) {
      calm.aura(waking(t));
      calm.fx.update(1 / 20);
      t += 1 / 20;
      lit = Math.max(lit, uniforms('smithHeartBreathEntranceFunnel').uFlash.value);
    }
    expect(lit).toBeGreaterThan(0.2);
    expect(lit).toBeLessThanOrEqual(REDUCED_LIGHT_CAP);
    calm.fx.dispose();
  });

  it('builds every resource up front behind its gate: no light, nothing built while it plays, disposed once', async () => {
    let gated: THREE.Object3D | null = null;
    let release = () => {};
    const gate = (target: THREE.Object3D) => {
      gated = target;
      return new Promise<void>((r) => {
        release = r;
      });
    };
    const r = rig();
    r.fx.dispose();
    const scene = new THREE.Scene();
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
    const spot = SMITH_HEART_BOSS_SPOTS.breath;
    const b = {
      id: 2,
      kind: 'mob',
      templateId: BREATH_GUARDIAN,
      pos: { x: o.x + spot.x, y: 0, z: o.z + spot.z },
      facing: 0,
      dead: false,
      auras: [] as Entity['auras'],
    } as unknown as Entity;
    const me = { ...b, id: 1, kind: 'player', templateId: 'warrior' } as unknown as Entity;
    me.pos = { x: o.x + spot.x - 50, y: 0, z: o.z + spot.z };
    const world = {
      entities: new Map<number, Entity>([
        [1, me],
        [2, b],
      ]),
      playerId: 1,
      entityRosterVersion: 1,
    } as unknown as IWorld;
    const fx = new BreathEntranceFx(scene, () => 0, world, gate);
    const root = scene.getObjectByName('smith-heart-breath-entrance');
    expect(root).toBeDefined();
    expect(gated).toBe(root);
    let lights = 0;
    root?.traverse((x) => {
      if ((x as THREE.Light).isLight) lights++;
    });
    expect(lights).toBe(0);
    const geos = fx.geometries.length;
    const mats = fx.materials.length;
    release();
    await fx.readyForEntry;
    let t = 0;
    while (t < BREATH_INTRO.seconds) {
      b.auras.length = 0;
      b.auras.push(waking(t) as unknown as Entity['auras'][number]);
      fx.update(1 / 20);
      t += 1 / 20;
    }
    expect(fx.geometries.length).toBe(geos);
    expect(fx.materials.length).toBe(mats);
    const disposed: unknown[] = [];
    for (const m of fx.materials) m.addEventListener('dispose', () => disposed.push(m));
    fx.dispose();
    fx.dispose();
    expect(disposed).toHaveLength(mats);
    expect(scene.getObjectByName('smith-heart-breath-entrance')).toBeUndefined();
  });

  it('the low tier plays every beat with less flying stone', () => {
    const original = getActiveGfxProfile();
    const n = (r: ReturnType<typeof rig>, name: string) =>
      (r.scene.getObjectByName(name) as THREE.InstancedMesh).count;
    try {
      activateGfxProfile({ ...original, settings: { ...GFX, tier: 'low' } });
      const low = rig();
      const lowCounts = ['smithHeartBreathEntranceHanging', 'smithHeartBreathEntranceOrbit'].map(
        (x) => n(low, x),
      );
      const { seen } = play(low);
      for (const name of NAMES) expect(seen.has(name), name).toBe(true);
      expect(count(low, G.form)).toBe(1);
      low.fx.dispose();
      activateGfxProfile(original);
      const full = rig();
      const fullCounts = ['smithHeartBreathEntranceHanging', 'smithHeartBreathEntranceOrbit'].map(
        (x) => n(full, x),
      );
      for (let i = 0; i < 2; i++) expect(lowCounts[i]).toBeLessThan(fullCounts[i]);
      full.fx.dispose();
    } finally {
      activateGfxProfile(original);
    }
  });
});
