// The Islands of the Wind's 50 percent phase look (src/render/smith_heart_fx/
// breath_isle_phase_core.ts and its painters, hosted by breath_isles_fx.ts):
// Skyrend Nova grows with the guardian's own bar (never a clock of its own),
// its seals run to the two Stillstones and break as each is stilled, the
// endings differ in size; each Closing Storm closes on the isle's own rim
// shape off the template's whole seconds, smoothed between updates and
// turning violet near the end; the Stillstone reads its four states; the
// Herald's lane and the Shieldbearer's ward are the sim's exact numbers; and
// the painter over a fake world shows each piece on its cue and claims the
// phase's cues.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BREATH_NOVA_HUM,
  BREATH_SFX_KEYS,
  novaHumGain,
} from '../src/game/smith_heart_breath_audio_core';
import { BreathFightFx } from '../src/render/smith_heart_fx/breath_fight_fx';
import { beamHalf, beamLift } from '../src/render/smith_heart_fx/breath_isle_adds_fx';
import {
  CLOSING_MIN,
  COCOON_ENDS,
  closingLook,
  closingParts,
  END_RING,
  endLook,
  endRing,
  NOVA_SHAPE,
  novaCharge,
  novaLook,
  RECKONING_SECONDS,
  reckoningBolts,
  SHARDS,
  SHOVE_LANE,
  STILLSTONE,
  STILLSTONE_ISLES,
  sealArc,
  sealEnd,
  sealLives,
  shardAt,
  stepClosingClock,
  stoneLook,
  stoneState,
  wardHalfArc,
} from '../src/render/smith_heart_fx/breath_isle_phase_core';
import { isleRimAt } from '../src/render/smith_heart_fx/breath_isles_fx_core';
import { BREATH, BREATH_ISLES } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { BREATH_GUARDIAN } from '../src/sim/encounters/smith_heart/breath_ids';
import { isleAt, isleSpots } from '../src/sim/encounters/smith_heart/breath_isle_geometry';
import {
  closingTemplate,
  ISLE_AURAS,
  ISLE_CASTS,
  ISLE_CUES,
  ISLE_MOBS,
  ISLE_TUNING,
  padTemplate,
} from '../src/sim/encounters/smith_heart/breath_isle_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

describe('breath_isle_phase_core: the cocoon and the nova', () => {
  it('reads the nova off its bar and grows with it, never with the clock', () => {
    expect(novaCharge(150, 150)).toBe(0);
    expect(novaCharge(75, 150)).toBeCloseTo(0.5, 9);
    expect(novaCharge(0, 150)).toBe(1);
    expect(novaCharge(5, 0)).toBe(0);
    let last = -1;
    for (let c = 0; c <= 1.0001; c += 0.05) {
      const a = novaLook(c, 0);
      const b = novaLook(c, 37.3);
      // The clock throbs its light, never its size.
      expect(a.radius).toBe(b.radius);
      expect(a.radius).toBeGreaterThan(last);
      last = a.radius;
      // It hangs over the guardian, never swallowing its cocoon (one radius).
      expect(a.lift - a.radius).toBeGreaterThan(1);
    }
    expect(novaLook(0, 0).radius).toBeCloseTo(NOVA_SHAPE.r0, 9);
    expect(novaLook(1, 0).radius).toBeCloseTo(NOVA_SHAPE.r1, 9);
    // The sky darkens and the hum rises as it gathers; the violet and the
    // tremble only near its end.
    expect(novaLook(1, 0).sky).toBeGreaterThan(novaLook(0, 0).sky + 0.4);
    expect(novaLook(1, 0).hum).toBeGreaterThan(novaLook(0, 0).hum);
    expect(novaLook(0.5, 0).hot).toBe(0);
    expect(novaLook(1, 0).hot).toBe(1);
    expect(novaLook(0.8, 0).tremble).toBe(0);
    expect(novaLook(1, 0).tremble).toBeGreaterThan(0);
  });

  it("runs a seal to each chain's Stillstone, high over the void, broken as each is stilled", () => {
    expect(STILLSTONE_ISLES).toEqual([2, 5]);
    for (const side of [0, 1] as const) {
      const e = sealEnd(side);
      const i = side * 3 + 2;
      const sp = isleSpots()[i];
      expect(BREATH_ISLES[i].side).toBe(side);
      // On its isle's own floor, over its stone spot, at the crystal's hover.
      expect(isleAt(e.x, e.z)).toBe(i);
      expect(e.x).toBeCloseTo(sp.stone?.x ?? Number.NaN, 9);
      expect(e.y).toBeCloseTo(sp.h + STILLSTONE.hover, 9);
      const a = { x: BREATH.cornice.x, y: BREATH.cornice.h + 20, z: BREATH.cornice.z };
      const s0 = sealArc(a, e, 0);
      const s1 = sealArc(a, e, 1);
      expect([s0.x, s0.y, s0.z]).toEqual([a.x, a.y, a.z]);
      expect(s1.x).toBeCloseTo(e.x, 9);
      expect(s1.y).toBeCloseTo(e.y, 9);
      // Lifted at its middle over the straight line.
      const mid = sealArc(a, e, 0.5);
      expect(mid.y).toBeGreaterThan((a.y + e.y) / 2 + 5);
    }
    expect(sealLives(0, [false, false])).toEqual([1, 1]);
    // A stone seen stilled breaks its own seal, whatever the count says.
    expect(sealLives(1, [false, true])).toEqual([1, 0]);
    expect(sealLives(1, [true, false])).toEqual([0, 1]);
    // A count past the stones seen breaks the rest, east first.
    expect(sealLives(1, [false, false])).toEqual([0, 1]);
    expect(sealLives(2, [false, true])).toEqual([0, 0]);
    expect(sealLives(2, [false, false])).toEqual([0, 0]);
  });

  it('shatters the cocoon in a flash, and the nova blasts far wider and longer', () => {
    expect(COCOON_ENDS.blast).toBeGreaterThan(COCOON_ENDS.shatter);
    const s = endLook(COCOON_ENDS.shatter * 0.99, false);
    const b = endLook(COCOON_ENDS.blast * 0.99, true);
    expect(b.wave).toBeGreaterThan(s.wave * 2);
    expect(endLook(0.06, true).flash).toBeCloseTo(1, 6);
    expect(endLook(2, false).flash).toBe(0);
    expect(endLook(1, false).left).toBe(0);
    expect(endLook(0, true).sky).toBeGreaterThan(0.5);
  });

  it('bows Mending Gale low and slim between bodies side by side, high only across the isle', () => {
    // Shoulder to shoulder: a low bow, never the tall loop of a fixed lift.
    expect(beamLift(1)).toBeLessThan(1.5);
    expect(beamHalf(1)).toBeLessThan(0.6);
    // Across the isle: the high arch, capped.
    expect(beamLift(12)).toBe(7);
    expect(beamHalf(12)).toBe(1.25);
    for (let d = 0; d < 20; d += 0.5) {
      expect(beamLift(d + 0.5)).toBeGreaterThanOrEqual(beamLift(d));
      expect(beamHalf(d + 0.5)).toBeGreaterThanOrEqual(beamHalf(d));
    }
  });

  it("flings the shatter's shards on falling arcs and races a ring over the floor", () => {
    const o = { x: 0, y: 0, z: 0, spin: 0, size: 0, life: 0 };
    for (let j = 0; j < SHARDS.count; j++) {
      const a = { ...shardAt(j, 0.2, o) };
      const b = { ...shardAt(j, 1.6, o) };
      // Outward over time, and coming down again (gravity), then gone.
      expect(Math.hypot(b.x, b.z)).toBeGreaterThan(Math.hypot(a.x, a.z));
      let peak = Number.NEGATIVE_INFINITY;
      for (let t = 0; t < SHARDS.seconds; t += 0.05) peak = Math.max(peak, shardAt(j, t, o).y);
      expect(shardAt(j, SHARDS.seconds - 0.01, o).y).toBeLessThan(peak - 1);
      expect(shardAt(j, SHARDS.seconds, o).life).toBe(0);
      // Splinters and chips, never boulders (sizes are cocoon radii).
      expect(a.size).toBeGreaterThan(0);
      expect(a.size).toBeLessThanOrEqual(j % 2 === 0 ? 0.1 : 0.065);
    }
    // A fast ring: it reaches its end in its seconds and fades out.
    expect(endRing(END_RING.blast.seconds, true).r).toBeCloseTo(END_RING.blast.reach, 6);
    expect(endRing(END_RING.blast.seconds, true).glow).toBe(0);
    expect(END_RING.blast.reach).toBeGreaterThan(END_RING.shatter.reach * 2);
    // The blast's flash is short: gone within half a second.
    expect(endLook(0.5, true).flash).toBe(0);
    expect(endLook(COCOON_ENDS.blast * 0.7, true).sky).toBeLessThan(0.1);
  });

  it('hums the nova in every ear, rising with it, from a sample the catalog holds', () => {
    expect(novaHumGain(0)).toBe(0);
    expect(novaHumGain(1)).toBeCloseTo(BREATH_NOVA_HUM.gain, 9);
    expect(novaHumGain(0.9)).toBeGreaterThan(novaHumGain(0.3));
    expect(BREATH_SFX_KEYS).toContain(BREATH_NOVA_HUM.key);
  });
});

describe('breath_isle_phase_core: the Closing Storm', () => {
  it("knows a Closing Storm's template and runs its clock smoothly in the sim's window", () => {
    expect(closingParts(closingTemplate(4, 37, 50))).toEqual({ isle: 4, left: 37, whole: 50 });
    expect(closingParts(padTemplate(-1, 0))).toBeNull();
    expect(closingParts(closingTemplate(BREATH_ISLES.length, 3, 50))).toBeNull();
    // A fresh storm starts at its whole; the clock runs down with the frame
    // and never leaves (left - 1, left].
    let rem = stepClosingClock(Number.NaN, 50, 0.05);
    expect(rem).toBe(50);
    for (let i = 0; i < 40; i++) rem = stepClosingClock(rem, 50, 0.05);
    expect(rem).toBe(49);
    rem = stepClosingClock(rem, 49, 0.05);
    expect(rem).toBeCloseTo(48.95, 9);
    // A jump (a late joiner, a new storm) resets to the sim's own count.
    expect(stepClosingClock(48.9, 30, 0.05)).toBe(30);
    expect(stepClosingClock(0.02, 0, 0.05)).toBe(0);
  });

  it('closes from the rim toward the middle, white blue turning violet near the end', () => {
    expect(closingLook(50, 50, 0).k).toBe(1);
    expect(closingLook(0, 50, 0).k).toBeCloseTo(CLOSING_MIN, 9);
    let k = 2;
    for (let r = 50; r >= 0; r -= 2.5) {
      const L = closingLook(r, 50, 0);
      expect(L.k).toBeLessThan(k);
      k = L.k;
    }
    expect(closingLook(50, 50, 0).violet).toBe(0);
    expect(closingLook(0, 50, 0).violet).toBe(1);
    expect(closingLook(0, 50, 0).wall).toBeGreaterThan(closingLook(50, 50, 0).wall);
    expect(closingLook(0, 50, 0).dark).toBeGreaterThan(closingLook(50, 50, 0).dark);
  });

  it("draws its ring on each isle's own rim (the sim's floor), never over the void", () => {
    BREATH_ISLES.forEach((isle, i) => {
      for (let d = 0; d < 360; d += 7.5) {
        const a = (d * Math.PI) / 180;
        const r = isleRimAt(i, a);
        // The ring at every share it closes through stands on the floor.
        for (const k of [CLOSING_MIN, 0.5, 0.95]) {
          const x = isle.x + Math.sin(a) * r * k;
          const z = isle.z + Math.cos(a) * r * k;
          expect(isleAt(x, z), `${i} ${d} ${k}`).toBe(i);
        }
      }
    });
  });

  it("breaks Sky's Reckoning over the isle in a burst of bolts that flickers out", () => {
    expect(reckoningBolts(0.05)).toBeGreaterThan(reckoningBolts(1));
    expect(reckoningBolts(RECKONING_SECONDS + 0.1)).toBe(0);
    expect(reckoningBolts(-1)).toBe(0);
  });
});

describe('breath_isle_phase_core: the Stillstone and the adds', () => {
  it('reads the stone dormant, awake, channelled and stilled', () => {
    expect(stoneState(null, false)).toBe('dormant');
    expect(stoneState({ auras: [] }, false)).toBe('awake');
    expect(stoneState({ auras: [] }, true)).toBe('channel');
    expect(stoneState({ auras: [{ id: ISLE_AURAS.cocoon }] }, true)).toBe('stilled');
    const dormant = stoneLook('dormant', 1);
    const awake = stoneLook('awake', 1);
    expect(awake.glow).toBeGreaterThan(dormant.glow * 2);
    expect(dormant.cage).toBeGreaterThan(awake.cage);
    expect(stoneLook('channel', 1, 0.9).gold).toBeGreaterThan(stoneLook('channel', 1, 0.1).gold);
    expect(stoneLook('stilled', 1).gold).toBe(1);
    expect(stoneLook('stilled', 1).cage).toBe(0);
    // The crystal floats clear of the floor it stands over.
    expect(STILLSTONE.hover - STILLSTONE.height / 2).toBeGreaterThan(0.5);
  });

  it("draws the Herald's lane and the Shieldbearer's arc at the sim's own numbers", () => {
    expect(SHOVE_LANE.length).toBe(ISLE_TUNING.shoveReach);
    expect(SHOVE_LANE.half).toBe(ISLE_TUNING.shoveHalfWidth);
    expect(wardHalfArc(60)).toBeCloseTo(Math.PI / 3, 9);
    expect(wardHalfArc(70)).toBeCloseTo((70 * Math.PI) / 180, 9);
    expect(wardHalfArc(undefined)).toBeCloseTo(Math.PI / 3, 9);
    expect(wardHalfArc(400)).toBeCloseTo(Math.PI, 9);
  });
});

describe('BreathIslesFx: the 50 percent phase on a fake world', () => {
  const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
  const C = BREATH.cornice;
  function entity(
    id: number,
    kind: Entity['kind'],
    templateId: string,
    x: number,
    z: number,
    y: number = C.h,
  ): Entity {
    return {
      id,
      kind,
      templateId,
      name: templateId,
      pos: { x: o.x + x, y, z: o.z + z },
      prevPos: { x: o.x + x, y, z: o.z + z },
      facing: 0,
      scale: 1,
      hp: 100,
      maxHp: 100,
      dead: false,
      inCombat: true,
      auras: [] as Entity['auras'],
      castingAbility: null as string | null,
      castTargetId: null as number | null,
      castRemaining: 0,
      castTotal: 0,
    } as unknown as Entity;
  }
  const shown = (root: THREE.Object3D, name: string) => {
    const out: THREE.Object3D[] = [];
    root.traverse((c) => {
      if (c.name !== name) return;
      let v = true;
      for (let p: THREE.Object3D | null = c; p && p !== root; p = p.parent) v = v && p.visible;
      if (v) out.push(c);
    });
    return out;
  };

  it('grows the nova with its bar, closes the storms, wakes the stones, lays the lane and ward', () => {
    const entities = new Map<number, Entity>();
    const me = entity(1, 'player', 'warrior', C.x - 8, C.z - 6);
    const boss = entity(10, 'mob', BREATH_GUARDIAN, C.x, C.z + 2);
    boss.auras.push({ id: ISLE_AURAS.cocoon, value: 0, value2: 2 } as Entity['auras'][number]);
    boss.castingAbility = ISLE_CASTS.nova;
    boss.castTotal = 150;
    boss.castRemaining = 150;
    const sp = isleSpots();
    const e2 = sp[2];
    const closing = entity(20, 'object', closingTemplate(2, 50, 50), e2.x, e2.z, e2.h);
    const stone = entity(21, 'mob', ISLE_MOBS.stillstone, e2.stone?.x ?? 0, e2.stone?.z ?? 0, e2.h);
    const channeller = entity(2, 'player', 'mage', (e2.stone?.x ?? 0) + 3, e2.stone?.z ?? 0, e2.h);
    const e1 = sp[1];
    const herald = entity(22, 'mob', ISLE_MOBS.herald, e1.x, e1.z, e1.h);
    const e5 = sp[5];
    const shield = entity(23, 'mob', ISLE_MOBS.shieldbearer, e5.x, e5.z, e5.h);
    shield.facing = 1.1;
    shield.auras.push({ id: ISLE_AURAS.ward, value: 0.85, value2: 60 } as Entity['auras'][number]);
    for (const e of [me, boss, closing, stone, channeller, herald, shield]) entities.set(e.id, e);
    const world = {
      entities,
      entityRosterVersion: 1,
      player: me,
      playerId: me.id,
    } as unknown as IWorld & { entityRosterVersion: number };
    const scene = new THREE.Scene();
    const fx = new BreathFightFx(scene, () => C.h, world);
    const root = scene.getObjectByName('smith-heart-breath-fight-fx') as THREE.Object3D;
    for (let i = 0; i < 8; i++) fx.update(1 / 20);
    // The cocoon and the nova over it, small at the start of its bar.
    expect(shown(root, 'smithHeartBreathCocoon')).toHaveLength(1);
    const nova = shown(root, 'smithHeartBreathNova')[0] as THREE.Mesh;
    expect(nova).toBeDefined();
    const small = nova.scale.x;
    expect(nova.position.y).toBeGreaterThan(boss.pos.y + small);
    boss.castRemaining = 15;
    fx.update(1 / 20);
    expect(nova.scale.x).toBeGreaterThan(small * 3);
    // The sky darkens round the Cornice as it gathers.
    for (let i = 0; i < 60; i++) fx.update(1 / 20);
    expect(shown(root, 'smithHeartBreathNovaSky')).toHaveLength(1);
    // The storm on its isle: its ring at the rim, closing as its seconds run.
    const floor = shown(root, 'smithHeartBreathClosingFloor')[0] as THREE.Mesh;
    expect(floor).toBeDefined();
    const uK = (floor.material as THREE.ShaderMaterial).uniforms.uK;
    expect(uK.value).toBeCloseTo(1, 1);
    closing.templateId = closingTemplate(2, 5, 50);
    for (let i = 0; i < 8; i++) fx.update(1 / 20);
    expect(uK.value).toBeLessThan(0.45);
    expect(floor.renderOrder).toBeGreaterThanOrEqual(20);
    // The Stillstone awake, then channelled.
    channeller.castingAbility = ISLE_CASTS.still;
    channeller.castTargetId = stone.id;
    channeller.castTotal = 5;
    channeller.castRemaining = 2;
    for (let i = 0; i < 8; i++) fx.update(1 / 20);
    expect(shown(root, 'smithHeartBreathStillBeam')).toHaveLength(1);
    // The Herald's lane while its bar runs; the ward round the Shieldbearer.
    expect(shown(root, 'smithHeartBreathSquallWard')).toHaveLength(1);
    herald.castingAbility = ISLE_CASTS.shove;
    herald.castTotal = 2.5;
    herald.castRemaining = 1.5;
    for (let i = 0; i < 8; i++) fx.update(1 / 20);
    expect(shown(root, 'smithHeartBreathTelegraph').length).toBeGreaterThanOrEqual(1);
    // The phase's cues are claimed.
    const at = (ability: string, x: number, z: number) =>
      ({
        type: 'spellfxAt',
        x: o.x + x,
        z: o.z + z,
        radius: 3,
        school: 'nature',
        fx: 'burst',
        ability,
      }) as unknown as SimEvent;
    const on = (ability: string, sourceId: number, targetId: number) =>
      ({
        type: 'spellfx',
        sourceId,
        targetId,
        school: 'nature',
        fx: 'beam',
        ability,
      }) as unknown as SimEvent;
    expect(fx.handleEvent(at(ISLE_CUES.padUp, e1.x, e1.z))).toBe(true);
    expect(fx.handleEvent(at(ISLE_CUES.reckoning, e2.x, e2.z))).toBe(true);
    expect(fx.handleEvent(at(ISLE_CUES.split, e1.x, e1.z))).toBe(true);
    expect(fx.handleEvent(on(ISLE_CUES.shoved, herald.id, herald.id))).toBe(true);
    expect(fx.handleEvent(on(ISLE_CUES.stilled, stone.id, boss.id))).toBe(true);
    expect(fx.handleEvent(on(ISLE_CUES.cocoonBreak, boss.id, boss.id))).toBe(true);
    for (let i = 0; i < 10; i++) fx.update(1 / 20);
    // Out of the raid nothing shows.
    me.pos = { x: 0, y: 0, z: 0 };
    fx.update(0.2);
    expect(shown(root, 'smithHeartBreathNova')).toHaveLength(0);
    fx.dispose();
  });
});
