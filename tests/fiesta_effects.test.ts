import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  createFiestaEffectsState,
  type FiestaEffectsHost,
  tickFiestaGlows,
  updateFiestaPowerups,
  updateFiestaRing,
} from '../src/render/fiesta_effects';
import type { ArenaInfo, FiestaMatchInfo } from '../src/world_api/duel_arena';

// Regression coverage for the renderer.ts extraction: these three functions
// used to be private Renderer methods reading/writing this.fiestaRing /
// this.fiestaPowerupMeshes / this.fiestaGlows directly. Behavior must stay
// identical against the extracted FiestaEffectsState + FiestaEffectsHost seam.

function host(overrides: Partial<FiestaEffectsHost> = {}): FiestaEffectsHost {
  return {
    scene: new THREE.Scene(),
    seed: 1,
    time: 0,
    hasView: () => true,
    buffSwirl: vi.fn(),
    ...overrides,
  };
}

function fiestaMatch(overrides: Partial<FiestaMatchInfo> = {}): NonNullable<ArenaInfo['match']> {
  return {
    format: 'fiesta',
    state: 'active',
    oppName: '',
    oppClass: 'warrior',
    oppLevel: 1,
    oppPid: 0,
    allies: [],
    enemies: [],
    fiesta: {
      team: 'A',
      scoreA: 0,
      scoreB: 0,
      myScore: 0,
      theirScore: 0,
      scoreLimit: 3,
      wave: 1,
      totalWaves: 3,
      ring: { cx: 10, cz: 20, radius: 40 },
      down: false,
      respawnIn: 0,
      augments: [],
      offer: null,
      augmentPending: 0,
      teamA: [],
      teamB: [],
      powerups: [],
      ...overrides,
    },
  };
}

describe('fiesta_effects', () => {
  it('updateFiestaRing builds no mesh while no bout is active, then builds and positions one', () => {
    const state = createFiestaEffectsState();
    const h = host();
    updateFiestaRing(state, h, null, 1 / 20);
    expect(state.ring).toBeNull();

    const match = fiestaMatch();
    updateFiestaRing(state, h, match, 1 / 20);
    expect(state.ring).not.toBeNull();
    expect(h.scene.children).toContain(state.ring);
    expect(state.ring?.visible).toBe(true);
    expect(state.ring?.position.x).toBe(10);
    expect(state.ring?.position.z).toBe(20);
    expect(state.ring?.scale.x).toBe(40);
    expect(state.ring?.scale.z).toBe(40);
  });

  it('updateFiestaRing hides (never disposes) the ring when the match state flips away from active', () => {
    const state = createFiestaEffectsState();
    const h = host();
    updateFiestaRing(state, h, fiestaMatch(), 1 / 20);
    const mesh = state.ring;
    expect(mesh?.visible).toBe(true);

    const overMatch = { ...fiestaMatch(), state: 'over' as const };
    updateFiestaRing(state, h, overMatch, 1 / 20);
    expect(state.ring).toBe(mesh);
    expect(mesh?.visible).toBe(false);
  });

  it('updateFiestaPowerups spawns, updates and retires meshes by id', () => {
    const state = createFiestaEffectsState();
    const h = host();
    const spawning = fiestaMatch({
      powerups: [
        { id: 1, defId: 'haste', x: 5, z: 6, state: 'spawning', frac: 0.5, color: 0xff0000 },
      ],
    });
    updateFiestaPowerups(state, h, spawning, 1 / 20);
    expect(state.powerupMeshes.size).toBe(1);
    const mesh = state.powerupMeshes.get(1);
    if (!mesh) throw new Error('expected a spawned powerup mesh');
    expect(h.scene.children).toContain(mesh);
    expect(mesh.scale.x).toBeCloseTo(0.25 + 0.5 * 0.85);

    // Removed from the live list next frame: the mesh is disposed and dropped.
    const disposeSpy = vi.spyOn(mesh.material as THREE.Material, 'dispose');
    updateFiestaPowerups(state, h, fiestaMatch({ powerups: [] }), 1 / 20);
    expect(state.powerupMeshes.size).toBe(0);
    expect(h.scene.children).not.toContain(mesh);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('tickFiestaGlows fires buffSwirl on its cadence and expires on time or a gone view', () => {
    const state = createFiestaEffectsState();
    state.glows.set(1, { color: 0x00ff00, until: 10, nextSwirl: 0 });
    state.glows.set(2, { color: 0x0000ff, until: 10, nextSwirl: 0 });

    const buffSwirl = vi.fn();
    // Entity 2 has no live view: it is dropped without ever swirling.
    tickFiestaGlows(state, host({ time: 1, hasView: (id) => id === 1, buffSwirl }), 1 / 20);
    expect(state.glows.has(1)).toBe(true);
    expect(state.glows.has(2)).toBe(false);
    expect(buffSwirl).toHaveBeenCalledExactlyOnceWith(1, 0x00ff00);

    // Past its `until`, entity 1's glow expires too.
    tickFiestaGlows(state, host({ time: 11, hasView: () => true, buffSwirl }), 1 / 20);
    expect(state.glows.has(1)).toBe(false);
  });
});
