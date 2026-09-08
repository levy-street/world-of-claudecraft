import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { persistentClassVfxCompileTargets } from '../src/render/ability_vfx/prewarm';
import { abilityVfxFullSpec } from '../src/render/ability_vfx_registry';
import { gfxInternalsForTest, resetSurfaceMaterialProfileCache } from '../src/render/gfx';
import {
  HunterShellskinVisual,
  shellskinMaterial,
  syncHunterShellskin,
} from '../src/render/hunter_shellskin_visual';

const AURA = { id: 'shellskin', kind: 'shield_wall', value: 0.6, remaining: 7, duration: 8 };
function matrix(visual: HunterShellskinVisual, index: number) {
  const m = new THREE.Matrix4();
  visual.plates.getMatrixAt(index, m);
  return m;
}
function bones() {
  const rig = new THREE.Group();
  for (const [name, x, y, z] of [
    ['chest', 0, 1.2, 0],
    ['spine', 0, 0.8, 0],
    ['upperarm.l', 0.4, 1.35, 0],
    ['upperarm.r', -0.4, 1.35, 0],
    ['lowerarm.l', 0.55, 1.1, 0],
    ['hand.l', 0.65, 0.7, 0],
    ['lowerarm.r', -0.55, 1.1, 0],
    ['hand.r', -0.65, 0.7, 0],
  ] as const) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    rig.add(b);
  }
  return rig;
}
describe('Hunter fitted carapace', () => {
  it('keeps one reusable solid mesh, ends on cancellation/death and releases only its owned instance buffer', () => {
    const rig = bones();
    const group = new THREE.Group();
    group.add(rig);
    const view = {
      group,
      height: 1.8,
      hunterShellskinVisual: null as HunterShellskinVisual | null,
    };
    const entity = { dead: false, auras: [AURA] };
    syncHunterShellskin(view, entity, rig);
    const visual = view.hunterShellskinVisual;
    if (!visual) throw new Error('Carapace missing');
    expect(visual.group.visible).toBe(true);
    expect(visual.group.children).toHaveLength(1);
    const buffer = visual.plates.instanceMatrix.array;
    syncHunterShellskin(view, entity, rig);
    expect(view.hunterShellskinVisual).toBe(visual);
    expect(visual.plates.instanceMatrix.array).toBe(buffer);
    syncHunterShellskin(view, { ...entity, auras: [] }, rig);
    expect(visual.group.visible).toBe(false);
    syncHunterShellskin(view, { ...entity, dead: true }, rig);
    expect(visual.group.visible).toBe(false);
    const geometryDispose = vi.spyOn(visual.plates.geometry, 'dispose');
    const materialDispose = vi.spyOn(visual.plates.material as THREE.Material, 'dispose');
    visual.dispose();
    visual.dispose();
    expect(visual.group.parent).toBeNull();
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
    geometryDispose.mockRestore();
    materialDispose.mockRestore();
  });
  it('follows real arm and torso motion instead of holding a static jacket during attacks', () => {
    const rig = bones(),
      visual = new HunterShellskinVisual(),
      group = new THREE.Group();
    group.add(rig, visual.group);
    group.position.set(30, 0, -15);
    group.rotation.y = 0.7;
    visual.update(AURA, 1.8, rig);
    const armBefore = matrix(visual, 22),
      torsoBefore = matrix(visual, 4);
    rig.getObjectByName('hand.l')?.position.set(0.65, 1.1, 0.7);
    rig.getObjectByName('chest')?.position.set(0, 1.2, 0.2);
    visual.update(AURA, 1.8, rig);
    expect(matrix(visual, 22).equals(armBefore)).toBe(false);
    expect(matrix(visual, 4).equals(torsoBefore)).toBe(false);
    expect([...visual.plates.instanceMatrix.array].every(Number.isFinite)).toBe(true);
    visual.dispose();
  });
  it('changes plate fit for the attacking talent and suppresses the old generic ward composition', () => {
    const visual = new HunterShellskinVisual();
    visual.update(AURA, 1.8, null);
    const closed = matrix(visual, 12);
    visual.update({ ...AURA, value: 0.4 }, 1.8, null);
    expect(matrix(visual, 12).equals(closed)).toBe(false);
    expect(abilityVfxFullSpec('shellskin')?.presentation).toBe('dedicated');
    expect(abilityVfxFullSpec('shellskin')?.impact?.ring).toBe(false);
    visual.dispose();
  });
  it('tracks loader-sanitized bones and the actual displayed distant body', () => {
    const rig = bones(),
      visual = new HunterShellskinVisual(),
      group = new THREE.Group();
    rig.traverse((b) => {
      b.name = THREE.PropertyBinding.sanitizeNodeName(b.name);
    });
    const far = new THREE.Group();
    group.add(rig, visual.group, far);
    visual.update(AURA, 1.8, rig);
    const arm = matrix(visual, 22);
    rig.getObjectByName('handl')?.position.set(0.8, 1.5, 0.8);
    visual.update(AURA, 1.8, rig);
    expect(matrix(visual, 22).equals(arm)).toBe(false);
    visual.update(AURA, 1.8, rig, far);
    expect(visual.plates.count).toBe(20);
    const version = visual.plates.instanceMatrix.version;
    const back = matrix(visual, 4);
    rig.getObjectByName('chest')?.position.set(8, 9, 10);
    visual.update(AURA, 1.8, rig, far);
    expect(matrix(visual, 4).equals(back)).toBe(true);
    expect(visual.plates.instanceMatrix.version).toBe(version);
    far.position.y = 0.6;
    visual.update(AURA, 1.8, rig, far);
    expect(matrix(visual, 4).elements[13] - back.elements[13]).toBeCloseTo(0.6);
    visual.update(AURA, 1.8, rig);
    expect(visual.plates.count).toBe(26);
    visual.dispose();
  });
  it('prepares the active material variant without retaining old instances after repeated graphics rebuilds', () => {
    for (let i = 0; i < 8; i++) {
      const restore = gfxInternalsForTest.overrideSettings({ standardMaterials: i % 2 === 0 });
      try {
        resetSurfaceMaterialProfileCache();
        const targets = persistentClassVfxCompileTargets();
        const shells = targets.filter((t) => t.object.name === 'hunter-shellskin-scutes');
        expect(shells.length).toBeLessThanOrEqual(2);
        expect(shells.some((t) => (t.object as THREE.Mesh).material === shellskinMaterial())).toBe(
          true,
        );
      } finally {
        restore();
        resetSurfaceMaterialProfileCache();
      }
    }
  });
  it('integrates after the current animation and mount pose, with the displayed LOD', () => {
    const code = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const sync = code.indexOf('syncHunterShellskin(v, e, active.root, active.displayedFarBody)');
    expect(sync).toBeGreaterThan(code.indexOf('active.update(dt, st, animate'));
    expect(sync).toBeGreaterThan(code.indexOf('seatRiderOnBone(v.group, v.visual.root'));
  });
});
