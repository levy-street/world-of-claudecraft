// The Masterless Strength's arrival (Jose's approved concept, 2026-11-09):
// the boss dormant on its knee like a cracked statue, the four veins' light
// running across the floor to it, one giant beam into the sky, the beam
// falling back into it, the boss rising and roaring
// (src/render/smith_heart_fx/final_arrival_core.ts; painted by
// final_arrival_beam.ts, the body by final_body_fx.ts, hosted by final_fx.ts):
//   - the timeline's beats in order and inside the approved length;
//   - the veins' colours, paths and running fronts; the beam's phases; the
//     sky's flare; the altars dim round the statue;
//   - the body's stance, dark cracks and aura through the scene, and a late
//     arrival seeing it standing;
//   - the sim's two arrival lines on the scene's beats;
//   - FinalFx over a fake world: the whole scene played live (the stance and
//     glow gestures in order, the streams and the beam shown in their
//     windows, the room's light memory written), a late arrival standing
//     with no scene, a pull running the scene to its end;
//   - the old flying-rock rebuild gone.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { GlowPulse } from '../src/render/characters/glow_pulse';
import { glowPulseLevel, glowPulseShade } from '../src/render/characters/glow_pulse_core';
import { SMITH_HEART_BOSS_LOOKS } from '../src/render/characters/smith_heart_boss_looks';
import { gfxInternalsForTest, sharedUniforms } from '../src/render/gfx';
import {
  clearHeartArrivalLightForTest,
  heartArrivalFlare,
  heartArrivalVein,
} from '../src/render/smith_heart/heart_arrival_light_core';
import { heartSealSlotKey, observeHeartSealMask } from '../src/render/smith_heart/heart_seal_core';
import { FinalFx } from '../src/render/smith_heart_fx';
import {
  ARRIVAL,
  ARRIVAL_BEAM,
  ARRIVAL_BEAM_FALL,
  ARRIVAL_BEAM_PEAK,
  ARRIVAL_CONVERGE,
  ARRIVAL_END,
  ARRIVAL_IGNITE,
  ARRIVAL_KNEEL_HEIGHT,
  ARRIVAL_RISE_AT,
  ARRIVAL_ROAR_AT,
  ARRIVAL_SKIP_SECONDS,
  ARRIVAL_VEINS,
  ARRIVAL_VOICE,
  ARRIVAL_WAVE_AT,
  arrivalAltarLevel,
  arrivalBeam,
  arrivalBodyStage,
  arrivalDark,
  arrivalForming,
  arrivalHeightShare,
  arrivalSkyFlare,
  arrivalStance,
  arrivalStreamLevel,
  arrivalStreamPath,
  arrivalStreamPointAt,
  arrivalVeinArrive,
  arrivalVeinColor,
  arrivalVeinFront,
  arrivalVeinStart,
} from '../src/render/smith_heart_fx/final_arrival_core';
import {
  FINAL_BODY_CLIP,
  FINAL_BODY_GESTURES,
  FINAL_ELEMENT_LOOK,
} from '../src/render/smith_heart_fx/final_body_core';
import { FinalBodyFx, type FinalBodyHost } from '../src/render/smith_heart_fx/final_body_fx';
import * as finalFxCore from '../src/render/smith_heart_fx/final_fx_core';
import { FINAL_BOSS } from '../src/render/smith_heart_fx/final_fx_core';
import { EngineParticles } from '../src/render/trash_engine_fx/engine_particles';
import {
  HEART_ALTARS,
  HEART_ROOM,
  SMITH_HEART_BOSS_SPOTS,
} from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  SMITH_HEART_AWAKE_BIT,
  SMITH_HEART_PORTAL_BIT,
  SMITH_HEART_SEAL_FULL,
} from '../src/sim/encounters/smith_heart';
import { ARRIVAL_LINE_AT } from '../src/sim/encounters/smith_heart/final_voice';
import type { Entity } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

describe("the arrival's timeline", () => {
  it('runs its beats in order, inside the approved 8 to 12 seconds', () => {
    const beats = [
      0,
      arrivalVeinStart(0),
      arrivalVeinArrive(0),
      ARRIVAL_CONVERGE,
      ARRIVAL_BEAM_PEAK,
      ARRIVAL_BEAM_FALL,
      ARRIVAL_IGNITE,
      ARRIVAL_RISE_AT,
      ARRIVAL_ROAR_AT,
      ARRIVAL_WAVE_AT,
      ARRIVAL_END,
    ];
    for (let i = 1; i < beats.length; i++)
      expect(beats[i], `beat ${i}`).toBeGreaterThan(beats[i - 1]);
    expect(ARRIVAL_END).toBeGreaterThanOrEqual(8);
    expect(ARRIVAL_END).toBeLessThanOrEqual(12);
    // The veins all reach the boss by the convergence, the last exactly on it.
    for (let i = 0; i < ARRIVAL_VEINS.length; i++)
      expect(arrivalVeinArrive(i)).toBeLessThanOrEqual(ARRIVAL_CONVERGE + 1e-9);
    // The roar's wave rides its Shift clip's burst beat; the push takes the
    // Rise clip's whole length.
    expect(ARRIVAL_WAVE_AT - ARRIVAL_ROAR_AT).toBeCloseTo(FINAL_BODY_CLIP.shiftBurst, 9);
    expect(ARRIVAL_ROAR_AT - ARRIVAL_RISE_AT).toBeCloseTo(ARRIVAL.riseSeconds, 9);
    expect(ARRIVAL.riseSeconds).toBe(2.4);
  });

  it('lights the four veins in their element colours, each down its groove to the boss', () => {
    expect([...ARRIVAL_VEINS].sort()).toEqual(['breath', 'hammer', 'heat', 'quench']);
    const colours = new Set(ARRIVAL_VEINS.map(arrivalVeinColor));
    expect(colours.size).toBe(4);
    for (const v of ARRIVAL_VEINS) {
      expect(arrivalVeinColor(v)).toBe(FINAL_ELEMENT_LOOK[v].light);
      const p = arrivalStreamPath(v);
      const altar = HEART_ALTARS.find((a) => a.vein === v);
      if (!altar) throw new Error(v);
      expect(Math.hypot(p.from.x - altar.x, p.from.z - altar.z)).toBeLessThan(4);
      const boss = SMITH_HEART_BOSS_SPOTS.final;
      expect(Math.hypot(p.to.x - boss.x, p.to.z - boss.z)).toBeLessThan(3);
      expect(Math.hypot(p.to.x - p.from.x, p.to.z - p.from.z)).toBeGreaterThan(40);
      // It spirals in (the grooves' curl), so its run is well past the chord.
      expect(p.length).toBeGreaterThan(Math.hypot(p.to.x - p.from.x, p.to.z - p.from.z) * 1.1);
      // The point at a share of the run walks from its altar's foot to the boss.
      const at = { x: 0, z: 0 };
      expect(arrivalStreamPointAt(p, 0, at)).toEqual(p.from);
      arrivalStreamPointAt(p, 1, at);
      expect(Math.hypot(at.x - p.to.x, at.z - p.to.z)).toBeLessThan(1e-9);
      let last = Number.POSITIVE_INFINITY;
      for (let k = 0; k <= 1; k += 0.02) {
        arrivalStreamPointAt(p, k, at);
        const r = Math.hypot(at.x - boss.x, at.z - boss.z);
        expect(r).toBeLessThanOrEqual(last + 1e-6);
        last = r;
      }
    }
    // The four arms run the same length (one symmetric spiral).
    const lengths = ARRIVAL_VEINS.map((v) => arrivalStreamPath(v).length);
    for (const l of lengths) expect(l).toBeCloseTo(lengths[0], 6);
  });

  it('keeps the convergence and the voice beats where they stood with the longer spiral', () => {
    // The spiral's run took its time from the veins' stagger, not from the
    // scene: the streams still meet 3.65 s in and the roar lands on 9.45.
    expect(ARRIVAL_CONVERGE).toBeCloseTo(3.65, 9);
    expect(ARRIVAL_ROAR_AT).toBeCloseTo(9.45, 9);
    expect(ARRIVAL.veinRun).toBeGreaterThan(2);
  });

  it("runs each vein's front from its altar to the boss, never back", () => {
    for (let i = 0; i < ARRIVAL_VEINS.length; i++) {
      expect(arrivalVeinFront(arrivalVeinStart(i) - 0.01, i)).toBe(-1);
      expect(arrivalStreamLevel(arrivalVeinStart(i) - 0.01, i)).toBe(0);
      let last = 0;
      for (let t = arrivalVeinStart(i); t <= ARRIVAL_END; t += 0.05) {
        const f = arrivalVeinFront(t, i);
        expect(f).toBeGreaterThanOrEqual(last - 1e-9);
        expect(f).toBeLessThanOrEqual(1);
        last = f;
      }
      expect(arrivalVeinFront(arrivalVeinArrive(i), i)).toBeCloseTo(1, 9);
      // Burning while the beam stands, drawn out of the floor after the ignite.
      expect(arrivalStreamLevel(ARRIVAL_BEAM_PEAK, i)).toBeCloseTo(1, 6);
      expect(arrivalStreamLevel(ARRIVAL_IGNITE + 0.5, i)).toBe(0);
    }
  });

  it('erupts the beam at the convergence, holds it tall, sinks its top into the chest', () => {
    const chest = 12 / ARRIVAL_BEAM.height;
    expect(arrivalBeam(ARRIVAL_CONVERGE - 0.01, chest).phase).toBe('off');
    expect(arrivalBeam(ARRIVAL_CONVERGE + 0.1, chest).phase).toBe('rise');
    const peak = arrivalBeam((ARRIVAL_BEAM_PEAK + ARRIVAL_BEAM_FALL) / 2, chest);
    expect(peak.phase).toBe('peak');
    expect(peak.top).toBe(1);
    expect(peak.width).toBe(1);
    // It towers over the arena: far taller than the room is wide.
    expect(ARRIVAL_BEAM.height).toBeGreaterThan(HEART_ROOM.r * 3);
    let top = 1;
    for (let t = ARRIVAL_BEAM_FALL; t < ARRIVAL_IGNITE; t += 0.02) {
      const b = arrivalBeam(t, chest);
      expect(b.phase).toBe('fall');
      expect(b.top).toBeLessThanOrEqual(top + 1e-9);
      expect(b.top).toBeGreaterThanOrEqual(chest - 1e-9);
      top = b.top;
    }
    expect(top).toBeLessThan(chest + 0.02);
    expect(arrivalBeam(ARRIVAL_IGNITE, chest).phase).toBe('off');
  });

  it('flares the sky with the beam and lets it go after; the altars dim round the statue', () => {
    expect(arrivalSkyFlare(ARRIVAL_CONVERGE - 0.01)).toBe(0);
    expect(arrivalSkyFlare(ARRIVAL_BEAM_PEAK)).toBeCloseTo(1, 6);
    expect(arrivalSkyFlare(ARRIVAL_END)).toBe(0);
    for (let i = 0; i < ARRIVAL_VEINS.length; i++) {
      expect(arrivalAltarLevel(-1, i)).toBeLessThan(0.3);
      expect(arrivalAltarLevel(0, i)).toBeLessThan(0.3);
      expect(arrivalAltarLevel(arrivalVeinStart(i) + 0.6, i)).toBeCloseTo(1, 6);
      expect(arrivalAltarLevel(ARRIVAL_END, i)).toBeCloseTo(1, 6);
    }
  });
});

describe('the body through the arrival', () => {
  it('kneels dormant and dark, lights at the ignite, pushes up, roars, stands', () => {
    expect(arrivalStance(-1, false, false)).toBe('dormant');
    expect(arrivalStance(0, false, false)).toBe('dormant');
    expect(arrivalStance(ARRIVAL_RISE_AT - 0.01, false, false)).toBe('dormant');
    expect(arrivalStance(ARRIVAL_RISE_AT, false, false)).toBe('rise');
    expect(arrivalStance(ARRIVAL_ROAR_AT, false, false)).toBe('stand');
    // The false death's kneel wins; a corpse stands (its Death clip).
    expect(arrivalStance(ARRIVAL_END + 50, false, true)).toBe('kneel');
    expect(arrivalStance(0, true, false)).toBe('stand');
    expect(arrivalDark(0, false)).toBe(true);
    expect(arrivalDark(ARRIVAL_IGNITE - 0.01, false)).toBe(true);
    expect(arrivalDark(ARRIVAL_IGNITE, false)).toBe(false);
    expect(arrivalDark(0, true)).toBe(false);
    expect(arrivalForming(ARRIVAL_ROAR_AT - 0.01, false)).toBe(true);
    expect(arrivalForming(ARRIVAL_ROAR_AT, false)).toBe(false);
    expect(arrivalBodyStage(0)).toBe('dormant');
    expect(arrivalBodyStage(ARRIVAL_IGNITE)).toBe('waking');
    expect(arrivalBodyStage(ARRIVAL_RISE_AT)).toBe('rising');
    expect(arrivalBodyStage(ARRIVAL_ROAR_AT)).toBe('roaring');
    expect(arrivalBodyStage(ARRIVAL_END)).toBe('awake');
    expect(arrivalHeightShare(0, false)).toBe(ARRIVAL_KNEEL_HEIGHT);
    expect(arrivalHeightShare(ARRIVAL_ROAR_AT, false)).toBe(1);
  });

  it('a late arrival (first seen long awake) finds it standing, lit and whole', () => {
    const late = ARRIVAL_END + 30;
    expect(arrivalStance(late, false, false)).toBe('stand');
    expect(arrivalDark(late, false)).toBe(false);
    expect(arrivalForming(late, false)).toBe(false);
    expect(arrivalBeam(late, 0.1).phase).toBe('off');
    expect(arrivalSkyFlare(late)).toBe(0);
  });

  it("says the sim's two arrival lines on the scene's beats (the whisper, the roar)", () => {
    expect(ARRIVAL_LINE_AT.map((l) => l.moment)).toEqual(['arrivalWake', 'arrivalRoar']);
    expect(ARRIVAL_LINE_AT[0].at).toBeCloseTo(ARRIVAL_VOICE.wake, 6);
    expect(ARRIVAL_LINE_AT[1].at).toBeCloseTo(ARRIVAL_VOICE.roar, 6);
    expect(ARRIVAL_VOICE.roar).toBe(ARRIVAL_ROAR_AT);
  });
});

describe('final_body_fx.ts through the arrival', () => {
  const host = (): FinalBodyHost => ({
    particles: new EngineParticles(
      new THREE.Group(),
      { value: 0 },
      1,
      () => 0,
      () => 0.5,
      () => false,
      null,
    ),
    density: 1,
    flash: () => {},
    shakeNear: () => {},
    rand: () => 0.5,
    groundY: () => 0,
  });
  const boss = {
    id: 7,
    pos: { x: 0, y: 0, z: 0 },
    facing: 0,
    scale: 1,
    auras: [],
  } as unknown as Entity;
  const run = (sent: string[], fx: FinalBodyFx, from: number, to: number) => {
    for (let t = from; t <= to; t += 0.05)
      fx.update({
        boss,
        zone: 'ring',
        whole: t >= ARRIVAL_WAVE_AT,
        forming: arrivalForming(t, false),
        stance: arrivalStance(t, false, false),
        dark: arrivalDark(t, false),
        dead: false,
        clock: t,
        dt: 0.05,
      });
    return sent;
  };

  it('holds the cracks black, then flares them, pushes up and roars, in that order', () => {
    const sent: string[] = [];
    const fx = new FinalBodyFx(new THREE.Group(), host(), (_id, g) => sent.push(g));
    run(sent, fx, 0, ARRIVAL_END);
    const G = FINAL_BODY_GESTURES;
    expect(sent).toContain(G.show);
    expect(sent).not.toContain(G.hide);
    expect(sent).toContain(G.dormant);
    // The dark pulse re-sent through the whole dormant stretch (its 0.6 s
    // hold never lapses), and never after the ignite.
    const darks = sent.filter((g) => g === G.dark).length;
    expect(darks).toBeGreaterThanOrEqual(Math.floor(ARRIVAL_IGNITE / 0.6));
    const lastDark = sent.lastIndexOf(G.dark);
    const flare = sent.indexOf(G.charge, lastDark);
    const rise = sent.indexOf(G.rise);
    const roar = sent.indexOf(G.shift);
    expect(sent.indexOf(G.dormant)).toBeLessThan(lastDark);
    expect(flare).toBeGreaterThan(lastDark);
    expect(rise).toBeGreaterThan(flare);
    expect(roar).toBeGreaterThan(rise);
    expect(sent.filter((g) => g === G.rise).length).toBe(1);
    expect(sent.filter((g) => g === G.shift).length).toBe(1);
  });

  it('a late arrival: standing at once, no dark stone, no push, no roar', () => {
    const sent: string[] = [];
    const fx = new FinalBodyFx(new THREE.Group(), host(), (_id, g) => sent.push(g));
    run(sent, fx, ARRIVAL_END + 20, ARRIVAL_END + 22);
    const G = FINAL_BODY_GESTURES;
    expect(sent).toContain(G.stand);
    for (const g of [G.dormant, G.dark, G.rise, G.shift]) expect(sent).not.toContain(g);
  });
});

describe('FinalFx plays the arrival', () => {
  afterEach(() => {
    clearHeartArrivalLightForTest();
    sharedUniforms.uTime.value = 0;
  });

  function setup(seenWaking: boolean, awake = true) {
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
    const key = heartSealSlotKey(o.x, o.z);
    const entities = new Map<number, Entity>();
    const mk = (id: number, kind: Entity['kind'], templateId: string, x: number, z: number) =>
      ({
        id,
        kind,
        templateId,
        name: templateId,
        pos: { x, y: 0, z },
        prevPos: { x, y: 0, z },
        facing: 0.6,
        scale: 1,
        hp: 100,
        maxHp: 100,
        dead: false,
        inCombat: false,
        auras: [],
        castingAbility: null,
        castRemaining: 0,
        castTotal: 0,
      }) as unknown as Entity;
    const me = mk(1, 'player', 'warrior', o.x + HEART_ROOM.x - 60, o.z + HEART_ROOM.z - 60);
    const boss = mk(2, 'mob', FINAL_BOSS, o.x + HEART_ROOM.x, o.z + HEART_ROOM.z);
    entities.set(me.id, me);
    entities.set(boss.id, boss);
    const world = { entities, player: me, playerId: me.id } as unknown as IWorld;
    const scene = new THREE.Scene();
    const sent: string[] = [];
    let shaken = 0;
    const fx = new FinalFx(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      (a) => {
        shaken += a;
      },
      (_id, g) => sent.push(g),
    );
    const base = SMITH_HEART_SEAL_FULL | SMITH_HEART_PORTAL_BIT;
    // A fresh slot memory per test: the clock far from any earlier test's.
    const t0 = seenWaking ? 1000 : 5000;
    sharedUniforms.uTime.value = t0;
    if (seenWaking || !awake) observeHeartSealMask(key, base, t0);
    if (awake) observeHeartSealMask(key, base | SMITH_HEART_AWAKE_BIT, t0);
    const step = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 20); i++) {
        sharedUniforms.uTime.value += 0.05;
        fx.update(0.05);
      }
    };
    return { scene, fx, boss, sent, key, step, shaken: () => shaken };
  }

  const shown = (scene: THREE.Scene, name: string) => {
    const o = scene.getObjectByName(name);
    let v = !!o;
    for (let p: THREE.Object3D | null | undefined = o; p; p = p.parent) v = v && p.visible;
    return v;
  };

  it('plays live: veins, beam, collapse, rise, roar, and the room lit through it', () => {
    const s = setup(true);
    s.step(0.6);
    // Dormant: the statue, the altars dim, nothing running yet.
    expect(heartArrivalVein(s.key, 'hammer')).toBeLessThan(0.3);
    expect(shown(s.scene, 'smithHeartArrivalSwirl')).toBe(false);
    s.step(arrivalVeinStart(3) + 0.5 - 0.6);
    expect(shown(s.scene, 'smithHeartArrivalStreams')).toBe(true);
    expect(heartArrivalVein(s.key, 'hammer')).toBeGreaterThan(0.95);
    s.step(ARRIVAL_BEAM_PEAK + 0.3 - (arrivalVeinStart(3) + 0.5));
    expect(shown(s.scene, 'smithHeartArrivalSwirl')).toBe(true);
    expect(shown(s.scene, 'smithHeartArrivalCore')).toBe(true);
    expect(heartArrivalFlare(s.key)).toBeGreaterThan(0.8);
    expect(s.shaken()).toBeGreaterThan(0);
    s.step(ARRIVAL_END + 0.5 - (ARRIVAL_BEAM_PEAK + 0.3));
    expect(shown(s.scene, 'smithHeartArrivalSwirl')).toBe(false);
    const G = FINAL_BODY_GESTURES;
    const rise = s.sent.indexOf(G.rise);
    expect(rise).toBeGreaterThan(-1);
    expect(s.sent.indexOf(G.dormant)).toBeLessThan(rise);
    expect(s.sent.indexOf(G.dark)).toBeLessThan(rise);
    expect(s.sent.indexOf(G.shift)).toBeGreaterThan(rise);
    // Over: the room as it always is.
    expect(heartArrivalVein(s.key, 'hammer')).toBe(1);
    expect(heartArrivalFlare(s.key)).toBe(0);
    s.fx.dispose();
  });

  it('a late arrival sees it standing: no veins, no beam, no push', () => {
    const s = setup(false);
    s.step(3);
    const G = FINAL_BODY_GESTURES;
    expect(s.sent).toContain(G.stand);
    for (const g of [G.dormant, G.dark, G.rise]) expect(s.sent).not.toContain(g);
    expect(shown(s.scene, 'smithHeartArrivalStreams')).toBe(false);
    expect(shown(s.scene, 'smithHeartArrivalSwirl')).toBe(false);
    s.fx.dispose();
  });

  it('a pull during the scene runs it on to its end at once', () => {
    const s = setup(true);
    s.step(2);
    expect(s.sent).not.toContain(FINAL_BODY_GESTURES.shift);
    s.boss.inCombat = true;
    s.step(ARRIVAL_SKIP_SECONDS + 0.3);
    expect(s.sent).toContain(FINAL_BODY_GESTURES.shift);
    expect(shown(s.scene, 'smithHeartArrivalSwirl')).toBe(false);
    s.fx.dispose();
  });
});

describe('FinalFx never fights a dormant statue', () => {
  afterEach(() => {
    clearHeartArrivalLightForTest();
    sharedUniforms.uTime.value = 0;
  });

  function boot(awake: boolean) {
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
    const key = heartSealSlotKey(o.x, o.z);
    const entities = new Map<number, Entity>();
    const mk = (id: number, kind: Entity['kind'], templateId: string, x: number, z: number) =>
      ({
        id,
        kind,
        templateId,
        name: templateId,
        pos: { x, y: 0, z },
        prevPos: { x, y: 0, z },
        facing: 0.6,
        scale: 1,
        hp: 100,
        maxHp: 100,
        dead: false,
        inCombat: false,
        auras: [],
        castingAbility: null,
        castRemaining: 0,
        castTotal: 0,
      }) as unknown as Entity;
    const me = mk(1, 'player', 'warrior', o.x + HEART_ROOM.x - 60, o.z + HEART_ROOM.z - 60);
    const boss = mk(2, 'mob', FINAL_BOSS, o.x + HEART_ROOM.x, o.z + HEART_ROOM.z);
    entities.set(me.id, me);
    entities.set(boss.id, boss);
    const world = { entities, player: me, playerId: me.id } as unknown as IWorld;
    const scene = new THREE.Scene();
    const sent: string[] = [];
    const fx = new FinalFx(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      () => {},
      (_i, g) => sent.push(g),
    );
    const base = SMITH_HEART_SEAL_FULL | SMITH_HEART_PORTAL_BIT;
    const t0 = awake ? 9000 : 9500;
    sharedUniforms.uTime.value = t0;
    observeHeartSealMask(key, base, t0);
    if (awake) observeHeartSealMask(key, base | SMITH_HEART_AWAKE_BIT, t0);
    const step = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 20); i++) {
        sharedUniforms.uTime.value += 0.05;
        fx.update(0.05);
      }
    };
    return { scene, fx, boss, sent, step };
  }

  it('fought with no arrival in view (the bit out of interest), it stands lit and whole', () => {
    const s = boot(false);
    s.boss.inCombat = true;
    s.step(1);
    const G = FINAL_BODY_GESTURES;
    expect(s.sent).toContain(G.stand);
    for (const g of [G.dormant, G.dark, G.rise]) expect(s.sent).not.toContain(g);
    s.fx.dispose();
  });

  it('once a pull runs the scene on, a lapse in the fight never runs it back', () => {
    const s = boot(true);
    s.step(1);
    s.boss.inCombat = true;
    s.step(0.3);
    // The fight flickers out (a reset, online a blow's lapse) mid-skip.
    s.boss.inCombat = false;
    s.sent.length = 0;
    s.step(3);
    const G = FINAL_BODY_GESTURES;
    expect(s.sent).not.toContain(G.dormant);
    expect(s.sent).not.toContain(G.dark);
    expect(s.sent).toContain(G.shift);
    s.fx.dispose();
  });

  it('plays the whole scene on the low tier too (only its richness thins)', () => {
    const restore = gfxInternalsForTest.overrideSettings({ tier: 'low' });
    try {
      const s = boot(true);
      s.step(arrivalVeinStart(3) + 0.5);
      const shown = (name: string) => {
        const o = s.scene.getObjectByName(name);
        let v = !!o;
        for (let p: THREE.Object3D | null | undefined = o; p; p = p.parent) v = v && p.visible;
        return v;
      };
      expect(shown('smithHeartArrivalStreams')).toBe(true);
      s.step(ARRIVAL_BEAM_PEAK + 0.3 - (arrivalVeinStart(3) + 0.5));
      expect(shown('smithHeartArrivalSwirl')).toBe(true);
      expect(shown('smithHeartArrivalCore')).toBe(true);
      // The sky billboards are the cosmetic layer the low tier sheds.
      expect(shown('smithHeartArrivalSheath')).toBe(false);
      s.step(ARRIVAL_END);
      const G = FINAL_BODY_GESTURES;
      expect(s.sent).toContain(G.rise);
      expect(s.sent).toContain(G.shift);
      s.fx.dispose();
    } finally {
      restore();
    }
  });
});

describe('the dormant stone (glow pulse shade)', () => {
  const set = SMITH_HEART_BOSS_LOOKS.smith_heart_masterless_strength.glowPulses;
  if (!set) throw new Error('no glow pulses');
  const darkIdx = set.pulses.findIndex((p) => p.gesture === FINAL_BODY_GESTURES.dark);
  const chargeIdx = set.pulses.findIndex((p) => p.gesture === FINAL_BODY_GESTURES.charge);

  it('shades only by pulses that ask, by their envelope, inside 0 to 1', () => {
    const idle = set.pulses.map(() => -1);
    expect(glowPulseShade(set, idle)).toBe(1);
    const charge = set.pulses.map((_, i) => (i === chargeIdx ? 0.5 : -1));
    expect(glowPulseShade(set, charge)).toBe(1);
    const dark = set.pulses.map((_, i) => (i === darkIdx ? 0.1 : -1));
    expect(glowPulseShade(set, dark)).toBeCloseTo(0.1, 6);
    expect(glowPulseLevel(set, dark, -1)).toBeCloseTo(0, 6);
    const both = set.pulses.map((_, i) => (i === darkIdx ? 0.1 : i === chargeIdx ? 0.6 : -1));
    const s = glowPulseShade(set, both);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
    expect(
      glowPulseShade(
        { pulses: [{ gesture: 'x', rise: 0, hold: 1, fall: 1, peak: 1, shade: -3 }] },
        [0],
      ),
    ).toBe(0);
  });

  it('holds the statue dark and still while the dark gesture is re-sent (no strobe)', () => {
    const pulse = new GlowPulse(set);
    const levels: number[] = [];
    let since = 0;
    pulse.handle(FINAL_BODY_GESTURES.dark);
    for (let f = 0; f < 120; f++) {
      since += 1 / 60;
      if (since >= 0.35) {
        since = 0;
        pulse.handle(FINAL_BODY_GESTURES.dark);
      }
      pulse.step(1 / 60, false);
      levels.push(pulse.scale);
    }
    expect(Math.max(...levels)).toBeLessThan(0.02);
    // The dark pulse rises at once and holds past a re-send, even on a slow
    // frame: a re-send never lets the stone flash back to its colour.
    const dark = set.pulses[darkIdx];
    expect(dark.rise).toBe(0);
    expect(dark.hold).toBeGreaterThan(0.35 + 0.25);
  });
});

describe('the old flying-rock rebuild is gone', () => {
  it('leaves no piece, tear, lock or fly path behind', () => {
    for (const name of [
      'COLOSSUS_PIECES',
      'colossusTearAt',
      'colossusLockAt',
      'colossusPiecePhase',
      'colossusFlyPoint',
      'colossusFallPlan',
      'heartArrivalPoint',
      'ARRIVAL',
    ])
      expect(name in finalFxCore, name).toBe(false);
    const src = readFileSync('src/render/smith_heart_fx/final_fx.ts', 'utf8');
    for (const word of ['poseArrival', 'Kit_Col', 'riseBeam', 'updateThreads', 'pieceDrawnIn'])
      expect(src.includes(word), word).toBe(false);
  });
});
