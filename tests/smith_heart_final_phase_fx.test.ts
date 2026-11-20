// The Masterless Strength's part 2 look (smith_heart_fx/final_phase_fx_core.ts
// and final_phase_fx.ts):
//   - every part-2 cue is claimed (no generic draw doubles it);
//   - its floor rungs are untied with each other, with FinalKitFx's, with
//     FinalFx's particles and with HeatFx's, which share the Anvil;
//   - a Quenching Ring draws at the sim's own front, its gaps the sim's;
//   - every Splinter's frontal paints in its own element;
//   - the painter over a fake world raises the shield, the sigils, a
//     Shearing Blow cone, a coal's reach and its coal, a ring, the hunt's ring
//     and tether, the poured rings and the fury; claims its cues; raises its
//     columns and its pour; hides out of the Heart; disposes;
//   - the room's floor wakes the quarters of the living Splinters (the
//     phase aura's mask) through a call, all four in the final phase.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TELEGRAPH_THREAT_COLORS } from '../src/render/floor_telegraph';
import {
  heartQuartersModeOf,
  newHeartQuartersState,
  stepHeartQuarters,
} from '../src/render/smith_heart/heart_quarters_core';
import { FinalPhaseFx } from '../src/render/smith_heart_fx';
import {
  FINAL_FX_PARTICLE_RUNGS,
  FINAL_KIT_FLOOR,
  finalKitRungs,
} from '../src/render/smith_heart_fx/final_kit_fx_core';
import {
  FINAL_PHASE_FLOOR,
  finalPhaseClaims,
  finalPhaseMaskOf,
  finalPhaseRungs,
  PHASE_FOOTPRINTS,
  PHASE_REACH,
  pillarLook,
  pourLook,
  quenchRingLook,
  SPLINTER_LOOKS,
  SPLINTER_SHEAR_KIND,
  shieldLook,
} from '../src/render/smith_heart_fx/final_phase_fx_core';
import { finalTelegraphElement } from '../src/render/smith_heart_fx/final_telegraph_core';
import { HEAT_FLOOR } from '../src/render/smith_heart_fx/heat_floor_ladder_core';
import { HEART_ROOM } from '../src/sim/content/smith_heart_layout';
import { heartQuarterSpot } from '../src/sim/content/smith_heart_quarters';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { FINAL_BOSS } from '../src/sim/encounters/smith_heart/final_ids';
import {
  FINAL_PHASE_AURAS as A,
  ALL_QUARTERS_MASK,
  FINAL_PHASE_CASTS as C,
  FINAL_ADD_MOBS,
  FINAL_PHASE_CUES,
  FINAL_STAGE_CODES,
  FINAL_PHASES as P,
  pouredAuraId,
  QUENCH_RING_LIFE,
  quarterBit,
  quenchRingFront,
  quenchRingTemplate,
} from '../src/sim/encounters/smith_heart/final_phase_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

describe('the pure part-2 look', () => {
  it('claims every part-2 cue and nothing else', () => {
    for (const c of Object.values(FINAL_PHASE_CUES)) expect(finalPhaseClaims(c), c).toBe(true);
    expect(finalPhaseClaims('heart_final_anvil_fall')).toBe(false);
    expect(finalPhaseClaims(undefined)).toBe(false);
  });

  it('keeps its floor rungs untied with the kit, FinalFx and HeatFx', () => {
    const mine = finalPhaseRungs();
    expect(new Set(mine).size).toBe(mine.length);
    // HeatFx's own rungs (its fist and lanes draw on the Anvil too; the
    // Hearth fight's own modules never do).
    const heat = Object.values(HEAT_FLOOR)
      .filter((r) => r.owner === 'heat_fx')
      .map((r) => r.step);
    for (const r of mine) {
      expect(finalKitRungs(), String(r)).not.toContain(r);
      expect(FINAL_FX_PARTICLE_RUNGS, String(r)).not.toContain(r);
      expect(heat, String(r)).not.toContain(r);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(30);
    }
    expect(FINAL_PHASE_FLOOR.telegraphChar).toBeLessThan(FINAL_PHASE_FLOOR.telegraphGlow);
    expect(FINAL_PHASE_FLOOR.telegraphGlow).toBeLessThan(FINAL_PHASE_FLOOR.telegraphCurtain);
    expect(FINAL_KIT_FLOOR.telegraphChar).not.toBe(FINAL_PHASE_FLOOR.telegraphChar);
  });

  it("draws a Quenching Ring at the sim's own front and lets it go at its reach", () => {
    for (const age of [0.1, 1, 2.5, 4])
      expect(quenchRingLook(age).front).toBeCloseTo(quenchRingFront(age), 6);
    expect(quenchRingLook(QUENCH_RING_LIFE + 1).alive).toBe(false);
    expect(quenchRingLook(QUENCH_RING_LIFE * 0.5).alpha).toBeGreaterThan(0.9);
  });

  it("paints each Splinter's frontal in its own element, lethal to all but its target", () => {
    expect(finalTelegraphElement(SPLINTER_SHEAR_KIND.heat)).toBe('fire');
    expect(finalTelegraphElement(SPLINTER_SHEAR_KIND.quench)).toBe('frost');
    expect(finalTelegraphElement(SPLINTER_SHEAR_KIND.breath)).toBe('storm');
    expect(finalTelegraphElement(SPLINTER_SHEAR_KIND.hammer)).toBe('stone');
    expect(PHASE_FOOTPRINTS.shear.color).toBe(TELEGRAPH_THREAT_COLORS.lethal);
    expect(PHASE_REACH.shear).toBe(P.shearRange);
    expect(PHASE_REACH.shearArc).toBe(P.shearArcDeg);
    expect(PHASE_REACH.coal).toBe(P.coalReach);
    expect(PHASE_REACH.buffet).toBe(P.buffetReach);
    for (const v of ['heat', 'quench', 'breath', 'hammer'] as const)
      expect(SPLINTER_LOOKS[v].color).toBeGreaterThan(0);
  });

  it('the shield rises and crackles at the end; the columns and pours live and go', () => {
    expect(shieldLook(0, 30).alpha).toBe(0);
    expect(shieldLook(2, 30).alpha).toBeGreaterThan(0.8);
    expect(shieldLook(2, 30).urgent).toBe(0);
    expect(shieldLook(2, 2).urgent).toBeGreaterThan(0.7);
    expect(pillarLook(0.5, 2).alpha).toBeGreaterThan(0.5);
    expect(pillarLook(3, 2).alpha).toBe(0);
    expect(pourLook(0.8).alpha).toBeGreaterThan(0.9);
    expect(pourLook(5).alpha).toBe(0);
  });
});

describe("the room's floor through part 2", () => {
  it("reads the call's mask off the boss's phase aura", () => {
    const mask = quarterBit('hammer');
    expect(finalPhaseMaskOf({ auras: [{ id: A.phase, value2: mask }] })).toBe(mask);
    expect(finalPhaseMaskOf({ auras: [] })).toBe(0);
  });

  it("wakes the living Splinters' quarters through a call, all four in the final phase", () => {
    const c = { x: HEART_ROOM.x, z: HEART_ROOM.z };
    const mask = quarterBit('heat') | quarterBit('quench');
    const call = { ...c, engaged: true, final: false, mask };
    expect(heartQuartersModeOf(call).mode).toBe('call');
    const s = newHeartQuartersState();
    for (let i = 0; i < 40; i++) stepHeartQuarters(s, call, i * 0.1, 0.1);
    expect(s.quarters.heat.awake).toBe(1);
    expect(s.quarters.quench.awake).toBe(1);
    expect(s.quarters.breath.awake).toBe(0);
    // A Splinter dies: its quarter drains.
    const one = { ...call, mask: quarterBit('heat') };
    for (let i = 40; i < 120; i++) stepHeartQuarters(s, one, i * 0.1, 0.1);
    expect(s.quarters.heat.awake).toBe(1);
    expect(s.quarters.quench.awake).toBe(0);
    // Out of the call, resting in the ring, nothing wakes.
    expect(heartQuartersModeOf({ ...c, engaged: true, final: false, mask: 0 }).mode).toBe('rest');
    expect(
      heartQuartersModeOf({ ...c, engaged: true, final: true, mask: ALL_QUARTERS_MASK }).mode,
    ).toBe('final');
  });
});

// ---- the painter over a fake world ---------------------------------------------------------

function entity(
  id: number,
  kind: string,
  templateId: string,
  x: number,
  z: number,
  extra: Partial<Entity> = {},
): Entity {
  return {
    id,
    kind,
    templateId,
    name: templateId,
    pos: { x, y: 0, z },
    facing: 0,
    dead: false,
    hp: 100,
    maxHp: 100,
    scale: 1,
    auras: [],
    castingAbility: null,
    castRemaining: 0,
    castTotal: 0,
    castTargetId: null,
    ...extra,
  } as unknown as Entity;
}

function visibleNamed(root: THREE.Object3D | undefined, name: string): number {
  let n = 0;
  root?.traverse((o) => {
    if (o.name === name && o.visible) n++;
  });
  return n;
}

function footprintsShown(root: THREE.Object3D | undefined): number {
  let n = 0;
  root?.traverse((o) => {
    if (
      o instanceof THREE.Group &&
      o !== root &&
      o.visible &&
      o.children.some((c) => c instanceof THREE.Mesh) &&
      o.name === ''
    )
      n++;
  });
  return n;
}

const aura = (id: string, extra: Partial<Entity['auras'][number]> = {}) =>
  ({
    id,
    name: 'x',
    kind: 'internal_cd',
    remaining: 5,
    duration: 6,
    value: 0,
    sourceId: 2,
    ...extra,
  }) as Entity['auras'][number];

describe('FinalPhaseFx over a fake world', () => {
  it('raises every part-2 piece, claims its cues, hides out of the Heart, disposes', () => {
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
    const at = (dx: number, dz: number) => ({
      x: o.x + HEART_ROOM.x + dx,
      z: o.z + HEART_ROOM.z + dz,
    });
    const entities = new Map<number, Entity>();
    const add = (e: Entity) => entities.set(e.id, e);
    const p = at(-10, -10);
    const me = entity(1, 'player', 'warrior', p.x, p.z, { auras: [aura(A.coal)] });
    const q = at(20, 0);
    const quarry = entity(3, 'player', 'mage', q.x, q.z, {
      auras: [aura(A.tether, { sourceId: 12 })],
    });
    const b = at(0, 0);
    const boss = entity(2, 'mob', FINAL_BOSS, b.x, b.z, {
      castingAbility: C.call,
      castTotal: P.callSeconds,
      castRemaining: 20,
      auras: [
        aura(A.phase, {
          value: FINAL_STAGE_CODES.call,
          value2: quarterBit('heat') | quarterBit('breath'),
          value3: 20,
        }),
        aura(A.shield),
        aura(pouredAuraId('quench'), { value: 1 }),
        aura(A.fury, { value: 2 }),
      ],
    });
    const h = at(-30, 0);
    const heat = entity(11, 'mob', FINAL_ADD_MOBS.heat, h.x, h.z, {
      castingAbility: C.shear,
      castTotal: P.shearCast,
      castRemaining: 1,
      castTargetId: 1,
      facing: 1.2,
    });
    const br = at(22, 2);
    const breath = entity(12, 'mob', FINAL_ADD_MOBS.breath, br.x, br.z);
    const r = at(0, -25);
    const ring = entity(20, 'object', quenchRingTemplate(3, 777), r.x, r.z, { scale: P.ringReach });
    for (const e of [me, quarry, boss, heat, breath, ring]) add(e);
    const world = {
      entities,
      player: me,
      playerId: me.id,
      entityRosterVersion: 1,
    } as unknown as IWorld;
    const scene = new THREE.Scene();
    let shaken = 0;
    const fx = new FinalPhaseFx(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      (a) => {
        shaken += a;
      },
    );
    const root = scene.getObjectByName('smith-heart-final-phase-fx');
    expect(root).toBeDefined();
    for (let i = 0; i < 10; i++) fx.update(1 / 30);
    // The shear cone, the coal's reach, the hunt's ring: every tier.
    expect(footprintsShown(root)).toBe(3);
    expect(visibleNamed(root, 'smithHeartFinalShield')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalSigil')).toBe(2);
    expect(visibleNamed(root, 'smithHeartFinalCoal')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalQuenchRing')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalTether')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalPoured')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalFury')).toBe(1);
    // A Splinter rising: claimed, a column of its light.
    const rise = heartQuarterSpot('heat');
    const ev = {
      type: 'spellfxAt',
      x: o.x + rise.x,
      z: o.z + rise.z,
      school: 'fire',
      fx: 'burst',
      radius: 4,
      ability: FINAL_PHASE_CUES.rise,
    } as SimEvent;
    expect(fx.handleEvent(ev)).toBe(true);
    fx.update(1 / 30);
    expect(visibleNamed(root, 'smithHeartFinalPillar')).toBe(1);
    // A pour into the boss: claimed, a beam.
    const pour = {
      type: 'spellfx',
      sourceId: 11,
      targetId: 2,
      school: 'arcane',
      fx: 'beam',
      ability: FINAL_PHASE_CUES.pour,
    } as SimEvent;
    expect(fx.handleEvent(pour)).toBe(true);
    fx.update(1 / 30);
    expect(visibleNamed(root, 'smithHeartFinalPour')).toBe(1);
    // The final phase wakes four columns.
    expect(
      fx.handleEvent({
        type: 'spellfxAt',
        x: b.x,
        z: b.z,
        school: 'arcane',
        fx: 'burst',
        radius: 40,
        ability: FINAL_PHASE_CUES.awaken,
      } as SimEvent),
    ).toBe(true);
    fx.update(1 / 30);
    expect(visibleNamed(root, 'smithHeartFinalPillar')).toBeGreaterThanOrEqual(5);
    expect(shaken).toBeGreaterThan(0);
    // Not ours: never claimed.
    expect(
      fx.handleEvent({
        type: 'spellfx',
        sourceId: 2,
        targetId: 1,
        school: 'fire',
        fx: 'nova',
        ability: 'heart_final_anvil_fall',
      } as SimEvent),
    ).toBe(false);
    // Out of the Heart: everything hides.
    me.pos = { x: o.x - 5000, y: 0, z: o.z };
    fx.update(1 / 30);
    expect(visibleNamed(root, 'smithHeartFinalShield')).toBe(0);
    expect(footprintsShown(root)).toBe(0);
    fx.dispose();
    expect(scene.getObjectByName('smith-heart-final-phase-fx')).toBeUndefined();
  });
});
