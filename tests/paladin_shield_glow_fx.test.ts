import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  PALADIN_SHIELD_GLOW_CONTACT,
  PaladinShieldGlowFx,
  paladinShieldGlowPlan,
} from '../src/render/characters/paladin_shield_glow_fx';

describe("Bastion Sweep's glowing shield layer", () => {
  it('builds through the windup, flashes on contact and is gone by the end', () => {
    expect(paladinShieldGlowPlan(null, 0.8)).toEqual({ glow: 0, flash: 0 });
    const early = paladinShieldGlowPlan(0.08, 0.8);
    const late = paladinShieldGlowPlan(0.24, 0.8);
    expect(early.glow).toBeGreaterThan(0);
    expect(late.glow).toBeGreaterThan(early.glow);
    expect(late.flash).toBe(0);
    expect(paladinShieldGlowPlan(PALADIN_SHIELD_GLOW_CONTACT + 0.01, 0.8).flash).toBeGreaterThan(
      0.8,
    );
    const end = paladinShieldGlowPlan(0.79, 0.8);
    expect(end.glow + end.flash).toBeLessThan(0.05);
    expect(paladinShieldGlowPlan(0.8, 0.8)).toEqual({ glow: 0, flash: 0 });
  });

  it('lays a layer over the held shield without touching it, and cleans up', () => {
    const model = new THREE.Group();
    const hand = new THREE.Group();
    hand.name = 'handslotl';
    model.add(hand);
    const shield = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.9, 0.1),
      new THREE.MeshBasicMaterial(),
    );
    shield.name = 'heldShield';
    hand.add(shield);

    const fx = new PaladinShieldGlowFx(model);
    fx.update(0.2, 0.8, 0.016);
    const layer = shield.getObjectByName('paladinShieldGlow') as THREE.Mesh;
    expect(layer).toBeDefined();
    expect(layer.visible).toBe(true);
    // It shares the shield's geometry and sits on it, so it moves with it.
    expect(layer.geometry).toBe(shield.geometry);
    expect(layer.parent).toBe(shield);
    expect(shield.visible).toBe(true);
    expect(shield.parent).toBe(hand);

    // Out of the bash it hides; a second bash reuses the same layer.
    fx.update(null, 0, 0);
    expect(layer.visible).toBe(false);
    fx.update(0.2, 0.8, 0.016);
    expect(shield.children.filter((c) => c.name === 'paladinShieldGlow')).toHaveLength(1);

    const disposeMaterial = vi.spyOn(layer.material as THREE.Material, 'dispose');
    const disposeGeometry = vi.spyOn(shield.geometry, 'dispose');
    fx.dispose();
    expect(shield.getObjectByName('paladinShieldGlow')).toBeUndefined();
    expect(disposeMaterial).toHaveBeenCalledTimes(1);
    // The shield's own geometry is the shield's, never the layer's to dispose.
    expect(disposeGeometry).not.toHaveBeenCalled();
    expect(shield.parent).toBe(hand);
  });

  it('builds its layers hidden ahead of the first glow, and the glow mounts nothing new', () => {
    const model = new THREE.Group();
    const hand = new THREE.Group();
    hand.name = 'handslotl';
    model.add(hand);
    const shield = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.9, 0.1),
      new THREE.MeshBasicMaterial(),
    );
    hand.add(shield);
    const fx = new PaladinShieldGlowFx(model);
    fx.prepare();
    const layer = shield.getObjectByName('paladinShieldGlow') as THREE.Mesh;
    // Built when the gear is (the rig's compile gate takes it), hidden until lit.
    expect(layer).toBeDefined();
    expect(layer.visible).toBe(false);
    fx.prepare();
    expect(shield.children.filter((c) => c.name === 'paladinShieldGlow')).toHaveLength(1);
    fx.update(0.2, 0.8, 0.016);
    expect(shield.getObjectByName('paladinShieldGlow')).toBe(layer);
    expect(layer.visible).toBe(true);
    fx.dispose();
  });

  it('flares as Bastion Rite lands, glows while it holds and fades as it runs out', () => {
    const model = new THREE.Group();
    const hand = new THREE.Group();
    hand.name = 'handslotl';
    model.add(hand);
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.1));
    hand.add(shield);
    const fx = new PaladinShieldGlowFx(model);
    const uniforms = () => {
      const layer = shield.getObjectByName('paladinShieldGlow') as THREE.Mesh;
      return { layer, u: (layer.material as THREE.ShaderMaterial).uniforms };
    };
    fx.update(null, 0, 0.016, 1);
    expect(uniforms().u.uFlash.value).toBeGreaterThan(0.7);
    for (let i = 0; i < 40; i++) fx.update(null, 0, 0.05, 1);
    const held = uniforms().u.uGlow.value as number;
    expect(held).toBeGreaterThan(0.5);
    expect(uniforms().u.uFlash.value).toBe(0);
    for (let i = 0; i < 40; i++) fx.update(null, 0, 0.05, 0.05);
    expect(uniforms().u.uGlow.value).toBeLessThan(held * 0.5);
    for (let i = 0; i < 40; i++) fx.update(null, 0, 0.05, null);
    expect(uniforms().layer.visible).toBe(false);
    fx.dispose();
  });

  it('drops the layer of a shield no longer held', () => {
    const model = new THREE.Group();
    const hand = new THREE.Group();
    hand.name = 'handslotl';
    model.add(hand);
    const first = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.1));
    hand.add(first);
    const fx = new PaladinShieldGlowFx(model);
    fx.update(0.2, 0.8, 0.016);
    fx.update(null, 0, 0);
    hand.remove(first);
    const second = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.1));
    hand.add(second);
    fx.update(0.2, 0.8, 0.016);
    expect(first.getObjectByName('paladinShieldGlow')).toBeUndefined();
    expect(second.getObjectByName('paladinShieldGlow')).toBeDefined();
    fx.dispose();
  });
});
