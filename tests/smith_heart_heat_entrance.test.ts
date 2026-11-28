// The Guardian of the Heat's entrance on the client (render/smith_heart_fx/
// heat_entrance_core.ts and heat_entrance_fx.ts): the scene's clock read off
// the guardian's aura (a late joiner starts where the scene is, one that joins
// after sees it burning), every beat on its voice turn (cold coal, the spiral,
// the fire climbing foot to crown, the crown, the anger, the blast's column,
// ring and flash, the tail), the embers and seams on the Hearth's floor, the
// wellspring kindling, and the painter over a fake world (its stage, the
// body's look held for the other painters, the gestures and the thud once on
// their beats and never for a scene joined late, the cold coal given back).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { gfxInternalsForTest } from '../src/render/gfx';
import { HeatEntranceFx } from '../src/render/smith_heart_fx';
import { ENTRANCE_SECONDARY_LAYERS } from '../src/render/smith_heart_fx/entrance_budget_core';
import {
  HEAT_BODY_GESTURES,
  HEAT_BODY_SCALE,
  HEAT_GUARDIAN,
  HEAT_SOCKETS,
  heatSocketIndex,
} from '../src/render/smith_heart_fx/heat_body_core';
import {
  AWAKE,
  COLD,
  CRACK_VERTICES,
  crossedBeat,
  ENTRANCE_CRACKS,
  ENTRANCE_DRIFT,
  ENTRANCE_EMBERS,
  ENTRANCE_LOW_SHARE,
  entranceEmberPicks,
  entranceFlash,
  entranceShake,
  HEAT_ENTRANCE,
  HEAT_ENTRANCE_THROW_AT,
  HEAT_INTRO_VOICE,
  heatEntranceClock,
  heatEntranceLook,
  kindleWellLook,
  newHeatEntranceLook,
  SOCKET_HEIGHT,
  stepEntranceTime,
} from '../src/render/smith_heart_fx/heat_entrance_core';
import { heatEntranceFor } from '../src/render/smith_heart_fx/heat_entrance_state';
import { HEARTH_WELL } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { inHearthFloor } from '../src/sim/encounters/smith_heart/heat_geometry';
import { HEAT_AURAS } from '../src/sim/encounters/smith_heart/heat_ids';
import { HEAT_INTRO, HEAT_INTRO_STAGES } from '../src/sim/encounters/smith_heart/heat_intro_plan';
import type { Entity } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const E = HEAT_ENTRANCE;
const waking = (t: number) => ({
  id: HEAT_AURAS.intro,
  value: HEAT_INTRO_STAGES.waking,
  remaining: HEAT_INTRO.seconds - t,
  duration: HEAT_INTRO.seconds,
});
const cold = {
  id: HEAT_AURAS.intro,
  value: HEAT_INTRO_STAGES.dormant,
  remaining: 3600,
  duration: 3600,
};

describe('the clock', () => {
  it('reads the aura: cold, waking at its scene time, or neither', () => {
    expect(heatEntranceClock([cold])).toEqual({ stage: 'cold', t: 0 });
    expect(heatEntranceClock([waking(4.25)])).toEqual({ stage: 'waking', t: 4.25 });
    expect(heatEntranceClock([])).toEqual({ stage: 'none', t: 0 });
  });

  it('runs smoothly on the aura, starts a late joiner where the scene is, and plays a seen scene to its tail', () => {
    const c = { stage: 'waking' as const, t: 6 };
    // Joined mid-scene: starts at the aura's time.
    expect(stepEntranceTime(AWAKE, 0.05, c)).toBe(6);
    expect(stepEntranceTime(COLD, 0.05, c)).toBe(6);
    // Seen: its own clock, snapped back past the drift.
    expect(stepEntranceTime(6, 0.05, c)).toBeCloseTo(6.05, 9);
    expect(stepEntranceTime(6 - ENTRANCE_DRIFT - 0.1, 0.05, c)).toBe(6);
    // Cold holds cold.
    expect(stepEntranceTime(5, 0.05, { stage: 'cold', t: 0 })).toBe(COLD);
    // The aura gone: a seen scene runs on to its tail, then awake; one never
    // seen (a joiner after the scene) is awake at once.
    const none = { stage: 'none' as const, t: 0 };
    expect(stepEntranceTime(HEAT_INTRO.seconds, 0.05, none)).toBeCloseTo(
      HEAT_INTRO.seconds + 0.05,
      9,
    );
    expect(stepEntranceTime(E.end - 0.01, 0.05, none)).toBe(AWAKE);
    expect(stepEntranceTime(AWAKE, 0.05, none)).toBe(AWAKE);
  });
});

describe('the beats', () => {
  const at = (t: number) => heatEntranceLook(t, newHeatEntranceLook());
  const crown = heatSocketIndex('crown');
  const foot = heatSocketIndex('vortexHigh');
  const shoulder = heatSocketIndex('shoulderL');

  it("rides the voice clip: contempt, anger, the shout, after the sim's speakAt", () => {
    expect(E.crownAt).toBeCloseTo(HEAT_INTRO.speakAt + HEAT_INTRO_VOICE.insects, 9);
    expect(E.rageAt).toBeCloseTo(HEAT_INTRO.speakAt + HEAT_INTRO_VOICE.burning, 9);
    expect(E.blastAt).toBeCloseTo(HEAT_INTRO.speakAt + HEAT_INTRO_VOICE.shout, 9);
    expect(HEAT_INTRO_VOICE.shout).toBeGreaterThan(HEAT_INTRO_VOICE.thenBurn);
    expect(HEAT_INTRO_VOICE.shout).toBeLessThan(HEAT_INTRO_VOICE.end);
    // The guardian is handed back after the blast, the fx's tail after that.
    expect(HEAT_INTRO.seconds).toBeGreaterThan(E.blastAt);
    expect(E.end).toBeGreaterThan(HEAT_INTRO.seconds);
    // The Throw's release lands on the blast.
    expect(HEAT_ENTRANCE_THROW_AT).toBeGreaterThan(E.rageAt);
    expect(HEAT_ENTRANCE_THROW_AT).toBeLessThan(E.blastAt);
  });

  it('cold: grey embers, smoke, the body dark coal with no fire, the wellspring crusted', () => {
    const L = at(COLD);
    expect(L).toMatchObject({ active: true, cold: true, spiral: 0, ash: 1, fire: 0, column: 0 });
    expect(L.socket.every((k) => k === 0)).toBe(true);
    expect(L.glow).toBeLessThan(0.05);
    expect(L.coal).toBeLessThan(0.5);
    expect(L.well).toBeLessThan(0.2);
    expect(L.smoke).toBeGreaterThan(0);
  });

  it('wakes: the spiral runs in, the fire climbs from the foot to the crown', () => {
    const early = at(1.2);
    expect(early.spiral).toBeGreaterThan(0.2);
    expect(early.spiral).toBeLessThan(1);
    expect(early.socket[foot]).toBeGreaterThan(early.socket[crown]);
    expect(SOCKET_HEIGHT[foot]).toBeLessThan(SOCKET_HEIGHT[crown]);
    const lit = at(E.igniteTo + 0.5);
    expect(lit.spiral).toBe(1);
    expect(lit.socket[crown]).toBeGreaterThan(0.9);
    expect(lit.glow).toBeGreaterThan(0.9);
    expect(lit.well).toBeGreaterThan(0.95);
  });

  it('sentence 1 crowns it in flame with a haze and sparks; sentence 2 pours fire off its shoulders and cracks the floor', () => {
    const before = at(E.crownAt - 0.05);
    const s1 = at(E.crownAt + 1.2);
    expect(s1.crown).toBeGreaterThan(0.9);
    expect(s1.haze).toBeGreaterThan(0.5);
    expect(s1.sparks).toBeGreaterThan(0.4);
    expect(s1.socket[crown]).toBeGreaterThan(before.socket[crown] * 2);
    expect(s1.cracks).toBe(0);
    expect(s1.rain).toBe(0);
    const s2 = at(E.rageAt + 2);
    expect(s2.rage).toBeGreaterThan(0.9);
    expect(s2.socket[shoulder]).toBeGreaterThan(s1.socket[shoulder] * 1.8);
    expect(s2.cracks).toBeGreaterThan(0.4);
    expect(s2.rain).toBeGreaterThan(0.3);
    expect(s2.column).toBe(0);
  });

  it('the shout: the column climbs and stands, the ring races out past the raid, one short flash', () => {
    expect(at(E.blastAt - 0.01).column).toBe(0);
    const go = at(E.blastAt + E.columnRise + 0.2);
    expect(go.columnH).toBe(1);
    expect(go.column).toBeGreaterThan(0.7);
    let r = 0;
    let peak = 0;
    for (let s = 0; s < E.ringFor; s += 0.05) {
      const L = at(E.blastAt + s);
      expect(L.ringR).toBeGreaterThanOrEqual(r);
      r = L.ringR;
      peak = Math.max(peak, L.flash);
    }
    expect(r).toBeGreaterThan(E.ringTo * 0.95);
    expect(peak).toBeLessThanOrEqual(E.flashPeak + 1e-9);
    expect(peak).toBeGreaterThan(E.flashPeak * 0.5);
    expect(at(E.blastAt + E.flashFor + 0.01).flash).toBe(0);
    // Every socket roars past its size in the blast and settles back.
    const surge = at(E.blastAt + 0.2);
    expect(surge.socket[foot]).toBeGreaterThan(1.5);
    const settled = at(E.end - 0.05);
    expect(settled.socket[foot]).toBeLessThan(1.1);
    expect(settled.column).toBeLessThan(0.05);
  });

  it("is awake at its tail: no scene, the fight's own look (allocation free)", () => {
    const out = newHeatEntranceLook();
    const a = heatEntranceLook(AWAKE, out);
    expect(a).toBe(out);
    expect(a.active).toBe(false);
    expect(a.socket.every((k) => k === 1)).toBe(true);
    expect(heatEntranceLook(E.end + 1, out).active).toBe(false);
    expect(heatEntranceLook(3, out)).toBe(out);
  });

  it("kindles the wellspring with it, the fight's look untouched once awake", () => {
    const w = { heat: 1, boil: 0.5, pulse: 0.4 };
    kindleWellLook(w, at(COLD));
    expect(w.heat).toBeLessThan(0.2);
    const v = { heat: 1, boil: 0.5, pulse: 0.4 };
    kindleWellLook(v, null);
    expect(v).toEqual({ heat: 1, boil: 0.5, pulse: 0.4 });
  });
});

describe('the one-shots, the flash and the thud', () => {
  it('fire once when crossed, never for a scene joined late or while cold', () => {
    expect(crossedBeat(5, 5.05, 5.02)).toBe(true);
    expect(crossedBeat(5.05, 5.1, 5.02)).toBe(false);
    expect(crossedBeat(AWAKE, 6, 5.02)).toBe(false);
    expect(crossedBeat(COLD, 6, 5.02)).toBe(false);
  });

  it('reduced motion: no flash and no thud; the thud falls off with distance', () => {
    const peak = heatEntranceLook(E.blastAt + 0.05, newHeatEntranceLook());
    expect(entranceFlash(peak, false)).toBeGreaterThan(0);
    expect(entranceFlash(peak, true)).toBe(0);
    expect(entranceShake(10, true)).toBe(0);
    expect(entranceShake(E.shakeReach + 1, false)).toBe(0);
    expect(entranceShake(10, false)).toBeGreaterThan(entranceShake(80, false));
  });

  it('the low tier keeps a whole spiral: every k-th ember, from rim to wellspring', () => {
    const low = entranceEmberPicks(false);
    const high = entranceEmberPicks(true);
    expect(high).toHaveLength(ENTRANCE_EMBERS.length);
    expect(low.length).toBe(Math.round(ENTRANCE_EMBERS.length * ENTRANCE_LOW_SHARE));
    const orders = low.map((i) => ENTRANCE_EMBERS[i].order).filter((o) => o <= 1);
    expect(Math.min(...orders)).toBeLessThan(0.1);
    expect(Math.max(...orders)).toBeGreaterThan(0.9);
  });
});

describe('the embers and the seams', () => {
  it('lie on the Hearth floor round the wellspring, the spiral lit from its rim inward', () => {
    expect(ENTRANCE_EMBERS.length).toBeGreaterThan(800);
    for (const e of ENTRANCE_EMBERS) {
      expect(inHearthFloor(HEARTH_WELL.x + e.x, HEARTH_WELL.z + e.z)).toBe(true);
      expect(Math.hypot(e.x, e.z)).toBeGreaterThan(HEARTH_WELL.r);
    }
    const arm = ENTRANCE_EMBERS.filter((e) => e.order <= 1);
    const first = arm.filter((e) => e.order < 0.2).map((e) => Math.hypot(e.x, e.z));
    const last = arm.filter((e) => e.order > 0.8).map((e) => Math.hypot(e.x, e.z));
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    expect(mean(first)).toBeGreaterThan(mean(last) + 15);
  });

  it('run out from the lip across the floor, revealed outward', () => {
    expect(ENTRANCE_CRACKS.length).toBeGreaterThanOrEqual(15);
    expect(CRACK_VERTICES).toBe(ENTRANCE_CRACKS.reduce((n, l) => n + l.length * 2, 0));
    for (const line of ENTRANCE_CRACKS)
      for (const p of line) {
        expect(inHearthFloor(HEARTH_WELL.x + p.x, HEARTH_WELL.z + p.z)).toBe(true);
        expect(p.reveal).toBeGreaterThanOrEqual(0);
        expect(p.reveal).toBeLessThanOrEqual(1);
      }
    // Each main seam starts at the lip.
    const starts = ENTRANCE_CRACKS.map((l) => Math.hypot(l[0].x, l[0].z));
    expect(Math.min(...starts)).toBeLessThan(HEARTH_WELL.r + 1);
  });
});

describe('HeatEntranceFx over a fake world', () => {
  function rig() {
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
    const entity = (id: number, kind: string, templateId: string, x: number, z: number) =>
      ({
        id,
        kind,
        templateId,
        name: templateId,
        pos: { x: o.x + x, y: 0, z: o.z + z },
        prevPos: { x: o.x + x, y: 0, z: o.z + z },
        facing: 0,
        scale: HEAT_BODY_SCALE,
        hp: 100,
        maxHp: 100,
        dead: false,
        auras: [] as Entity['auras'],
      }) as unknown as Entity;
    const entities = new Map<number, Entity>();
    const me = entity(1, 'player', 'warrior', -170, 0);
    const boss = entity(2, 'mob', HEAT_GUARDIAN, HEARTH_WELL.x, HEARTH_WELL.z);
    entities.set(me.id, me);
    entities.set(boss.id, boss);
    const world = {
      entities,
      player: me,
      playerId: me.id,
      entityRosterVersion: 1,
    } as unknown as IWorld;
    const scene = new THREE.Scene();
    const shakes: number[] = [];
    const sent: string[] = [];
    const fx = new HeatEntranceFx(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      (a) => shakes.push(a),
      (id, g) => {
        expect(id).toBe(boss.id);
        sent.push(g);
      },
    );
    const aura = (a: { id: string; value: number; remaining: number; duration: number } | null) => {
      boss.auras.length = 0;
      if (a) boss.auras.push(a as unknown as Entity['auras'][number]);
    };
    return { scene, fx, boss, aura, shakes, sent };
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

  it('plays the whole scene: cold, the embers, the seams, the gestures and the thud once on their beats, the column, then awake', () => {
    const r = rig();
    r.aura(cold);
    r.fx.update(0.3);
    r.fx.update(1 / 20);
    expect(visible(r.scene, 'smithHeartHeatEntranceEmbers')).toBe(true);
    expect(heatEntranceFor(r.boss.id)?.cold).toBe(true);
    let t = 0;
    const dt = 1 / 20;
    let column = false;
    let seams = false;
    while (t < HEAT_INTRO.seconds - 1e-6) {
      r.aura(waking(t));
      r.fx.update(dt);
      t += dt;
      column ||= visible(r.scene, 'smithHeartHeatEntranceColumn');
      seams ||= visible(r.scene, 'smithHeartHeatEntranceSeams');
    }
    // The aura gone (handed back): the tail plays on, then awake.
    r.aura(null);
    for (let s = 0; s < E.end - HEAT_INTRO.seconds + 0.5; s += dt) r.fx.update(dt);
    expect(column).toBe(true);
    expect(seams).toBe(true);
    expect(r.sent.filter((g) => g === HEAT_BODY_GESTURES.cast)).toHaveLength(1);
    expect(r.sent.filter((g) => g === HEAT_BODY_GESTURES.throw)).toHaveLength(1);
    expect(r.shakes).toHaveLength(1);
    expect(heatEntranceFor(r.boss.id)).toBeNull();
    expect(r.fx.currentLook.active).toBe(false);
    expect(visible(r.scene, 'smithHeartHeatEntranceEmbers')).toBe(false);
    r.fx.dispose();
  });

  it('under reduced motion the whole scene plays with no thud and no flash', () => {
    const r = rig();
    // A rig whose reduced-motion switch is on.
    r.fx.dispose();
    const scene = new THREE.Scene();
    const shakes: number[] = [];
    const fx = new HeatEntranceFx(
      scene,
      () => 0,
      (r.fx as unknown as { world: IWorld }).world,
      undefined,
      () => true,
      (a) => shakes.push(a),
    );
    let t = 0;
    let flashed = false;
    while (t < HEAT_INTRO.seconds - 1e-6) {
      r.aura(waking(t));
      fx.update(1 / 20);
      t += 1 / 20;
      flashed ||= visible(scene, 'smithHeartHeatEntranceFlash');
    }
    expect(fx.currentLook.active).toBe(true);
    expect(shakes).toHaveLength(0);
    expect(flashed).toBe(false);
    fx.dispose();
  });

  it('a joiner after the blast plays no gesture and no thud; one after the scene sees it awake', () => {
    const r = rig();
    r.aura(waking(E.blastAt + 0.4));
    r.fx.update(0.3);
    r.fx.update(1 / 20);
    expect(r.fx.currentLook.active).toBe(true);
    expect(r.shakes).toHaveLength(0);
    expect(r.sent).toHaveLength(0);
    r.fx.dispose();
    const late = rig();
    late.aura(null);
    late.fx.update(0.3);
    late.fx.update(1 / 20);
    expect(late.fx.currentLook.active).toBe(false);
    expect(heatEntranceFor(late.boss.id)).toBeNull();
    late.fx.dispose();
  });

  it('draws its floor pieces on its own ladder rungs and every socket of the body has a plan', () => {
    const r = rig();
    expect(r.scene.getObjectByName('smith-heart-heat-entrance')).toBeDefined();
    expect(newHeatEntranceLook().socket).toHaveLength(HEAT_SOCKETS.length);
    r.fx.dispose();
  });

  it('the low tier plays every beat but sheds the heat haze (entrance_budget_core.ts)', () => {
    const playHaze = () => {
      const r = rig();
      r.aura(cold);
      r.fx.update(0.3);
      let t = 0;
      const dt = 1 / 20;
      let haze = false;
      let column = false;
      while (t < HEAT_INTRO.seconds - 1e-6) {
        r.aura(waking(t));
        r.fx.update(dt);
        t += dt;
        haze ||= visible(r.scene, 'smithHeartHeatEntranceHaze');
        column ||= visible(r.scene, 'smithHeartHeatEntranceColumn');
      }
      r.fx.dispose();
      return { haze, column };
    };
    expect(ENTRANCE_SECONDARY_LAYERS.heat).toContain('smithHeartHeatEntranceHaze');
    const full = playHaze();
    expect(full).toEqual({ haze: true, column: true });
    const restore = gfxInternalsForTest.overrideSettings({ tier: 'low' });
    try {
      expect(playHaze()).toEqual({ haze: false, column: true });
    } finally {
      restore();
    }
  });
});
