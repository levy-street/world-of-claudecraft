// @vitest-environment happy-dom
// A WOC key's shadow stand-in (src/render/characters/woc_shadow_stand_in.ts and its pure
// core): what a WOC body casts in the proxy band until its own far bake can. The key used
// to bake a whole far mesh here that no body ever drew: the bare body at REST (arms out),
// with the class default weapon and no head. The stand-in is the bare body MID-IDLE, an
// ellipsoid for the head its base file does not carry, never a held prop, positions only,
// and only the vertices its far index draws. assets.ts prepareVisual bakes it once per
// key and every body of the key mounts it hidden at construction.
import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WOC_ANATOMY_TOP } from '../src/render/characters/woc_armor_core';
import { bakeWocShadowStandIn } from '../src/render/characters/woc_shadow_stand_in';
import {
  WOC_STAND_IN_HEAD,
  wocStandInHead,
} from '../src/render/characters/woc_shadow_stand_in_core';
import {
  HEAD_BONE_Y,
  IDLE,
  IDLE_HEAD_LIFT,
  IDLE_SHIFT,
  KEY,
  releaseWocFarFixture,
  wocFarFixture,
} from './helpers/woc_far_fixture';

/** Vertices of the stand-in's head ellipsoid. */
const HEAD_VERTICES = new THREE.SphereGeometry(1, 8, 6).getAttribute('position').count;

function boxOf(geometry: THREE.BufferGeometry, from: number, to: number): THREE.Box3 {
  const position = geometry.getAttribute('position');
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = from; i < to; i++) box.expandByPoint(v.fromBufferAttribute(position, i));
  return box;
}

beforeAll(async () => {
  await import('../src/render/characters/visual');
}, 180_000);

afterEach(() => releaseWocFarFixture());

describe('the stand-in head is sized from the neck and the crown', () => {
  it('ends at the crown, reaches into the neck, and sits forward of the bone', () => {
    const head = wocStandInHead(1, 1.2, [0.03, 1.02, -0.01]);
    if (!head) throw new Error('no head');
    const span = 0.2;
    expect(head.radii[0]).toBeCloseTo((span * WOC_STAND_IN_HEAD.width) / 2, 10);
    expect(head.radii[1]).toBeCloseTo((span * WOC_STAND_IN_HEAD.height) / 2, 10);
    expect(head.radii[2]).toBeCloseTo((span * WOC_STAND_IN_HEAD.depth) / 2, 10);
    // its top is the crown exactly: no hairstyle, no helm, the anatomy's own height
    expect(head.center[1] + head.radii[1]).toBeCloseTo(1.2, 10);
    // ...and its bottom is below the top of the neck, so the two shadows join
    expect(head.center[1] - head.radii[1]).toBeLessThan(1);
    // centred on the bone across, a little forward of it (a face is)
    expect(head.center[0]).toBe(0.03);
    expect(head.center[2]).toBeCloseTo(-0.01 + span * WOC_STAND_IN_HEAD.forward, 10);
    // a head is taller than deep and deeper than wide
    expect(head.radii[1]).toBeGreaterThan(head.radii[2]);
    expect(head.radii[2]).toBeGreaterThan(head.radii[0]);
  });

  it('stands in for nothing where there is no head to stand in for', () => {
    expect(wocStandInHead(1, 1, [0, 0, 0])).toBeNull();
    expect(wocStandInHead(1.2, 1, [0, 0, 0])).toBeNull();
    // an empty measure (no body mesh at all): the neck is nowhere
    expect(wocStandInHead(Number.NEGATIVE_INFINITY, 1, [0, 0, 0])).toBeNull();
    expect(wocStandInHead(Number.NaN, 1, [0, 0, 0])).toBeNull();
  });
});

/** A bare body on a root bone with a head bone above it: a box from the ground to y = 1
 *  whose index draws only its first `drawn` triangles, and an idle clip that moves the
 *  rig off its rest pose (the root across, the head up and, when asked, tipped over). */
function rig(opts: { drawn?: number; tipHead?: boolean; headBone?: boolean } = {}) {
  const model = new THREE.Group();
  const root = new THREE.Bone();
  root.name = 'root';
  model.add(root);
  const bones = [root];
  if (opts.headBone !== false) {
    const head = new THREE.Bone();
    head.name = 'head';
    head.position.set(0, 1, 0);
    root.add(head);
    bones.push(head);
  }
  const geometry = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);
  geometry.translate(0, 0.5, 0);
  const count = geometry.getAttribute('position').count;
  if (opts.drawn !== undefined && geometry.index) {
    geometry.setIndex([...geometry.index.array].slice(0, opts.drawn * 3));
  }
  geometry.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4),
  );
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const body = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  model.add(body);
  model.updateMatrixWorld(true);
  body.bind(new THREE.Skeleton(bones));
  const tip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const tracks: THREE.KeyframeTrack[] = [
    new THREE.VectorKeyframeTrack('root.position', [0, 1], [2, 0, 0, 2, 0, 0]),
  ];
  if (opts.headBone !== false) {
    tracks.push(new THREE.VectorKeyframeTrack('head.position', [0, 1], [0, 1.5, 0, 0, 1.5, 0]));
    if (opts.tipHead) {
      tracks.push(
        new THREE.QuaternionKeyframeTrack(
          'head.quaternion',
          [0, 1],
          [...tip.toArray(), ...tip.toArray()],
        ),
      );
    }
  }
  return { model, root, body, idle: new THREE.AnimationClip('Idle', 1, tracks), count };
}

/** Twice the size, lifted a little: a norm whose every term shows in the result. */
const NORM = new THREE.Matrix4()
  .makeTranslation(0, 0.1, 0)
  .multiply(new THREE.Matrix4().makeScale(2, 2, 2));
const NECK = 1;
const CROWN = 1.4;

describe('the stand-in bake', () => {
  it('poses the body mid-idle, never at rest, and leaves the rig as it found it', () => {
    const { model, root, body, idle, count } = rig();
    const geometry = bakeWocShadowStandIn(model, [body], idle, NORM, NECK, CROWN);
    if (!geometry) throw new Error('no stand-in');
    // the whole box is drawn by its index: every vertex, then the head's
    expect(geometry.getAttribute('position').count).toBe(count + HEAD_VERTICES);
    const bodyBox = boxOf(geometry, 0, count);
    // the idle put the root two units across: the body is THERE (times the norm), and at
    // rest it would straddle the origin
    expect(bodyBox.min.x).toBeCloseTo((2 - 0.5) * 2, 5);
    expect(bodyBox.max.x).toBeCloseTo((2 + 0.5) * 2, 5);
    expect(bodyBox.min.y).toBeCloseTo(0.1, 5);
    expect(bodyBox.max.y).toBeCloseTo(1 * 2 + 0.1, 5);
    // the clip's bindings are released: the rig is back at rest for whoever reads it next
    expect(root.position.x).toBe(0);
    expect(model.getObjectByName('head')?.position.y).toBe(1);
  });

  it('gives the body the head its file does not carry, riding the head bone through the idle', () => {
    const { model, body, idle, count } = rig();
    const geometry = bakeWocShadowStandIn(model, [body], idle, NORM, NECK, CROWN);
    if (!geometry) throw new Error('no stand-in');
    const head = wocStandInHead(NECK, CROWN, [0, 0, 0]);
    if (!head) throw new Error('no head');
    const box = boxOf(geometry, count, count + HEAD_VERTICES);
    // at rest it would end at the crown; the idle carries its bone two across and half up
    expect(box.max.y).toBeCloseTo((CROWN + 0.5) * 2 + 0.1, 5);
    expect(box.min.y).toBeCloseTo((CROWN + 0.5 - 2 * head.radii[1]) * 2 + 0.1, 5);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(2 * 2, 5);
    expect(box.max.x - box.min.x).toBeCloseTo(2 * head.radii[0] * 2, 5);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(head.center[2] * 2, 5);
    // without the head the silhouette stops at the neck: about a seventh short here
    const bare = boxOf(geometry, 0, count);
    expect(box.max.y).toBeGreaterThan(bare.max.y + 0.5);
  });

  it('turns the head with its bone: a tipped head is a tipped ellipsoid', () => {
    const { model, body, idle, count } = rig({ tipHead: true });
    const geometry = bakeWocShadowStandIn(model, [body], idle, NORM, NECK, CROWN);
    if (!geometry) throw new Error('no stand-in');
    const head = wocStandInHead(NECK, CROWN, [0, 0, 0]);
    if (!head) throw new Error('no head');
    const box = boxOf(geometry, count, count + HEAD_VERTICES);
    // a quarter turn about z: its height lies across now, its width stands up
    expect(box.max.x - box.min.x).toBeCloseTo(2 * head.radii[1] * 2, 5);
    expect(box.max.y - box.min.y).toBeCloseTo(2 * head.radii[0] * 2, 5);
  });

  it('bakes only the vertices its index draws, positions alone', () => {
    const { model, body, idle, count } = rig({ drawn: 2 });
    const geometry = bakeWocShadowStandIn(model, [body], idle, NORM, NECK, CROWN);
    if (!geometry) throw new Error('no stand-in');
    // two triangles of one box face: four of the box's vertices, not all of them
    const baked = geometry.getAttribute('position').count - HEAD_VERTICES;
    expect(baked).toBe(4);
    expect(baked).toBeLessThan(count);
    // the same two triangles, over the compacted vertices
    const index = [...(geometry.index?.array ?? [])];
    expect(index.slice(0, 6).every((i) => i < 4)).toBe(true);
    expect(new Set(index.slice(0, 6)).size).toBe(4);
    // a shadow-only mesh: no normal, no uv, no skin
    expect(Object.keys(geometry.attributes)).toEqual(['position']);
  });

  it('bakes the rest pose with no idle clip, a bare body with no head bone, and nothing from nothing', () => {
    const still = rig();
    const rest = bakeWocShadowStandIn(still.model, [still.body], undefined, NORM, NECK, CROWN);
    if (!rest) throw new Error('no stand-in');
    expect(boxOf(rest, 0, still.count).min.x).toBeCloseTo(-0.5 * 2, 5);
    const headless = rig({ headBone: false });
    const bare = bakeWocShadowStandIn(
      headless.model,
      [headless.body],
      headless.idle,
      NORM,
      NECK,
      CROWN,
    );
    expect(bare?.getAttribute('position').count).toBe(headless.count);
    expect(bakeWocShadowStandIn(headless.model, [], headless.idle, NORM, NECK, CROWN)).toBeNull();
  });
});

describe('the stand-in bake walks any mesh of the body', () => {
  it('bakes a rigid, unindexed part by its own world matrix, every vertex in order', () => {
    // a part hung rigid on a bone (an ear, a hand prop of the anatomy): no skin, no index
    const { model, root, body, idle, count } = rig({ headBone: false });
    const part = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.2, 0.2).toNonIndexed(),
      new THREE.MeshStandardMaterial(),
    );
    part.position.set(0, 3, 0);
    root.add(part);
    const partCount = part.geometry.getAttribute('position').count;
    expect(part.geometry.index).toBeNull();
    const geometry = bakeWocShadowStandIn(model, [body, part], idle, NORM, NECK, CROWN);
    if (!geometry) throw new Error('no stand-in');
    expect(geometry.getAttribute('position').count).toBe(count + partCount);
    // the idle carries the root two across: the part rides it, three up, then the norm
    const box = boxOf(geometry, count, count + partCount);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(2 * 2, 5);
    expect((box.min.y + box.max.y) / 2).toBeCloseTo(3 * 2 + 0.1, 5);
    expect(box.max.x - box.min.x).toBeCloseTo(0.2 * 2, 5);
    // unindexed: drawn in order, one index per vertex
    const index = [...(geometry.index?.array ?? [])].slice(-partCount);
    expect(index).toEqual(Array.from({ length: partCount }, (_, i) => count + i));
  });
});

describe('a WOC key bakes its stand-in where its far mesh used to be baked', () => {
  it('bakes no far mesh for the key: only the stand-in, mid-idle, with a head and no prop', async () => {
    const f = await wocFarFixture();
    const prep = f.assets.prepareVisual(KEY);
    expect(prep.idleGeo).toBeNull();
    expect(prep.idleSrcMats).toEqual([]);
    expect(prep.idleSrcIsBody).toEqual([]);
    const standIn = prep.shadowGeo;
    if (!standIn) throw new Error('no stand-in');
    expect(Object.keys(standIn.attributes)).toEqual(['position']);
    // the body and the head: never the blade the def holds (a stand-in is shared by every
    // body of the key, whatever it holds), which would be another box and stand two tall
    expect(standIn.getAttribute('position').count).toBe(f.bodyVertices + HEAD_VERTICES);
    const body = boxOf(standIn, 0, f.bodyVertices);
    // the fixture's idle carries the body across: at rest it would straddle the origin
    const across = Math.abs((body.min.x + body.max.x) / 2);
    expect(across).toBeCloseTo(IDLE_SHIFT * prep.normScale, 4);
    // the head ends at the crown the body is normalized by, lifted as the idle lifts its bone
    standIn.computeBoundingBox();
    const top = standIn.boundingBox?.max.y ?? 0;
    expect(top).toBeCloseTo(
      prep.yOffset + (WOC_ANATOMY_TOP.male + IDLE_HEAD_LIFT) * prep.normScale,
      4,
    );
    // the neck is where the body's box ends (half a unit up, the head bone's own height)
    expect(HEAD_BONE_Y).toBe(0.5);
    expect(top).toBeGreaterThan(body.max.y);
  });

  it('mounts it hidden on every body of the key: one shared geometry, the shadow-only material', async () => {
    const f = await wocFarFixture();
    const prep = f.assets.prepareVisual(KEY);
    const a = f.body();
    const b = f.body();
    const standIn = (v: typeof a): THREE.Mesh =>
      v.root.getObjectByName('character_shadow_stand_in') as THREE.Mesh;
    expect(standIn(a).geometry).toBe(prep.shadowGeo);
    expect(standIn(b).geometry).toBe(prep.shadowGeo);
    expect(standIn(a).material).toBe(standIn(b).material);
    const material = standIn(a).material as THREE.MeshBasicMaterial;
    expect(material.colorWrite).toBe(false);
    expect(material.depthWrite).toBe(false);
    expect(standIn(a).castShadow).toBe(true);
    expect(standIn(a).visible).toBe(false);
    // it follows the body's own size, as the far mesh does
    a.setWocEquipment({}, false);
    expect(a.setBodyScale(0.95)).toBe(true);
    a.root.updateMatrixWorld(true);
    expect(new THREE.Vector3().setFromMatrixScale(standIn(a).matrixWorld).y).toBeCloseTo(0.95, 6);
    // a body goes; the key's geometry stays for the others
    const disposed = vi.spyOn(prep.shadowGeo as THREE.BufferGeometry, 'dispose');
    a.dispose();
    expect(disposed).not.toHaveBeenCalled();
    b.dispose();
  });

  it('bakes none and mounts none on a tier that casts no dynamic shadow', async () => {
    const f = await wocFarFixture({ lowTier: true });
    const prep = f.assets.prepareVisual(KEY);
    expect(prep.idleGeo).toBeNull();
    expect(prep.shadowGeo).toBeNull();
    const v = f.body();
    expect(v.root.getObjectByName('character_shadow_stand_in')).toBeUndefined();
    // the plan may still ask (it does not, without shadows): nothing to show, nothing thrown
    v.setWocEquipment({}, false);
    v.setProxyShadow(true);
    expect(v.root.getObjectByName('character_shadow_proxy')).toBeUndefined();
    v.dispose();
  });

  it('bakes none on a tier above low that casts no dynamic shadow either (a constrained-memory profile)', async () => {
    // the rule is the shadow setting, not the tier name: such a profile is medium or high
    // by name and still casts nothing
    const f = await wocFarFixture();
    const gfx = await import('../src/render/gfx');
    expect(gfx.GFX.tier).not.toBe('low');
    const restore = gfx.gfxInternalsForTest.overrideSettings({ dynamicShadows: false });
    try {
      const prep = f.assets.prepareVisual(KEY);
      expect(prep.idleGeo).toBeNull();
      expect(prep.shadowGeo).toBeNull();
      const v = f.body();
      expect(v.root.getObjectByName('character_shadow_stand_in')).toBeUndefined();
      v.setWocEquipment({}, false);
      v.setProxyShadow(true);
      v.update(0.016, IDLE, true);
      expect(v.root.getObjectByName('character_far_mesh')).toBeUndefined();
      v.dispose();
    } finally {
      restore();
    }
  });
});
