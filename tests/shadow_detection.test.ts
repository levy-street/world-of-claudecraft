import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  SHADOW_RING_SEGMENTS,
  shadowDetectionVisible,
  writeShadowRing,
} from '../src/render/shadow_detection_core';
import { ShadowInfiltrationVisual } from '../src/render/shadow_infiltration_visual';
import { SHADOW_GUARDS, SHADOW_QUEST_ID } from '../src/sim/content/world_quest_shadow';
import type { WorldQuestProgress } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const progress = (): WorldQuestProgress => ({
  questId: SHADOW_QUEST_ID,
  state: 'active',
  count: 0,
  shadow: { phase: 'cloaked', suspicion: 0, cooldown: 0 },
});
describe('shadow detection guidance', () => {
  it('preserves the exact detection radius on sloping ground', () => {
    const out = new Float32Array((SHADOW_RING_SEGMENTS + 1) * 6);
    writeShadowRing(out, 55, 30, 5.88, 6, (x, z) => x * 0.1 + z * 0.2);
    for (let i = 0; i <= SHADOW_RING_SEGMENTS; i++) {
      const at = i * 6 + 3;
      expect(Math.hypot(out[at] - 55, out[at + 2] - 30)).toBeCloseTo(6, 4);
      expect(out[at + 1]).toBeCloseTo(out[at] * 0.1 + out[at + 2] * 0.2 + 0.09, 4);
    }
  });
  it('only reveals a living active participant and hides completed or caught attempts', () => {
    const p = progress();
    expect(shadowDetectionVisible(p, false)).toBe(true);
    expect(shadowDetectionVisible(p, true)).toBe(false);
    p.shadow!.phase = 'caught';
    expect(shadowDetectionVisible(p, false)).toBe(false);
    p.shadow!.phase = 'cloaked';
    p.state = 'completed';
    expect(shadowDetectionVisible(p, false)).toBe(false);
  });
  it('gates materials before reveal, follows authoritative guards, and detaches on disposal', async () => {
    const scene = new THREE.Group();
    let release!: () => void;
    const visual = new ShadowInfiltrationVisual(
      scene,
      () => 3,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const p = progress();
    const entities = new Map(
      SHADOW_GUARDS.map((g) => [
        g.entityId,
        { id: g.entityId, dead: false, pos: { ...g.npc.pos, y: 3 } },
      ]),
    );
    const world = {
      player: { dead: false, pos: { x: 35, y: 3, z: 138 } },
      worldQuestLog: new Map([[SHADOW_QUEST_ID, p]]),
      entities,
    } as unknown as IWorld;
    visual.update(world);
    expect(visual.group.visible).toBe(false);
    release();
    await visual.readyForEntry;
    visual.update(world);
    expect(visual.group.visible).toBe(true);
    const sentry = entities.get(2146900045)!;
    sentry.pos.x = 72;
    visual.update(world);
    const mesh = visual.group.children[8] as THREE.Mesh;
    expect(mesh.geometry.getAttribute('position').getX(0)).toBe(72);
    p.shadow!.phase = 'caught';
    visual.update(world);
    expect(visual.group.visible).toBe(false);
    visual.dispose();
    expect(scene.children).not.toContain(visual.group);
  });
});
