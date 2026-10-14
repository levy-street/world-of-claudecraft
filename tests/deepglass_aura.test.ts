import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DeepglassAuras, isHullable } from '../src/render/deepglass_aura';

function skinnedBody(name: string): THREE.SkinnedMesh {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute(new Array(geo.attributes.position.count * 4).fill(0), 4),
  );
  const w = new Float32Array(geo.attributes.position.count * 4);
  for (let i = 0; i < w.length; i += 4) w[i] = 1;
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
  const bone = new THREE.Bone();
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  mesh.name = name;
  return mesh;
}

describe('Deepglass team aura hulls', () => {
  it('never twins the shadow proxy or any shadow-only mesh', () => {
    // The proxy is a STATIC idle-pose copy that only casts a shadow in the
    // mid band while the articulated rig is still the visible body. Its twin
    // was an upright, unanimated outline standing inside the swimming one.
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(1, 2, 1),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
    );
    proxy.name = 'character_shadow_proxy';
    expect(isHullable(proxy)).toBe(false);
    // The tell alone is enough: a renamed shadow-only helper stays out too.
    const helper = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial({ colorWrite: false }),
    );
    helper.name = 'something_else';
    expect(isHullable(helper)).toBe(false);
    // ...while an ordinary drawn body mesh is still outlined.
    expect(
      isHullable(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())),
    ).toBe(true);
  });

  it('builds skinned twins for the rig only, sharing its skeleton', () => {
    const root = new THREE.Group();
    const poseWrap = new THREE.Group();
    root.add(poseWrap);
    const body = skinnedBody('body');
    poseWrap.add(body);
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(1, 2, 1),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
    );
    proxy.name = 'character_shadow_proxy';
    poseWrap.add(proxy);

    const auras = new DeepglassAuras();
    auras.update(0.1, [{ id: 7, root, team: 'A', isSelf: false, carrying: false }]);

    const twins: THREE.Mesh[] = [];
    root.traverse((o) => {
      if (o.name.startsWith('dg-aura:')) twins.push(o as THREE.Mesh);
    });
    expect(twins.map((t) => t.name)).toEqual(['dg-aura:body']);
    const twin = twins[0] as THREE.SkinnedMesh;
    expect(twin.isSkinnedMesh).toBe(true);
    expect(twin.skeleton).toBe(body.skeleton);
    expect(twin.parent).toBe(body);
    expect(proxy.children.length).toBe(0);
    auras.dispose();
  });
});
