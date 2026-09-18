// NythraxisMechanicVisuals.syncWorld: the two aura-driven painters (the Bound
// cage, the Soul Rend markers) walk the roster only while the viewer stands in
// the instance band, where the encounter can run; outside it they see an empty
// roster, so an open-field frame touches no entity and anything carried out
// drops at once.
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  NythraxisMechanicVisuals,
  type NythraxisMechanicWorld,
  nythraxisPainterRoster,
} from '../src/render/nythraxis_mechanic_visuals';
import { NYTHRAXIS_SOUL_REND_AURA_ID } from '../src/render/nythraxis_soul_rend_marker_core';
import { DUNGEON_X_THRESHOLD } from '../src/sim/data';
import { NYTHRAXIS_BOUND_STUN_AURA_ID } from '../src/sim/nythraxis_binding_sigil';
import { NYTHRAXIS_BOSS_ID } from '../src/sim/types';

type Roster = NythraxisMechanicWorld['entities'];
type Raider = Roster extends ReadonlyMap<number, infer T> ? T : never;

function raider(id: number, marked: boolean): Raider {
  return {
    id,
    templateId: 'warrior',
    dead: false,
    scale: 1,
    pos: { x: DUNGEON_X_THRESHOLD + 50, y: 0, z: 0 },
    auras: marked ? [{ id: NYTHRAXIS_SOUL_REND_AURA_ID, remaining: 6, duration: 8 }] : [],
  };
}

function boss(): Raider {
  return {
    id: 7,
    templateId: NYTHRAXIS_BOSS_ID,
    dead: false,
    scale: 3,
    pos: { x: DUNGEON_X_THRESHOLD + 60, y: 0, z: 0 },
    auras: [{ id: NYTHRAXIS_BOUND_STUN_AURA_ID, remaining: 10, duration: 10 }],
  };
}

function world(playerX: number): NythraxisMechanicWorld & { entities: Map<number, Raider> } {
  return {
    activeNythraxisGraveFlames: [],
    activeNythraxisGravefires: [],
    activeNythraxisBindingSigils: [],
    entities: new Map<number, Raider>([
      [1, raider(1, true)],
      [2, raider(2, false)],
      [7, boss()],
    ]),
    player: { pos: { x: playerX } },
  };
}

describe('nythraxisPainterRoster', () => {
  it('is the world roster inside the instance band and empty outside it', () => {
    const inside = world(DUNGEON_X_THRESHOLD + 1);
    expect(nythraxisPainterRoster(inside)).toBe(inside.entities);
    const outside = world(DUNGEON_X_THRESHOLD);
    expect(nythraxisPainterRoster(outside).size).toBe(0);
    expect(nythraxisPainterRoster(world(0)).size).toBe(0);
  });
});

describe('NythraxisMechanicVisuals.syncWorld', () => {
  it('never walks the roster in the open field, and reconciles inside the band', () => {
    const scene = new THREE.Scene();
    const visuals = new NythraxisMechanicVisuals(scene, () => 0);
    const field = world(0);
    const values = vi.spyOn(field.entities, 'values');
    visuals.syncWorld(field);
    visuals.update(0.05, false);
    expect(values).not.toHaveBeenCalled();
    expect(scene.children.length).toBe(0);

    const arena = world(DUNGEON_X_THRESHOLD + 1);
    visuals.syncWorld(arena);
    // One Bound cage and one Soul Rend marker.
    expect(scene.children.length).toBe(2);

    // Carried out of the band (a hearth mid-fight): both drop at once.
    visuals.syncWorld(world(0));
    expect(scene.children.length).toBe(0);
    visuals.dispose();
  });
});
