// Mountain's Wrath's and Mountain's Rush's cast and impact look (render/
// smith_heart_fx/council_strike_core.ts and council_strike_fx.ts, a part of
// CouncilFx):
//   - the plan: the gather swells with the bar (the fists' glow, the motes,
//     the cracks, the pebbles' lift), shivers only at its end; the release
//     flashes, cools and ends (the flash capped under reduced motion); the
//     pebbles ring the caster, lift and are blasted outward and away; the
//     Wrath's thud reaches across the Quarry, fades with distance and is gone
//     under reduced motion;
//   - the painter over a fake world: the gather on the Guardian through the
//     Wrath's bar (fists, cracks, pebbles), the release on the Wrath's `nova`
//     cue, which stays unclaimed (the generic nova and the sight field still
//     draw it), a thud once; the Rush's gather through its bar and its stop's
//     cracks; nothing shakes under reduced motion; the low tier draws fewer
//     pebbles.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { activateGfxProfile, GFX, getActiveGfxProfile } from '../src/render/gfx';
import { CouncilFx } from '../src/render/smith_heart_fx/council_fx';
import {
  newStrikePebble,
  pebbleFlung,
  pebbleHang,
  STRIKE_FX,
  strikeGather,
  strikeRelease,
  strikeShake,
} from '../src/render/smith_heart_fx/council_strike_core';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  COUNCIL_CASTS,
  COUNCIL_CUES,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart/council_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

describe("the blows' plan", () => {
  it('swells the gather with the bar and shivers only at its end', () => {
    let prev = strikeGather(0);
    expect(prev.shiver).toBe(0);
    for (let f = 0.05; f <= 1.0001; f += 0.05) {
      const g = { ...strikeGather(f) };
      expect(g.glow).toBeGreaterThan(prev.glow);
      expect(g.motes).toBeGreaterThan(prev.motes);
      expect(g.crack).toBeGreaterThanOrEqual(prev.crack);
      expect(g.lift).toBeGreaterThanOrEqual(prev.lift);
      prev = g;
    }
    expect(strikeGather(STRIKE_FX.shiverFrom - 0.01).shiver).toBe(0);
    expect(strikeGather(1).shiver).toBeCloseTo(1, 6);
    expect(strikeGather(1).lift).toBe(1);
  });

  it('flashes at the release, cools and ends; the flash is capped under reduced motion', () => {
    expect(strikeRelease(0, false).flash).toBeCloseTo(1, 6);
    expect(strikeRelease(0, true).flash).toBeLessThanOrEqual(0.35);
    expect(strikeRelease(STRIKE_FX.flashFor + 0.01, false).flash).toBe(0);
    expect(strikeRelease(2, false).heat).toBeLessThan(strikeRelease(0.5, false).heat);
    expect(strikeRelease(STRIKE_FX.cracksFor + 0.1, false).live).toBe(false);
    expect(strikeRelease(Number.NaN, false).live).toBe(false);
  });

  it('rings the caster with its pebbles, lifts them, blasts them outward and away', () => {
    const n = STRIKE_FX.pebbles;
    const p = newStrikePebble();
    const q = newStrikePebble();
    expect(pebbleHang(0, n, 0, 1, 0, p).size).toBe(0);
    const quarters = new Set<number>();
    for (let i = 0; i < n; i++) {
      pebbleHang(i, n, 1, 2, 0, p);
      const r = Math.hypot(p.x, p.z);
      expect(r).toBeGreaterThanOrEqual(STRIKE_FX.pebbleInner - 0.01);
      expect(r).toBeLessThanOrEqual(STRIKE_FX.pebbleOuter + 0.01);
      expect(p.y).toBeGreaterThan(0.2);
      expect(p.size).toBeGreaterThan(0);
      quarters.add(Math.floor(((Math.atan2(p.x, p.z) + Math.PI) / (Math.PI * 2)) * 4) % 4);
      pebbleFlung(i, 0.5, p, q);
      expect(Math.hypot(q.x, q.z)).toBeGreaterThan(r + 5);
      expect(pebbleFlung(i, STRIKE_FX.flungFor, p, q).size).toBe(0);
    }
    expect(quarters.size).toBe(4);
    // The low tier's fewer pebbles are larger.
    expect(pebbleHang(0, STRIKE_FX.pebblesLow, 1, 2, 0, p).size).toBeGreaterThan(
      pebbleHang(0, n, 1, 2, 0, q).size,
    );
  });

  it('thuds the Wrath across the Quarry, fading, none under reduced motion', () => {
    expect(strikeShake('wrath', 0, false)).toBeGreaterThan(strikeShake('wrath', 60, false));
    expect(strikeShake('wrath', 60, false)).toBeGreaterThan(0);
    expect(strikeShake('wrath', 200, false)).toBe(0);
    expect(strikeShake('wrath', 0, true)).toBe(0);
    expect(strikeShake('rush', 0, false)).toBeLessThan(strikeShake('wrath', 0, false));
  });
});

// ---- the painter over a fake world --------------------------------------------------------

const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
function entity(id: number, kind: Entity['kind'], templateId: string, x: number, z: number) {
  return {
    id,
    kind,
    templateId,
    name: templateId,
    pos: { x: o.x + x, y: 0, z: o.z + z },
    prevPos: { x: o.x + x, y: 0, z: o.z + z },
    facing: 0,
    scale: 3.2,
    hp: 100,
    maxHp: 100,
    dead: false,
    auras: [] as Entity['auras'],
    castingAbility: null as string | null,
    castTargetId: null as number | null,
    castRemaining: 0,
    castTotal: 0,
    resourceType: null,
    resource: 0,
    maxResource: 0,
  } as unknown as Entity;
}

function rig(reduced = false) {
  const entities = new Map<number, Entity>();
  const me = entity(1, 'player', 'warrior', 8, -160);
  me.scale = 1;
  const marked = entity(2, 'player', 'mage', 0, -150);
  marked.scale = 1;
  const guardian = entity(20, 'mob', 'heart_hammer_guardian', 0, -175);
  for (const e of [me, marked, guardian]) entities.set(e.id, e);
  const world = { entities, player: me, playerId: me.id } as unknown as IWorld;
  const scene = new THREE.Scene();
  const shakes: number[] = [];
  const fx = new CouncilFx(
    scene,
    () => 0,
    world,
    undefined,
    () => reduced,
    (a) => shakes.push(a),
  );
  const root = scene.getObjectByName('smith-heart-council-fx');
  const shown = (name: string) => {
    let n = 0;
    root?.traverse((c) => {
      if (c.name !== name) return;
      for (let x: THREE.Object3D | null = c; x; x = x.parent) if (!x.visible) return;
      n++;
    });
    return n;
  };
  return { fx, root, shown, shakes, guardian, marked };
}

describe('the blows over a fake world', () => {
  it("gathers through the Wrath's bar and releases on its cue, unclaimed, one thud", () => {
    const r = rig();
    Object.assign(r.guardian, {
      castingAbility: COUNCIL_CASTS.wrath,
      castTotal: T.wrathCast,
      castRemaining: 1,
    });
    for (let i = 0; i < 10; i++) r.fx.update(1 / 20);
    expect(r.shown('smithHeartCouncilStrikeHand')).toBe(2);
    expect(r.shown('smithHeartCouncilStrikeCore')).toBe(2);
    expect(r.shown('smithHeartCouncilStrikeCracks')).toBe(1);
    expect(r.shown('smithHeartCouncilStrikePebbles')).toBe(1);
    // The cue: the renderer's generic nova still draws it.
    r.guardian.castingAbility = null;
    const nova = {
      type: 'spellfx',
      sourceId: r.guardian.id,
      targetId: r.guardian.id,
      school: 'physical',
      fx: 'nova',
      ability: COUNCIL_CASTS.wrath,
    } as SimEvent;
    const before = r.shakes.length;
    expect(r.fx.handleEvent(nova)).toBe(false);
    // Exactly one thud from the release (the bar's own frames may rumble).
    expect(r.shakes.length).toBe(before + 1);
    r.fx.update(1 / 20);
    expect(r.shown('smithHeartCouncilStrikeHand')).toBe(0);
    expect(r.shown('smithHeartCouncilStrikeFlash')).toBe(1);
    expect(r.shown('smithHeartCouncilStrikeCracks')).toBe(1);
    expect(r.shown('smithHeartCouncilStrikePebbles')).toBe(1);
    const thuds = r.shakes.length;
    // It runs out and hides.
    for (let i = 0; i < (STRIKE_FX.cracksFor + 0.5) * 20; i++) r.fx.update(1 / 20);
    expect(r.shown('smithHeartCouncilStrikeFlash')).toBe(0);
    expect(r.shown('smithHeartCouncilStrikeCracks')).toBe(0);
    expect(r.shown('smithHeartCouncilStrikePebbles')).toBe(0);
    expect(r.shakes.length).toBe(thuds);
    r.fx.dispose();
  });

  it("gathers through the Rush's bar and bursts the cracks open at its stop", () => {
    const r = rig();
    Object.assign(r.guardian, {
      castingAbility: COUNCIL_CASTS.rush,
      castTargetId: r.marked.id,
      castTotal: T.rushCast,
      castRemaining: 2,
    });
    for (let i = 0; i < 10; i++) r.fx.update(1 / 20);
    expect(r.shown('smithHeartCouncilStrikeHand')).toBe(2);
    r.guardian.castingAbility = null;
    const at = { x: r.guardian.pos.x, z: r.guardian.pos.z };
    const windup = {
      type: 'spellfxAt',
      sourceId: r.guardian.id,
      x: at.x,
      z: at.z,
      school: 'physical',
      fx: 'burst',
      radius: T.rushHalfWidth,
      dirX: 0,
      dirZ: 1,
      speed: T.rushSpeed,
      duration: 1,
      ability: COUNCIL_CUES.rushWindup,
    } as SimEvent;
    expect(r.fx.handleEvent(windup)).toBe(true);
    r.fx.update(1 / 20);
    expect(r.shown('smithHeartCouncilStrikeHand')).toBe(0);
    expect(r.shown('smithHeartCouncilStrikeFlash')).toBe(1);
    const stop = { ...windup, z: at.z + 20, ability: COUNCIL_CUES.rushImpact } as SimEvent;
    for (let i = 0; i < 10; i++) r.fx.update(1 / 20);
    expect(r.fx.handleEvent(stop)).toBe(true);
    r.fx.update(1 / 20);
    const cracks = r.root?.getObjectByName('smithHeartCouncilStrikeCracks') as THREE.Mesh;
    expect(r.shown('smithHeartCouncilStrikeCracks')).toBeGreaterThanOrEqual(1);
    expect(cracks.position.z).toBeCloseTo(at.z + 20, 3);
    r.fx.dispose();
  });

  it('never thuds under reduced motion', () => {
    const r = rig(true);
    Object.assign(r.guardian, {
      castingAbility: COUNCIL_CASTS.wrath,
      castTotal: T.wrathCast,
      castRemaining: 1,
    });
    r.fx.update(1 / 20);
    r.guardian.castingAbility = null;
    r.fx.handleEvent({
      type: 'spellfx',
      sourceId: r.guardian.id,
      targetId: r.guardian.id,
      school: 'physical',
      fx: 'nova',
      ability: COUNCIL_CASTS.wrath,
    } as SimEvent);
    r.fx.update(1 / 20);
    expect(r.shakes).toHaveLength(0);
    expect(r.shown('smithHeartCouncilStrikeFlash')).toBe(1);
    r.fx.dispose();
  });

  it('draws fewer pebbles on the low tier', () => {
    const original = getActiveGfxProfile();
    activateGfxProfile({ ...original, settings: { ...GFX, tier: 'low' } });
    try {
      const r = rig();
      const pebbles = r.root?.getObjectByName(
        'smithHeartCouncilStrikePebbles',
      ) as THREE.InstancedMesh;
      expect(pebbles.count).toBe(STRIKE_FX.pebblesLow * 2);
      r.fx.dispose();
    } finally {
      activateGfxProfile(original);
    }
  });
});
