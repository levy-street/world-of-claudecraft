// The wind's floor arrows over the Storm Cornice (render/smith_heart_fx/
// breath_wind_arrows.ts; look: breath_fight_fx_core.ts windArrowLook; the
// owner's playtest of 2026-11-25): bright while the wind blows, half while it
// turns, pointing in while the guardian draws breath, gone in the calm; one
// grid over the whole Cornice that takes no tier (the wind's way is what a
// player acts on, so no preset may thin it).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BREATH } from '../src/sim/content/smith_heart_layout';
import { WIND_ARROWS, windArrowLook } from '../src/render/smith_heart_fx/breath_fight_fx_core';
import { BreathWindArrows } from '../src/render/smith_heart_fx/breath_wind_arrows';

describe('the Breath wind floor arrows', () => {
  it('reads the phase: whole in the blow, half in the turn, inward in the breath, gone at rest', () => {
    expect(windArrowLook('blow', 0.5)).toEqual({ strength: 1, inward: false });
    expect(windArrowLook('gust', 0.1)).toEqual({ strength: 1, inward: false });
    const g0 = windArrowLook('gather', 0).strength;
    const g1 = windArrowLook('gather', 1).strength;
    expect(g0).toBeGreaterThan(0.3);
    expect(g1).toBeGreaterThan(g0);
    expect(g1).toBeLessThan(1);
    expect(windArrowLook('inhale', 0.5).inward).toBe(true);
    for (const p of ['calm', 'still', 'storm', null] as const)
      expect(windArrowLook(p, 0.5).strength).toBe(0);
  });

  it('lays one grid over the whole Cornice, with no tier to thin it', () => {
    // The constructor takes no tier or density: every preset draws the same.
    expect(BreathWindArrows.length).toBe(2);
    const root = new THREE.Group();
    const a = new BreathWindArrows(root, 60);
    const geo = a.mesh.geometry as THREE.InstancedBufferGeometry;
    const C = BREATH.cornice;
    const area = Math.PI * C.rx * C.rz;
    // About one chevron per cell of the grid over the floor.
    expect(geo.instanceCount).toBeGreaterThan((area / WIND_ARROWS.spacing ** 2) * 0.8);
    a.paint(1, { x: 1, z: 0 }, false, new THREE.Vector2(C.x, C.z), 1 / 60, false);
    expect(a.mesh.visible).toBe(true);
    a.paint(0, { x: 1, z: 0 }, false, new THREE.Vector2(C.x, C.z), 1 / 60, false);
    expect(a.mesh.visible).toBe(false);
    a.dispose();
  });
});
