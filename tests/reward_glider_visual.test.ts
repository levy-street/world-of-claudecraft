import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { RewardGliderVisual } from '../src/render/reward_glider_visual';
import { GLIDER_QUEST_ID } from '../src/sim/content/world_quest_glider';
import type { Entity, WorldQuestProgress } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

function player(id = 1): Entity {
  return {
    id,
    kind: 'player',
    dead: false,
    // Online bodies retain grounded/velocity defaults; aura.value is authoritative.
    onGround: true,
    pos: { x: 10, y: 20, z: 30 },
    facing: 0.5,
    vx: 0,
    vy: 0,
    vz: 0,
    auras: [{ id: 'rift_feather_glider', remaining: 30, value: 1 }],
  } as Entity;
}

function world(): IWorld & { worldQuestLog: Map<string, WorldQuestProgress> } {
  const self = player();
  return {
    player: self,
    entities: new Map([[self.id, self]]),
    worldQuestLog: new Map(),
  } as unknown as IWorld & { worldQuestLog: Map<string, WorldQuestProgress> };
}

describe('reputation glider presentation lifecycle', () => {
  it('warms attached mesh before revealing and follows the rendered self pose', async () => {
    let settle!: () => void;
    const gate = vi.fn((root: THREE.Object3D) => {
      expect(root.visible).toBe(false);
      expect(root.getObjectByName('glider-apparatus-fallback')?.children).toHaveLength(2);
      return new Promise<void>((resolve) => {
        settle = resolve;
      });
    });
    const visual = new RewardGliderVisual(new THREE.Group(), gate);
    const state = world();
    const body = new THREE.Group();
    body.position.set(11.2, 21.4, 32.6);
    body.rotation.y = 1.1;
    visual.update(state, body);
    expect(visual.group.visible).toBe(false);
    settle();
    await visual.readyForEntry;
    expect(visual.group.visible).toBe(false);
    visual.update(state, body);
    const apparatus = visual.group.getObjectByName('glider-apparatus')!;
    expect(visual.group.visible).toBe(true);
    expect(apparatus.position.x).toBe(11.2);
    expect(apparatus.position.y).toBeCloseTo(24.2);
    expect(apparatus.position.z).toBe(32.6);
    expect(apparatus.rotation.y).toBe(body.rotation.y);
    expect(apparatus.rotation.x).toBe(0);
    body.position.x += 0.4;
    body.position.y -= 0.1;
    visual.update(state, body, undefined, 0.05);
    expect(apparatus.rotation.x).toBeGreaterThan(0);
    expect(gate).toHaveBeenCalledOnce();
    visual.dispose();
  });

  it('renders remote view poses with shared warmed materials and removes retired equipment', async () => {
    const visual = new RewardGliderVisual(new THREE.Group());
    await visual.readyForEntry;
    const state = world();
    const remote = player(2);
    state.entities.set(2, remote);
    const body = new THREE.Group();
    body.position.set(101, 50, 202);
    body.rotation.y = -0.7;
    const views = new Map([[2, { group: body }]]);
    visual.update(state, undefined, views);
    const selfApparatus = visual.group.children[0];
    const apparatus = visual.group.children[1];
    expect(apparatus.position.toArray()).toEqual([101, 52.8, 202]);
    expect(apparatus.rotation.y).toBe(-0.7);
    const wing = apparatus.getObjectByName('glider-apparatus-fallback')!.children[0] as THREE.Mesh;
    const selfWing = selfApparatus.getObjectByName('glider-apparatus-fallback')!
      .children[0] as THREE.Mesh;
    expect(wing.material).toBe(selfWing.material);
    expect(wing.geometry).toBe(selfWing.geometry);
    body.position.x += 0.4;
    body.position.y -= 0.1;
    visual.update(state, undefined, views, 0.05);
    expect(apparatus.rotation.x).toBeGreaterThan(0);
    for (const retire of [
      () => {
        remote.auras[0].remaining = 0;
      },
      () => {
        remote.dead = true;
      },
      () => {
        remote.auras[0].value = 0;
      },
      () => {
        remote.auras = [];
      },
      () => {
        body.visible = false;
      },
      () => {
        views.clear();
      },
      () => {
        state.entities.delete(2);
      },
    ]) {
      Object.assign(remote, player(2));
      body.visible = true;
      state.entities.set(2, remote);
      views.set(2, { group: body });
      visual.update(state, undefined, views);
      expect(visual.group.children).toHaveLength(2);
      retire();
      visual.update(state, undefined, views);
      expect(visual.group.children).toHaveLength(1);
    }
    visual.dispose();
  });

  it('hides armed ground equipment and leaves course apparatus as the sole self glider', async () => {
    const visual = new RewardGliderVisual(new THREE.Group());
    await visual.readyForEntry;
    const state = world();
    state.player.onGround = true;
    state.player.auras[0].value = 0;
    visual.update(state);
    expect(visual.group.visible).toBe(false);
    state.player.onGround = false;
    state.player.auras[0].value = 1;
    for (const phase of ['countdown', 'flying'] as const) {
      state.worldQuestLog.set(GLIDER_QUEST_ID, { state: 'active', glider: { phase } } as never);
      visual.update(state);
      expect(visual.group.visible).toBe(false);
    }
    state.worldQuestLog.clear();
    visual.update(state);
    expect(visual.group.visible).toBe(true);
    state.player.dead = true;
    visual.update(state);
    expect(visual.group.visible).toBe(false);
    visual.dispose();
  });

  it('disposes its owned fallback once and a pending compile cannot revive it', async () => {
    let settle!: () => void;
    const scene = new THREE.Group();
    const visual = new RewardGliderVisual(
      scene,
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    const wing = visual.group.getObjectByName('glider-apparatus-fallback')!
      .children[0] as THREE.Mesh;
    const dispose = vi.spyOn(wing.geometry, 'dispose');
    visual.dispose();
    visual.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    settle();
    await visual.readyForEntry;
    visual.update(world());
    expect(visual.group.visible).toBe(false);
    expect(scene.children).not.toContain(visual.group);
  });
});
