// The Quench guardian's effects (phase 2H, presentation only:
// smith_heart_fx/quench_fx_core.ts, quench_fx.ts):
//   - the guardian's numbers read, never tuned; Tempering Strike's ice inside
//     its arc and its reach; the timelines;
//   - QuenchFx over a fake world telegraphs Quenching Breath's cone for its
//     bar (the cone's angle and range the sim's), frosts the floor and lifts
//     the ice when it lands, lifts the ice for a Tempering Strike, never
//     claims an event, disposes.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { QuenchFx } from '../src/render/smith_heart_fx';
import { ARC_CLEAVE_ABILITY } from '../src/render/smith_heart_fx/hammer_fx_core';
import {
  BREATH_FROST_SECONDS,
  breathBlastLook,
  breathChargeLook,
  QUENCH_GUARDIAN,
  QUENCHING_BREATH,
  quenchGuardianKit,
  strikeLook,
  strikeSpikes,
} from '../src/render/smith_heart_fx/quench_fx_core';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

describe("the Quench guardian's effects", () => {
  it('reads Tempering Strike and Quenching Breath off the sim template', () => {
    const m = SMITH_HEART_MOBS[QUENCH_GUARDIAN];
    const kit = quenchGuardianKit();
    expect(kit.strikeArcDeg).toBe(m.arcCleave?.arcDeg);
    expect(kit.strikeRange).toBe(m.arcCleave?.range);
    expect(kit.breathArcDeg).toBe(m.trashKit?.cone?.arcDeg);
    expect(kit.breathRange).toBe(m.trashKit?.cone?.range);
    expect(kit.breathCast).toBe(m.trashKit?.cone?.castTime);
    expect(m.trashKit?.cone?.castId).toBe(QUENCHING_BREATH);
  });

  it("keeps the strike's ice inside its arc and its reach; the timelines run out", () => {
    const k = quenchGuardianKit();
    const half = (k.strikeArcDeg * Math.PI) / 360;
    for (const seed of [1, 2, 3]) {
      const spikes = strikeSpikes(seed, k.strikeArcDeg, k.strikeRange);
      expect(spikes.length).toBeGreaterThan(10);
      for (const s of spikes) {
        expect(Math.hypot(s.x, s.z)).toBeLessThanOrEqual(k.strikeRange);
        expect(Math.abs(Math.atan2(s.x, s.z))).toBeLessThanOrEqual(half);
        expect(s.height).toBeGreaterThan(0);
      }
    }
    expect(breathChargeLook(0).creep).toBe(0);
    expect(breathChargeLook(1).creep).toBe(1);
    expect(breathBlastLook(0.6).front).toBeCloseTo(1, 6);
    expect(breathBlastLook(BREATH_FROST_SECONDS + 0.1).frost).toBe(0);
    expect(strikeLook(0).rise).toBe(0);
    expect(strikeLook(0.3).rise).toBe(1);
    expect(strikeLook(2).shatter).toBe(true);
  });

  function entity(id: number, kind: Entity['kind'], templateId: string, x: number, z: number) {
    return {
      id,
      kind,
      templateId,
      name: templateId,
      pos: { x, y: 0, z },
      prevPos: { x, y: 0, z },
      facing: 0.4,
      scale: 1,
      hp: 100,
      maxHp: 100,
      dead: false,
      auras: [],
      castingAbility: null as string | null,
      castTargetId: null,
      castRemaining: 0,
      castTotal: 0,
    } as unknown as Entity;
  }

  /** The telegraph groups shown (a pooled fan holds a mesh). */
  function telegraphsShown(root: THREE.Object3D | undefined): number {
    let n = 0;
    root?.traverse((o) => {
      if (
        o instanceof THREE.Group &&
        o !== root &&
        o.visible &&
        o.children.some((c) => c instanceof THREE.Mesh)
      )
        n++;
    });
    return n;
  }

  const shown = (root: THREE.Object3D | undefined, name: string) => {
    let n = 0;
    root?.traverse((o) => {
      if (o.name === name && o.visible) n++;
    });
    return n;
  };

  it('telegraphs the breath, frosts the floor and lifts the ice, claims nothing, disposes', () => {
    const entities = new Map<number, Entity>();
    const me = entity(1, 'player', 'warrior', -10, 0);
    const boss = entity(2, 'mob', QUENCH_GUARDIAN, 0, 0);
    boss.castingAbility = QUENCHING_BREATH;
    boss.castTotal = 2.5;
    boss.castRemaining = 2.5;
    entities.set(me.id, me);
    entities.set(boss.id, boss);
    const world = { entities, player: me, playerId: me.id } as unknown as IWorld;
    const scene = new THREE.Scene();
    let shaken = 0;
    const fx = new QuenchFx(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      (a) => {
        shaken += a;
      },
    );
    const root = scene.getObjectByName('smith-heart-quench-fx');
    expect(root).toBeDefined();
    expect(telegraphsShown(root)).toBe(0);
    for (let i = 0; i < 40; i++) {
      boss.castRemaining = Math.max(0, boss.castRemaining - 1 / 30);
      fx.update(1 / 30);
    }
    // The cone on the floor, aimed where the guardian faces, the sim's range.
    expect(telegraphsShown(root)).toBe(1);
    let fan: THREE.Object3D | undefined;
    root?.traverse((o) => {
      if (o instanceof THREE.Group && o !== root && o.visible && !fan) fan = o;
    });
    expect(fan?.rotation.y).toBeCloseTo(boss.facing, 6);
    expect(fan?.scale.x).toBeCloseTo(quenchGuardianKit().breathRange, 6);
    // The frost creeping out under it.
    expect(shown(root, 'smithHeartQuenchFrost')).toBe(1);
    const nova = {
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'frost',
      fx: 'nova',
      ability: QUENCHING_BREATH,
    } as SimEvent;
    expect(fx.handleEvent(nova)).toBe(false);
    boss.castingAbility = null;
    fx.update(1 / 30);
    expect(telegraphsShown(root)).toBe(0);
    expect(shown(root, 'smithHeartQuenchFrost')).toBe(1);
    expect(shown(root, 'smithHeartQuenchBreathIce')).toBe(1);
    expect(shaken).toBeGreaterThan(0);
    // Tempering Strike: the ice in its arc, no telegraph.
    const strike = {
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'fire',
      fx: 'windup',
      ability: ARC_CLEAVE_ABILITY,
    } as SimEvent;
    expect(fx.handleEvent(strike)).toBe(false);
    fx.update(1 / 30);
    expect(shown(root, 'smithHeartQuenchStrikeIce')).toBe(1);
    expect(telegraphsShown(root)).toBe(0);
    // A swing cleave from anyone else lifts nothing.
    const other = entity(3, 'mob', 'heart_quench_warder', 5, 5);
    entities.set(other.id, other);
    for (let i = 0; i < 150; i++) fx.update(1 / 30);
    expect(fx.handleEvent({ ...strike, sourceId: other.id } as SimEvent)).toBe(false);
    fx.update(1 / 30);
    expect(shown(root, 'smithHeartQuenchStrikeIce')).toBe(0);
    expect(shown(root, 'smithHeartQuenchBreathIce')).toBe(0);
    expect(shown(root, 'smithHeartQuenchFrost')).toBe(0);
    fx.dispose();
    expect(scene.getObjectByName('smith-heart-quench-fx')).toBeUndefined();
  });
});
