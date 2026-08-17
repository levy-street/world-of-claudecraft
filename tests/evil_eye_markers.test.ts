import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  evilEyeMarkerKind,
  fateThreadMarkerState,
  hasPossessedEvilEye,
} from '../src/render/evil_eye_marker_core';
import { EvilEyeMarkers } from '../src/render/evil_eye_markers';
import type { Aura, Entity } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

function eye(kind: 'affliction_eye' | 'affliction_eye_secondary'): Aura {
  return {
    id: 'evil_eye',
    name: 'Evil Eye',
    kind,
    remaining: 15,
    duration: 15,
    value: 1,
    sourceId: 1,
    school: 'shadow',
  };
}

describe('Evil Eye overhead markers', () => {
  it('distinguishes living primary and Coven eyes from unmarked or dead targets', () => {
    expect(evilEyeMarkerKind({ dead: false, auras: [eye('affliction_eye')] }, 1)).toBe('primary');
    expect(evilEyeMarkerKind({ dead: false, auras: [eye('affliction_eye_secondary')] }, 1)).toBe(
      'secondary',
    );
    expect(evilEyeMarkerKind({ dead: false, auras: [eye('affliction_eye')] }, 2)).toBeNull();
    expect(evilEyeMarkerKind({ dead: false, auras: [] }, 1)).toBeNull();
    expect(evilEyeMarkerKind({ dead: true, auras: [eye('affliction_eye')] }, 1)).toBeNull();
    expect(
      hasPossessedEvilEye({
        dead: false,
        auras: [
          {
            ...eye('affliction_eye'),
            kind: 'affliction_possession',
          },
        ],
      }),
    ).toBe(true);
    expect(
      fateThreadMarkerState(
        {
          dead: false,
          auras: [
            {
              ...eye('affliction_eye'),
              kind: 'affliction_fate_threads',
              stacks: 7,
              remaining: 4,
              duration: 12,
            },
          ],
        },
        1,
      ),
    ).toEqual({ stacks: 3, remaining: 4, duration: 12 });
  });

  it('wraps the primary victim in one visible tether per Fate Thread', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const target = {
      id: 9,
      dead: false,
      auras: [
        eye('affliction_eye'),
        {
          ...eye('affliction_eye'),
          id: 'fate_threads',
          name: 'Fate Threads',
          kind: 'affliction_fate_threads',
          stacks: 2,
          value: 2,
          remaining: 6,
          duration: 12,
        },
      ],
      scale: 2,
    } as Entity;
    const world = {
      playerId: 1,
      entities: new Map([[target.id, target]]),
    } as unknown as IWorld;
    const group = new THREE.Group();
    const markers = new EvilEyeMarkers();

    markers.update(world, new Map([[target.id, { group, height: 3 }]]));

    const first = group.getObjectByName('fate-thread-1') as THREE.Line;
    const second = group.getObjectByName('fate-thread-2') as THREE.Line;
    const third = group.getObjectByName('fate-thread-3') as THREE.Line;
    expect(first.visible).toBe(true);
    expect(second.visible).toBe(true);
    expect(third.visible).toBe(false);
    expect(first.scale.x).toBeCloseTo(0.5, 4);
    expect((first.material as THREE.LineBasicMaterial).opacity).toBeGreaterThan(0.3);

    target.auras = [eye('affliction_eye')];
    markers.update(world, new Map([[target.id, { group, height: 3 }]]));
    expect(first.visible).toBe(false);
    expect(second.visible).toBe(false);
  });

  it('enlarges and brightens the primary marker while the familiar possesses it', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const player = {
      id: 1,
      dead: false,
      auras: [
        {
          ...eye('affliction_eye'),
          kind: 'affliction_possession',
        },
      ],
    } as Entity;
    const target = {
      id: 9,
      dead: false,
      auras: [eye('affliction_eye')],
      scale: 1,
    } as Entity;
    const world = {
      playerId: player.id,
      entities: new Map([
        [player.id, player],
        [target.id, target],
      ]),
    } as unknown as IWorld;
    const group = new THREE.Group();
    const markers = new EvilEyeMarkers();

    markers.update(world, new Map([[target.id, { group, height: 3 }]]), true);

    const sprite = group.getObjectByName('evil-eye-primary') as THREE.Sprite;
    expect(sprite.scale.x).toBeCloseTo(1.35, 4);
    expect((sprite.material as THREE.SpriteMaterial).opacity).toBe(0.98);
  });

  it('anchors a scale-independent eye above the marked model and removes it with the aura', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const target = {
      id: 9,
      dead: false,
      auras: [eye('affliction_eye')],
      scale: 2,
    } as Entity;
    const world = {
      playerId: 1,
      entities: new Map([[target.id, target]]),
    } as unknown as IWorld;
    const group = new THREE.Group();
    group.scale.setScalar(target.scale);
    const views = new Map([[target.id, { group, height: 3 }]]);
    const markers = new EvilEyeMarkers();

    markers.update(world, views);
    const sprite = group.getObjectByName('evil-eye-primary') as THREE.Sprite;
    expect(sprite.position.y).toBeCloseTo(3.34, 4);
    expect(sprite.scale.x).toBeCloseTo(0.5, 4);

    target.scale = 1;
    group.scale.setScalar(1);
    markers.update(world, views);
    expect(sprite.position.y).toBeCloseTo(3.68, 4);
    expect(sprite.scale.x).toBeCloseTo(1, 4);

    target.auras = [eye('affliction_eye_secondary')];
    markers.update(world, views);
    expect(group.getObjectByName('evil-eye-primary')).toBeUndefined();
    const secondary = group.getObjectByName('evil-eye-secondary') as THREE.Sprite;
    expect(secondary.scale.x).toBeCloseTo(0.82, 4);
    expect((secondary.material as THREE.SpriteMaterial).opacity).toBe(0.72);

    target.dead = true;
    markers.update(world, views);
    expect(group.getObjectByName('evil-eye-secondary')).toBeUndefined();
  });

  it('keeps the marker manager wired into the renderer frame update', () => {
    const source = readFileSync(join(process.cwd(), 'src/render/renderer.ts'), 'utf8');
    expect(source).toContain('new EvilEyeMarkers()');
    expect(source).toContain(
      'this.evilEyeMarkers.update(this.sim, this.views, this.reducedMotion())',
    );
  });
});
