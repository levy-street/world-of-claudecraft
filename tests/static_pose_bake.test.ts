// The posed static bake (src/render/characters/static_pose_bake.ts) as a RESUMABLE bake:
// a far LOD's bake is units of the renderer's work queue (woc_far_bake.ts), so the baker
// transforms a band of vertices per call, and whatever the bands are it must end with the
// very geometry the one-shot bakeStaticPose builds (positions, normals, uvs, triangles,
// groups, and the per-group lists a far set is resolved through).
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  bakeStaticPose,
  farBakeGroupKey,
  type StaticPoseBake,
  StaticPoseBaker,
} from '../src/render/characters/static_pose_bake';

/** A posed walk: a skinned body on a bent two-bone rig, a rigid part on a moved node, a
 *  colour-only part with no uv, and a second mesh on the body's material (one group). */
function walk(): THREE.Mesh[] {
  const root = new THREE.Group();
  const lower = new THREE.Bone();
  const upper = new THREE.Bone();
  upper.position.set(0, 1, 0);
  lower.add(upper);
  root.add(lower);
  const bodyMaterial = new THREE.MeshStandardMaterial({ name: 'body' });
  const geometry = new THREE.BoxGeometry(0.5, 2, 0.5, 1, 4, 1);
  const count = geometry.getAttribute('position').count;
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    // the upper half follows the upper bone, the seam blends
    const y = geometry.getAttribute('position').getY(i);
    const w = Math.min(1, Math.max(0, y + 0.5));
    skinIndex[i * 4 + 1] = 1;
    skinWeight[i * 4] = 1 - w;
    skinWeight[i * 4 + 1] = w;
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  const body = new THREE.SkinnedMesh(geometry, bodyMaterial);
  body.userData.bodyMesh = true;
  root.add(body);
  root.updateMatrixWorld(true);
  body.bind(new THREE.Skeleton([lower, upper]));
  // the pose: the upper bone bent and lifted
  upper.rotation.set(0.4, 0.2, -0.3);
  upper.position.y = 1.2;

  const rigid = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 6, 4),
    new THREE.MeshStandardMaterial({ name: 'helm' }),
  );
  rigid.position.set(0.1, 2.3, -0.2);
  rigid.rotation.y = 0.7;
  rigid.scale.set(1, 1.3, 0.8);
  upper.add(rigid);

  const flat = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.1, 0.1),
    new THREE.MeshStandardMaterial({ name: 'eye' }),
  );
  flat.geometry.deleteAttribute('uv');
  flat.position.set(0, 2.4, 0.3);
  root.add(flat);

  const twin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), bodyMaterial);
  twin.userData.bodyMesh = true;
  twin.position.set(0.5, 1, 0);
  root.add(twin);

  root.position.set(3, 0, -1);
  root.updateMatrixWorld(true);
  return [body, rigid, flat, twin];
}

const NORM = new THREE.Matrix4()
  .makeTranslation(0, 0.25, 0)
  .multiply(new THREE.Matrix4().makeRotationY(Math.PI))
  .multiply(new THREE.Matrix4().makeScale(1.5, 1.5, 1.5));

const total = (meshes: readonly THREE.Mesh[]): number =>
  meshes.reduce((n, mesh) => n + mesh.geometry.getAttribute('position').count, 0);

/** Everything of a bake a far set reads, as plain data. */
function facts(bake: StaticPoseBake) {
  const geo = bake.geo;
  if (!geo) return null;
  return {
    position: [...geo.getAttribute('position').array],
    normal: [...geo.getAttribute('normal').array],
    uv: [...geo.getAttribute('uv').array],
    index: [...(geo.index?.array ?? [])],
    groups: geo.groups.map((g) => [g.start, g.count, g.materialIndex]),
    mats: bake.mats.map((m) => m.name),
    isBody: bake.isBody,
    slots: bake.slots,
    order: bake.order,
  };
}

describe('the banded bake is the one-shot bake', () => {
  it.each([1, 7, 24, 100, 4096])('in bands of %i vertices', (band) => {
    const whole = facts(bakeStaticPose(NORM, walk()));
    const meshes = walk();
    const baker = new StaticPoseBaker(NORM, meshes);
    let calls = 0;
    while (!baker.advance(band)) calls++;
    // the walk really was cut: a band smaller than the walk takes more than one call
    if (band < total(meshes)) expect(calls).toBeGreaterThan(0);
    const banded = facts(baker.finish());
    expect(whole).not.toBeNull();
    expect(banded).toEqual(whole);
    // four meshes on three materials: the two body meshes share one group
    expect(whole?.groups).toHaveLength(3);
    expect(whole?.mats).toEqual(['body', 'helm', 'eye']);
    expect(whole?.isBody).toEqual([true, false, false]);
    expect(whole?.slots).toEqual([0, 1, 2]);
    expect(whole?.order).toEqual([0, 3, 1, 2]);
  });

  it('keeps a caller key and the group order through the bands', () => {
    const key = (mesh: THREE.Mesh): string =>
      mesh.geometry.getAttribute('uv') ? farBakeGroupKey(mesh) : 'flat';
    const whole = facts(bakeStaticPose(NORM, walk(), key));
    const baker = new StaticPoseBaker(NORM, walk());
    while (!baker.advance(13)) {
      // a band at a time
    }
    expect(facts(baker.finish(key))).toEqual(whole);
  });
});

describe('a band is a budget', () => {
  it('transforms at most the band, and says how much is left', () => {
    const meshes = walk();
    const all = total(meshes);
    const baker = new StaticPoseBaker(NORM, meshes);
    expect(baker.remaining).toBe(all);
    let left = all;
    while (left > 0) {
      const done = baker.advance(10);
      left = Math.max(0, left - 10);
      expect(baker.remaining).toBe(left);
      expect(done).toBe(left === 0);
    }
    // nothing left to do: another band is a no-op that still answers done
    expect(baker.advance(10)).toBe(true);
    expect(baker.remaining).toBe(0);
  });

  it('ends a band exactly on a mesh boundary without touching the next mesh', () => {
    const meshes = walk();
    const first = meshes[0].geometry.getAttribute('position').count;
    const baker = new StaticPoseBaker(NORM, meshes);
    expect(baker.advance(first)).toBe(false);
    expect(baker.remaining).toBe(total(meshes) - first);
  });

  it('finishes whatever the bands left: finish alone is the whole bake', () => {
    const whole = facts(bakeStaticPose(NORM, walk()));
    const baker = new StaticPoseBaker(NORM, walk());
    baker.advance(5);
    expect(facts(baker.finish())).toEqual(whole);
  });

  it('transforms nothing on a spent band: zero never buys the whole walk', () => {
    // guards: a caller hands over what is left of its band after another step (the head's
    // morphs, woc_far_bake.ts), and a zero read as "everything" baked a whole body in
    // that one unit
    const meshes = walk();
    const all = total(meshes);
    const baker = new StaticPoseBaker(NORM, meshes);
    const body = meshes[0] as THREE.SkinnedMesh;
    const skinned = vi.spyOn(body, 'applyBoneTransform');
    for (const spent of [0, -5, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(baker.advance(spent), String(spent)).toBe(false);
      expect(baker.remaining, String(spent)).toBe(all);
    }
    expect(skinned).not.toHaveBeenCalled();
    // ...and a real band still moves it on by exactly that many
    expect(baker.advance(10)).toBe(false);
    expect(skinned).toHaveBeenCalledTimes(10);
    expect(baker.remaining).toBe(all - 10);
    // everything, when a caller says so by leaving the band out
    expect(baker.advance()).toBe(true);
    expect(baker.remaining).toBe(0);
  });
});

describe('where a baked vertex lands', () => {
  // The cases above compare the baker with itself (the one-shot form IS the banded one),
  // so these place vertices from the rig's own transforms, composed here by hand: a
  // transform that went wrong on its way out of assets.ts would move both sides of those.
  const bakedAt = (bake: StaticPoseBake, i: number): THREE.Vector3 =>
    new THREE.Vector3().fromBufferAttribute(
      bake.geo?.getAttribute('position') as THREE.BufferAttribute,
      i,
    );

  it('puts a rigid vertex at norm x world x local, and a skinned one where its bone carried it', () => {
    const meshes = walk();
    const [body, rigid, , twin] = meshes;
    const bake = bakeStaticPose(NORM, meshes);
    // groups in merge order: the body, its twin (one group), the rigid part, the flat one
    expect(bake.order).toEqual([0, 3, 1, 2]);
    const bodyCount = body.geometry.getAttribute('position').count;
    const twinCount = twin.geometry.getAttribute('position').count;

    // a rigid part: its own world matrix, then the norm
    const local = new THREE.Vector3().fromBufferAttribute(
      rigid.geometry.getAttribute('position'),
      5,
    );
    const rigidWant = local.clone().applyMatrix4(rigid.matrixWorld).applyMatrix4(NORM);
    const rigidGot = bakedAt(bake, bodyCount + twinCount + 5);
    expect(rigidGot.distanceTo(rigidWant)).toBeLessThan(1e-5);
    // (the part hangs off the bent bone: it is nowhere near its own local position)
    expect(rigidGot.distanceTo(local)).toBeGreaterThan(1);

    // the skinned body: a vertex wholly on the bent upper bone, and one wholly on the
    // unposed lower bone. The rig was bound at the origin with the upper bone one up; the
    // pose bent and lifted that bone, and the whole rig then moved to (3, 0, -1).
    const position = body.geometry.getAttribute('position');
    const weight = body.geometry.getAttribute('skinWeight');
    const on = (bone: number): number => {
      for (let i = 0; i < position.count; i++) if (weight.getComponent(i, bone) === 1) return i;
      throw new Error(`no vertex wholly on bone ${bone}`);
    };
    const moved = new THREE.Matrix4().makeTranslation(3, 0, -1);
    const bent = new THREE.Matrix4().compose(
      new THREE.Vector3(0, 1.2, 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.2, -0.3)),
      new THREE.Vector3(1, 1, 1),
    );
    const unbind = new THREE.Matrix4().makeTranslation(0, -1, 0);
    const upperAt = on(1);
    const upperWant = new THREE.Vector3()
      .fromBufferAttribute(position, upperAt)
      .applyMatrix4(unbind)
      .applyMatrix4(bent)
      .applyMatrix4(moved)
      .applyMatrix4(NORM);
    expect(bakedAt(bake, upperAt).distanceTo(upperWant)).toBeLessThan(1e-5);
    const lowerAt = on(0);
    const lowerWant = new THREE.Vector3()
      .fromBufferAttribute(position, lowerAt)
      .applyMatrix4(moved)
      .applyMatrix4(NORM);
    expect(bakedAt(bake, lowerAt).distanceTo(lowerWant)).toBeLessThan(1e-5);
    // the bend is real: the upper vertex is not where the unbent rig would put it
    const unbent = new THREE.Vector3()
      .fromBufferAttribute(position, upperAt)
      .applyMatrix4(moved)
      .applyMatrix4(NORM);
    expect(bakedAt(bake, upperAt).distanceTo(unbent)).toBeGreaterThan(0.1);
  });
});

describe('the bake reads the geometry each mesh held when it began', () => {
  it('ignores a geometry swapped in between two bands (a scratch handed over too late)', () => {
    const whole = facts(bakeStaticPose(NORM, walk()));
    const meshes = walk();
    const baker = new StaticPoseBaker(NORM, meshes);
    baker.advance(3);
    meshes[1].geometry = new THREE.BoxGeometry(9, 9, 9);
    expect(facts(baker.finish())).toEqual(whole);
  });
});

describe('a walk with nothing to bake', () => {
  it('answers no geometry, with lists of its own each time', () => {
    const a = bakeStaticPose(NORM, []);
    const b = bakeStaticPose(NORM, []);
    expect(a.geo).toBeNull();
    expect(a).toEqual({ geo: null, mats: [], isBody: [], slots: [], order: [] });
    // a caller appends to a bake's lists (woc_far_bake.ts): never to a shared empty one
    a.mats.push(new THREE.MeshBasicMaterial());
    expect(b.mats).toEqual([]);
    expect(new StaticPoseBaker(NORM, []).advance(8)).toBe(true);
  });
});
