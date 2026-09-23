import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { shamanLightningSurface } from '../src/render/characters/shaman_surface_scorch';
import { CharacterSurfaceResponse } from '../src/render/characters/surface_response';
import type { CharacterVisual } from '../src/render/characters/visual';
import { impactContact } from '../src/render/impact_contact';

describe('brief Shaman lightning surface scorch', () => {
  it('selects lightning identities, never wind, stone, fire, healing or unrelated attacks', () => {
    for (const id of ['lightning_bolt', 'chain_lightning', 'lightning_shield', 'stormstrike'])
      expect(shamanLightningSurface(id)).toBe(true);
    for (const id of [
      undefined,
      'unknown',
      'unleash_weapon',
      'earth_shock',
      'flame_shock',
      'healing_wave',
      'storm_bolt',
    ])
      expect(shamanLightningSurface(id)).toBe(false);
  });

  it('keeps the surface identity with motion disabled and restores motion on a later normal contact', () => {
    const response = new CharacterSurfaceResponse();
    const visual = {
      respondToElement: vi.fn((school, strength, contact, reduced) =>
        response.trigger(school, strength, contact, reduced),
      ),
      holdFrame: vi.fn(),
    };
    impactContact(
      visual as unknown as CharacterVisual,
      'shaman-storm',
      1.2,
      false,
      true,
      'lightning_bolt',
    );
    expect(response.uniforms.uSurfaceKind.value).toBe(11);
    expect(response.uniforms.uSurfaceMotion.value).toBe(0);
    expect(visual.holdFrame).not.toHaveBeenCalled();
    response.clear();
    response.trigger('shaman-storm', 0.8);
    expect(response.uniforms.uSurfaceMotion.value).toBe(1);
  });

  it('darkens only through a bounded cached surface response and restores on expiry', () => {
    const response = new CharacterSurfaceResponse();
    const root = new THREE.Group();
    const source = new THREE.MeshStandardMaterial({ color: 0xc98654 });
    const original = source.color.clone();
    expect(response.trigger('shaman-storm', 0.9)).toBe(true);
    const material = response.material(source);
    expect(material).not.toBe(source);
    expect(response.uniforms.uSurfaceKind.value).toBe(11);
    response.update(0.3, root, 2);
    expect(response.active).toBe(true);
    response.update(0.41, root, 2);
    expect(response.active).toBe(false);
    expect(response.uniforms.uSurfaceAmount.value).toBe(0);
    expect(source.color).toEqual(original);
    for (let i = 0; i < 50; i++) {
      response.trigger('shaman-storm', 0.9);
      expect(response.material(source)).toBe(material);
      response.clear();
    }
    expect(response.materials.size).toBe(1);
    material.dispose();
    source.dispose();
  });

  it('rejects zero or invalid strength without leaving a live scorch', () => {
    const response = new CharacterSurfaceResponse();
    for (const strength of [0, -1, NaN, Infinity]) {
      expect(response.trigger('shaman-storm', strength)).toBe(false);
      expect(response.active).toBe(false);
    }
  });

  it('does not allocate a different material when the same receiver changes element', () => {
    const response = new CharacterSurfaceResponse();
    const source = new THREE.MeshLambertMaterial();
    const dispose = vi.spyOn(source, 'dispose');
    response.trigger('fire', 0.8);
    const material = response.material(source);
    response.trigger('shaman-storm', 0.9);
    expect(response.material(source)).toBe(material);
    expect(response.uniforms.uSurfaceKind.value).toBe(11);
    response.trigger('nature', 0.8);
    expect(response.uniforms.uSurfaceKind.value).toBe(3);
    response.clear();
    expect(dispose).not.toHaveBeenCalled();
    material.dispose();
    source.dispose();
  });
});
