// The shared GLB-instanced-prop kernel (src/render/glb_instanced_props.ts),
// extracted at farming Phase 7 QA on the rule of three from stations.ts and
// farm_patches.ts. These arms pin the kernel directly so an adopter cannot
// drift it silently: the fallback box, the GLB normalization, both accent
// detection channels, the material mapping, and the instancing tail with and
// without the per-instance color.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addInstancedParts, glbTemplateParts } from '../src/render/glb_instanced_props';

function syntheticGroup(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1, 2, 1),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  );
  body.name = 'Body';
  body.position.y = 1;
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x123456 });
  accentMat.name = 'crop_accent_test';
  const accent = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.2), accentMat);
  accent.name = 'AccentMesh';
  accent.position.y = 2.2;
  g.add(body);
  g.add(accent);
  return g;
}

const BASE_OPTS = {
  fallbackWidthFactor: 0.5,
  makeFallbackMat: () => new THREE.MeshStandardMaterial({ color: 0xabcdef }),
};

describe('glbTemplateParts', () => {
  it('falls back to one primitive box with the caller material and half-height lift', () => {
    const parts = glbTemplateParts(undefined, 2, BASE_OPTS);
    expect(parts).toHaveLength(1);
    const box = parts[0].geo as THREE.BoxGeometry;
    expect(box.parameters.height).toBe(2);
    expect(box.parameters.width).toBe(1);
    expect(box.parameters.depth).toBe(1);
    expect((parts[0].mat as THREE.MeshStandardMaterial).color.getHex()).toBe(0xabcdef);
    const lift = new THREE.Vector3().setFromMatrixPosition(parts[0].local);
    expect(lift.y).toBe(1);
    expect(parts[0].accent).toBe(false);
  });

  it('normalizes a loaded GLB to the target height', () => {
    // The synthetic group spans y 0..2.4 (body to y=2, accent to y=2.4), so a
    // target of 1.2 must scale by 0.5.
    const parts = glbTemplateParts(syntheticGroup(), 1.2, BASE_OPTS);
    expect(parts).toHaveLength(2);
    const scale = new THREE.Vector3();
    parts[0].local.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    expect(scale.y).toBeCloseTo(0.5, 5);
  });

  it('flags accent parts by mesh name AND by material name, each alone', () => {
    const byMesh = glbTemplateParts(syntheticGroup(), 1.2, {
      ...BASE_OPTS,
      accentMeshName: 'AccentMesh',
    });
    expect(byMesh.map((p) => p.accent)).toEqual([false, true]);
    const byMat = glbTemplateParts(syntheticGroup(), 1.2, {
      ...BASE_OPTS,
      accentMaterialName: 'crop_accent_test',
    });
    expect(byMat.map((p) => p.accent)).toEqual([false, true]);
    // No accent channel configured: nothing flags.
    const none = glbTemplateParts(syntheticGroup(), 1.2, BASE_OPTS);
    expect(none.map((p) => p.accent)).toEqual([false, false]);
  });

  it('routes GLB materials through mapMaterial but leaves the fallback alone', () => {
    const mapped: THREE.Material[] = [];
    const mapMaterial = (m: THREE.Material): THREE.Material => {
      mapped.push(m);
      return m;
    };
    glbTemplateParts(syntheticGroup(), 1.2, { ...BASE_OPTS, mapMaterial });
    expect(mapped).toHaveLength(2);
    mapped.length = 0;
    glbTemplateParts(undefined, 1.2, { ...BASE_OPTS, mapMaterial });
    expect(mapped).toHaveLength(0);
  });
});

describe('addInstancedParts', () => {
  const onePart = () => glbTemplateParts(undefined, 2, BASE_OPTS);
  const twoSites = [
    new THREE.Matrix4().makeTranslation(5, 0, 0),
    new THREE.Matrix4().makeTranslation(0, 0, 7),
  ];

  it('builds one InstancedMesh per part with site x local composition', () => {
    const group = new THREE.Group();
    addInstancedParts(group, 'kernel:test', onePart(), twoSites, new THREE.Matrix4());
    expect(group.children).toHaveLength(1);
    const im = group.children[0] as THREE.InstancedMesh;
    expect(im.count).toBe(2);
    expect(im.name).toBe('kernel:test');
    const m = new THREE.Matrix4();
    im.getMatrixAt(0, m);
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    // Site translation (5,0,0) times the local half-height lift (0,1,0).
    expect(pos.x).toBe(5);
    expect(pos.y).toBe(1);
    expect(im.castShadow).toBe(true);
    expect(im.receiveShadow).toBe(true);
    expect(im.boundingSphere).not.toBeNull();
  });

  it('writes per-instance color only when a color is given', () => {
    const tinted = new THREE.Group();
    addInstancedParts(
      tinted,
      'kernel:tinted',
      onePart(),
      twoSites,
      new THREE.Matrix4(),
      new THREE.Color(0x336699),
    );
    const tintedIm = tinted.children[0] as THREE.InstancedMesh;
    expect(tintedIm.instanceColor).not.toBeNull();
    const c = new THREE.Color();
    tintedIm.getColorAt(1, c);
    expect(c.getHex()).toBe(0x336699);

    const plain = new THREE.Group();
    addInstancedParts(plain, 'kernel:plain', onePart(), twoSites, new THREE.Matrix4());
    expect((plain.children[0] as THREE.InstancedMesh).instanceColor).toBeNull();
  });

  it('adds nothing for an empty site list', () => {
    const group = new THREE.Group();
    addInstancedParts(group, 'kernel:empty', onePart(), [], new THREE.Matrix4());
    expect(group.children).toHaveLength(0);
  });
});
