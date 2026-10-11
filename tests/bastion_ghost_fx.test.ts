import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BastionGhostFx } from '../src/render/sunken_bastion/bastion_ghost_fx';
import {
  ghostCueProgress,
  ghostLaneLook,
  ghostShipOpacity,
  ghostShipPoseInto,
  ghostSoulPoseInto,
  ghostStrikeDistance,
} from '../src/render/sunken_bastion/bastion_ghost_fx_core';
import { instanceOrigin } from '../src/sim/data';
import { inGhostLane } from '../src/sim/encounters/sunken_bastion/ghost_captain_ids';
import type { IWorld } from '../src/world_api';

type Body = IWorld['entities'] extends Map<number, infer E> ? E : never;
const origin = instanceOrigin(1, 0);
function cue(id: number, templateId: string, x = origin.x, z = origin.z): Body {
  return {
    id,
    templateId,
    kind: 'object',
    dead: false,
    pos: { x, y: 0, z },
    facing: 0,
    scale: 28,
    castTotal: 2.4,
    castRemaining: 1.2,
  } as unknown as Body;
}
function fixture(detail: boolean) {
  const parent = new THREE.Group();
  const player = cue(1, '', origin.x + 8, origin.z + 8);
  const entities = new Map<number, Body>([[1, player]]);
  const world = { player, entities } as unknown as IWorld;
  const fx = new BastionGhostFx(parent, () => 0, world, detail);
  return { parent, entities, world, fx };
}
function visibleFloors(parent: THREE.Group): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  parent.traverseVisible((node) => {
    if (
      node instanceof THREE.Mesh &&
      node.material instanceof THREE.ShaderMaterial &&
      node.material.uniforms.uFill
    )
      result.push(node);
  });
  return result;
}

describe('ghost crew replicated visual tells', () => {
  it('retains live tells at saturation and reuses retired slots without growing the pool', () => {
    const f = fixture(false);
    for (let i = 0; i < 16; i++)
      f.entities.set(10 + i, cue(10 + i, 'ghost_broadside_lane', origin.x + i * 3));
    f.fx.update(0.1);
    const childCount = f.parent.getObjectByName('bastion-ghost-crew-fx')?.children.length;
    expect(visibleFloors(f.parent)).toHaveLength(16);
    f.entities.set(100, cue(100, 'ghost_anchor_lane', origin.x + 100));
    f.fx.update(0.1);
    expect(visibleFloors(f.parent).map((mesh) => mesh.parent?.position.x)).toEqual(
      Array.from({ length: 16 }, (_, i) => origin.x + i * 3),
    );
    f.entities.delete(10);
    f.fx.update(0.1);
    f.fx.update(0.1);
    const positions = visibleFloors(f.parent).map((mesh) => mesh.parent?.position.x);
    expect(positions).toHaveLength(16);
    expect(positions).toContain(origin.x + 100);
    expect(positions).toContain(origin.x + 3);
    expect(positions).not.toContain(origin.x);
    expect(f.parent.getObjectByName('bastion-ghost-crew-fx')?.children.length).toBe(childCount);
    f.fx.dispose();
  });

  it('aligns every authored cannon muzzle to the locked lanes at rotated distant coordinates', () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, -0.7]) {
      const pose = ghostShipPoseInto(
        { x: 0, y: 0, z: 0, yaw: 0 },
        origin.x,
        2,
        origin.z,
        yaw,
        0.5,
        false,
      );
      for (const muzzleZ of [-10, -5, 0, 5, 10]) {
        const x = pose.x + 2.705 * Math.cos(pose.yaw) + muzzleZ * Math.sin(pose.yaw);
        const z = pose.z - 2.705 * Math.sin(pose.yaw) + muzzleZ * Math.cos(pose.yaw);
        expect(x).toBeCloseTo(origin.x - muzzleZ * Math.cos(yaw), 6);
        expect(z).toBeCloseTo(origin.z + muzzleZ * Math.sin(yaw), 6);
      }
      expect(pose.y).toBe(2);
    }
    expect(ghostShipPoseInto({ x: 0, y: 0, z: 0, yaw: 0 }, 0, 2, 0, 0, 0, true).y).toBe(2);
    expect(ghostShipOpacity(0)).toBe(0);
    expect(ghostShipOpacity(0.5)).toBe(0.58);
    expect(ghostShipOpacity(1)).toBe(0);
  });

  it('pins full warning widths and accepts only the replicated cue templates', () => {
    expect(ghostLaneLook('ghost_broadside_lane')).toEqual({
      kind: 'broadside',
      width: 2.4,
      warning: true,
    });
    expect(ghostLaneLook('ghost_anchor_drag')).toEqual({
      kind: 'anchor',
      width: 3,
      warning: false,
    });
    expect(ghostLaneLook('ghost_boarding_lane')).toEqual({
      kind: 'boarding',
      width: 3,
      warning: true,
    });
    expect(ghostLaneLook('turretback_hermit')).toBeUndefined();
    expect(ghostCueProgress(1.2, 2.4)).toBe(0.5);
    expect(ghostCueProgress(-2, 2)).toBe(1);
    expect(ghostCueProgress(4, 2)).toBe(0);
  });

  it.each([false, true])(
    'draws five separated authoritative cannon lanes at detail=%s',
    (detail) => {
      const f = fixture(detail);
      for (let i = 0; i < 5; i++)
        f.entities.set(10 + i, cue(10 + i, 'ghost_broadside_lane', origin.x - 10 + i * 5));
      f.fx.update(0.05);
      const floors = visibleFloors(f.parent);
      expect(floors).toHaveLength(5);
      for (const mesh of floors) {
        const group = mesh.parent;
        if (!group) throw new Error('A visible lane must remain attached');
        const positions = mesh.geometry.getAttribute('position');
        const xs: number[] = [],
          zs: number[] = [];
        for (let i = 0; i < positions.count; i++) {
          xs.push(positions.getX(i));
          zs.push(positions.getZ(i));
        }
        expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2.4, 5);
        expect(Math.max(...zs) - Math.min(...zs)).toBe(28);
        expect((mesh.material as THREE.ShaderMaterial).uniforms.uFill.value).toBe(0.5);
        // The exact visible outside edge is safe in the authoritative hit test.
        expect(
          inGhostLane(
            { x: group.position.x, z: origin.z, yaw: 0, length: 28, width: 2.4 },
            group.position.x + 1.21,
            origin.z + 10,
          ),
        ).toBe(false);
      }
      // Moving a caster/player cannot drag the already locked warning origins.
      f.world.player.pos.x += 3;
      f.fx.update(0.05);
      expect(visibleFloors(f.parent)[0].parent?.position.x).toBe(origin.x - 10);
      f.fx.dispose();
      expect(f.parent.children).toHaveLength(0);
    },
  );

  it('draws the returning anchor at its authoritative midpoint with a live chain on low', () => {
    const f = fixture(false);
    const anchor = cue(10, 'ghost_anchor_drag');
    anchor.scale = 24;
    anchor.castTotal = 2;
    anchor.castRemaining = 1;
    f.entities.set(10, anchor);
    f.fx.update(0.05);
    const strikes: THREE.Object3D[] = [];
    f.parent.traverseVisible((node) => {
      if (node.name === 'cursed-anchor') strikes.push(node);
    });
    expect(strikes).toHaveLength(1);
    expect(strikes[0].parent?.position.z).toBe(origin.z + 12);
    expect(ghostStrikeDistance('anchor', 0, 24)).toBe(24);
    expect(ghostStrikeDistance('anchor', 1, 24)).toBe(0);
    let links = 0;
    f.parent.traverse((node) => {
      if (node instanceof THREE.InstancedMesh && node.name === 'cursed-anchor-chain')
        links += node.count;
    });
    expect(links).toBeGreaterThan(0);
    f.entities.delete(10);
    f.fx.update(0.05);
    expect(visibleFloors(f.parent)).toHaveLength(0);
    f.fx.dispose();
  });

  it('flashes the whole broadside immediately, without a late travelling damage cue', () => {
    const f = fixture(false);
    f.entities.set(10, cue(10, 'ghost_broadside_fire'));
    f.fx.update(0.05);
    const wakes: THREE.Object3D[] = [];
    f.parent.traverseVisible((node) => {
      if (node.name === 'spectral-lane-impact') wakes.push(node);
    });
    expect(wakes).toHaveLength(1);
    expect(wakes[0].scale.z).toBe(28);
    expect(wakes[0].position.z).toBe(14);
    expect(wakes[0].parent?.position.z).toBe(origin.z);
    f.fx.dispose();
  });

  it('keeps reduced-motion souls stationary and lets death dissolve once', () => {
    const a = { x: 0, y: 0, z: 0, height: 0, width: 0 };
    const b = { ...a };
    ghostSoulPoseInto(a, 1, 0, 0, true);
    ghostSoulPoseInto(b, 25, 0, 0, true);
    expect(a).toEqual(b);
    ghostSoulPoseInto(b, 25, 0, 1, false);
    expect(b.height).toBe(0);
    expect(b.width).toBe(0);
    const f = fixture(true);
    const sailor = cue(20, 'barnacle_crawler');
    f.entities.set(20, sailor);
    f.fx.update(0.05);
    const ribbons = f.parent.getObjectByName('ghost-soul-trails') as THREE.InstancedMesh;
    expect(ribbons.count).toBe(3);
    sailor.dead = true;
    f.fx.update(1);
    expect(ribbons.count).toBe(3);
    f.fx.update(1.9);
    expect(ribbons.count).toBe(0);
    f.fx.update(1);
    expect(ribbons.count).toBe(0);
    f.fx.dispose();
  });
});
