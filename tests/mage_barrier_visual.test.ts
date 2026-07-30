import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  MageBarrierVisual,
  mageBarrierStateForAura,
  mageBarrierStateForAuras,
  syncMageBarrierVisual,
} from '../src/render/mage_barrier_visual';

describe('Mage barrier visual', () => {
  it('recognizes Frostveil without borrowing unrelated absorb shields', () => {
    expect(
      mageBarrierStateForAuras([
        { id: 'ice_barrier', kind: 'absorb', value: 130 },
        { id: 'priest_shield', kind: 'absorb', value: 500 },
      ]),
    ).toEqual({ theme: 'frost', value: 130 });
    expect(mageBarrierStateForAuras([{ id: 'ice_barrier', kind: 'slow', value: 130 }])).toBeNull();
    expect(
      mageBarrierStateForAuras([{ id: 'priest_shield', kind: 'absorb', value: 130 }]),
    ).toBeNull();
  });

  it('maps Blazing Barrier and Temporal Barrier to independent palettes', () => {
    expect(
      mageBarrierStateForAuras([
        { id: 'blazing_barrier', kind: 'absorb', value: 130, remaining: 60 },
      ]),
    ).toEqual({ theme: 'fire', value: 130, remaining: 60 });
    expect(
      mageBarrierStateForAuras([
        { id: 'temporal_barrier', kind: 'absorb', value: 160, remaining: 10 },
      ]),
    ).toEqual({ theme: 'temporal', value: 160, remaining: 10 });

    const fire = new MageBarrierVisual(1.8, 'fire');
    const temporal = new MageBarrierVisual(1.8, 'temporal');
    const fireShell = fire.group.getObjectByName('mage-barrier-shell') as THREE.Mesh;
    const temporalShell = temporal.group.getObjectByName('mage-barrier-shell') as THREE.Mesh;
    expect((fireShell.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xff6b32);
    expect((temporalShell.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x9f6cff);
  });

  it('maps Mass Barrier to the casting specialization carried by its aura school', () => {
    expect(
      mageBarrierStateForAuras([
        { id: 'mass_barrier', kind: 'absorb', value: 130, school: 'arcane' },
      ]),
    ).toEqual({ theme: 'temporal', value: 130 });
    expect(
      mageBarrierStateForAuras([
        { id: 'mass_barrier', kind: 'absorb', value: 130, school: 'fire' },
      ]),
    ).toEqual({ theme: 'fire', value: 130 });
    expect(
      mageBarrierStateForAuras([
        { id: 'mass_barrier', kind: 'absorb', value: 130, school: 'frost' },
      ]),
    ).toEqual({ theme: 'frost', value: 130 });

    const scratch = { theme: 'frost' as const, value: 0 };
    expect(
      mageBarrierStateForAura(
        { id: 'mass_barrier', kind: 'absorb', value: 90, school: 'arcane' },
        scratch,
      ),
    ).toBe(scratch);
  });

  it('recolors and pulses an existing visual when its barrier theme changes', () => {
    const visual = new MageBarrierVisual(1.8, 'frost');
    visual.update({ theme: 'frost', value: 130, remaining: 30 }, 1);
    visual.update({ theme: 'fire', value: 130, remaining: 60 }, 0.01);

    const shell = visual.group.getObjectByName('mage-barrier-shell') as THREE.Mesh;
    expect((shell.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xff6b32);
    expect(visual.activatedThisFrame).toBe(true);
    expect(visual.group.scale.x).toBeLessThan(1);
  });

  it('builds a translucent shell, rune bands, and pooled frost motes around the character', () => {
    const visual = new MageBarrierVisual(1.8, 'frost');
    visual.update({ theme: 'frost', value: 130 }, 1);

    const shell = visual.group.getObjectByName('mage-barrier-shell') as THREE.Mesh;
    expect(shell).toBeInstanceOf(THREE.Mesh);
    expect((shell.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x64cfff);
    expect((shell.material as THREE.Material).transparent).toBe(true);
    expect((shell.material as THREE.MeshBasicMaterial).depthWrite).toBe(false);
    expect(visual.group.getObjectByName('mage-barrier-rune-bands')).toBeInstanceOf(THREE.Group);
    expect(visual.group.getObjectByName('mage-barrier-motes')).toBeInstanceOf(THREE.InstancedMesh);

    const bounds = new THREE.Box3().setFromObject(visual.group);
    expect(bounds.max.y).toBeGreaterThan(2);
    expect(bounds.max.x - bounds.min.x).toBeGreaterThan(1.5);
    expect(bounds.max.z - bounds.min.z).toBeGreaterThan(1.5);
  });

  it('pulses in, weakens with remaining absorb, then plays a short break instead of popping', () => {
    const visual = new MageBarrierVisual(1.8, 'frost');
    visual.update({ theme: 'frost', value: 130 }, 0.03);
    expect(visual.group.visible).toBe(true);
    expect(visual.activatedThisFrame).toBe(true);
    expect(visual.group.scale.x).toBeLessThan(1);

    visual.update({ theme: 'frost', value: 130 }, 1);
    const shell = visual.group.getObjectByName('mage-barrier-shell') as THREE.Mesh;
    const fullOpacity = (shell.material as THREE.MeshBasicMaterial).opacity;
    visual.update({ theme: 'frost', value: 20 }, 0.016);
    expect((shell.material as THREE.MeshBasicMaterial).opacity).toBeLessThan(fullOpacity);

    visual.update(null, 0.016);
    expect(visual.group.visible).toBe(true);
    expect(visual.brokeThisFrame).toBe(true);
    expect(visual.group.scale.x).toBeGreaterThan(1);
    visual.update(null, 1);
    expect(visual.group.visible).toBe(false);
  });

  it('pulses again when Frostveil is refreshed before the old shield expires', () => {
    const visual = new MageBarrierVisual(1.8, 'frost');
    visual.update({ theme: 'frost', value: 130, remaining: 30 }, 1);
    expect(visual.activatedThisFrame).toBe(true);
    visual.update({ theme: 'frost', value: 110, remaining: 29.9 }, 0.1);
    expect(visual.activatedThisFrame).toBe(false);

    visual.update({ theme: 'frost', value: 130, remaining: 60 }, 0.01);
    expect(visual.activatedThisFrame).toBe(true);
    expect(visual.group.scale.x).toBeLessThan(1);
  });

  it('lazy-creates once on the owning character and disposes its instance buffer', () => {
    const parent = new THREE.Group();
    let visual = syncMageBarrierVisual(null, parent, 1.8, null, 0.016);
    expect(visual).toBeNull();

    visual = syncMageBarrierVisual(visual, parent, 1.8, { theme: 'frost', value: 130 }, 0.016);
    const first = visual;
    visual = syncMageBarrierVisual(visual, parent, 1.8, { theme: 'frost', value: 100 }, 0.016);
    expect(visual).toBe(first);
    expect(parent.children).toEqual([visual?.group]);

    const shell = visual?.group.getObjectByName('mage-barrier-shell') as THREE.Mesh;
    const band = visual?.group.getObjectByName('mage-barrier-rune-band-1') as THREE.Mesh;
    const motes = visual?.group.getObjectByName('mage-barrier-motes') as THREE.InstancedMesh;
    const disposedMaterials = new Set<THREE.Material>();
    for (const material of [shell.material, band.material, motes.material] as THREE.Material[]) {
      material.addEventListener('dispose', () => disposedMaterials.add(material));
    }
    let instanceDisposed = false;
    motes.addEventListener('dispose', () => {
      instanceDisposed = true;
    });
    visual?.dispose();
    expect(instanceDisposed).toBe(true);
    expect(disposedMaterials.size).toBe(3);
  });

  it('is wired through the renderer aura pass and cleaned up with entity views', () => {
    const rendererPath = fileURLToPath(new URL('../src/render/renderer.ts', import.meta.url));
    const renderer = readFileSync(rendererPath, 'utf8');

    expect(renderer).toContain(
      'mageBarrierState ??= mageBarrierStateForAura(a, this.mageBarrierStateScratch)',
    );
    expect(renderer).toContain('v.mageBarrierVisual = syncMageBarrierVisual(');
    expect(renderer).toContain('v.mageBarrierVisual?.dispose()');
  });
});
