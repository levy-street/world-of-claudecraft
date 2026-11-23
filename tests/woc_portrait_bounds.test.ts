import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { WocCharacterManifest } from '../src/render/characters/woc_character_manifest';
import { WOC_HEAD_TYPES } from '../src/render/characters/woc_head_catalog';
import { WOC_HEAD_WRAPPER } from '../src/render/characters/woc_head_packs';
import {
  measureWocPortraitBounds,
  measureWocPortraitHead,
  uncoverWocPortraitHead,
} from '../src/render/characters/woc_portrait_bounds';

const manifest: WocCharacterManifest = {
  schemaVersion: 1,
  rigId: 'portrait-fixture',
  fit: 'male',
  baseNodes: ['Body'],
  appearance: {},
  defaultAppearance: {},
  armorSlots: { head: { label: 'Head' } },
  items: { helm: { label: 'Helm', slot: 'head', set: 'fixture', nodes: ['Helm'] } },
  defaultEquipment: { head: 'helm' },
  animationNames: [],
};

describe('WOC portrait bounds', () => {
  it('samples the posed skin after updating bone siblings and ignores cached culling/proxy boxes', () => {
    const root = new THREE.Group();
    const geometry = new THREE.BoxGeometry(1, 2, 1).translate(0, 1, 0);
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute(
      'skinIndex',
      new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4),
    );
    const weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) weights[i * 4] = 1;
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    const body = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    body.name = 'Body';
    const bone = new THREE.Bone();
    // The bone is a later sibling, the ordering that cached a stale skin box.
    root.add(body, bone);
    body.bind(new THREE.Skeleton([bone]));
    body.boundingBox = new THREE.Box3(
      new THREE.Vector3(-20, -20, -20),
      new THREE.Vector3(20, 20, 20),
    );
    bone.position.y = 1;
    const helm = new THREE.Group();
    helm.name = 'Helm';
    const primitive = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5));
    primitive.position.y = 4;
    helm.add(primitive);
    root.add(helm);
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100));
    proxy.name = 'character_shadow_proxy';
    proxy.visible = false;
    root.add(proxy);
    const heldWeapon = new THREE.Mesh(new THREE.BoxGeometry(200, 200, 200));
    heldWeapon.userData.weaponMesh = true;
    bone.add(heldWeapon);

    const bounds = new THREE.Box3();
    expect(measureWocPortraitBounds(root, manifest, bounds)).toBe(true);
    expect(bounds.min.toArray()).toEqual([-0.5, 1, -0.5]);
    expect(bounds.max.toArray()).toEqual([0.5, 4.25, 0.5]);
    expect(body.boundingBox.max.y).toBe(20); // culling policy is untouched
    helm.visible = false;
    expect(measureWocPortraitBounds(root, manifest, bounds)).toBe(true);
    expect(bounds.max.y).toBe(3);
    body.visible = false;
    expect(measureWocPortraitBounds(root, manifest, bounds)).toBe(false);
    body.skeleton.dispose();
  });
});

/** A rigid box piece: `name` spanning y [y0, y1], centred on x, at depth z. */
function piece(name: string, x: number, y0: number, y1: number, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, y1 - y0, 0.2));
  mesh.name = name;
  mesh.position.set(x, (y0 + y1) / 2, z);
  return mesh;
}

/** A body with a hung Type A head: the wrapper group rides the head bone, as
 *  woc_head_packs.ts hangWocHead leaves it. */
function hungHead() {
  const root = new THREE.Group();
  const bone = new THREE.Bone();
  bone.name = 'head';
  bone.position.y = 1;
  root.add(bone);
  const wrapper = new THREE.Group();
  wrapper.userData[WOC_HEAD_WRAPPER] = 'a';
  bone.add(wrapper);
  const base = piece('WocHead_A_base', 0, 0.2, 0.7, 0.05);
  // a paired piece is a group of primitives, like the shipped eyes
  const eyes = new THREE.Group();
  eyes.name = 'WocHead_A_eyes_default_L';
  eyes.add(piece('WocHead_A_eyes_default_L_1', 0.08, 0.46, 0.5, 0.15));
  const eyesR = new THREE.Group();
  eyesR.name = 'WocHead_A_eyes_default_R';
  eyesR.add(piece('WocHead_A_eyes_default_R_1', -0.04, 0.46, 0.5, 0.15));
  const hair = piece('WocHead_A_hair_swept', 0, 0.5, 0.95);
  const hidden = piece('WocHead_A_hair_long', 0, 0.3, 4);
  hidden.visible = false;
  wrapper.add(base, eyes, eyesR, hair, hidden);
  return { root, wrapper, base, hair, hidden };
}

// Geometry positions are float32, so world values agree to about 1e-7.
describe('WOC portrait head measure', () => {
  it('measures the drawn head pieces: the base box, the eye line, the top of the hair', () => {
    const { root } = hungHead();
    const head = measureWocPortraitHead(root, 'a');
    expect(head).not.toBeNull();
    if (!head) return;
    // world space: the head bone stands 1 up
    expect(head.baseMinY).toBeCloseTo(1.2, 6);
    expect(head.baseMaxY).toBeCloseTo(1.7, 6);
    expect(head.eyeY).toBeCloseTo(1.48, 6);
    // the face's centre is the drawn eyes' (x -0.14..0.18), not the base's (0)
    expect(head.centerX).toBeCloseTo(0.02, 6);
    expect(head.centerZ).toBeCloseTo(0.05, 6);
    // the drawn hair tops the crown; the hidden long hair (to y 5) is not drawn
    expect(head.topY).toBeCloseTo(1.95, 6);
  });

  it('reads only a hung head of its own type, never a stray node of the same name', () => {
    const { root } = hungHead();
    // the body's retired face and a far-bake copy carry piece-like names outside a wrapper
    const stray = piece('WocHead_A_base', 0, -5, 20);
    root.add(stray);
    const other = new THREE.Group();
    other.userData[WOC_HEAD_WRAPPER] = 'b';
    other.add(piece('WocHead_B_base', 0, -3, 30));
    root.add(other);
    const head = measureWocPortraitHead(root, 'a');
    expect(head?.baseMinY).toBeCloseTo(1.2, 6);
    expect(head?.topY).toBeCloseTo(1.95, 6);
    expect(measureWocPortraitHead(root, 'b')?.baseMinY).toBeCloseTo(-3, 6);
  });

  it('follows the posed head bone: a lowered head frames lower', () => {
    const { root } = hungHead();
    const bone = root.getObjectByName('head');
    if (!bone) throw new Error('fixture has a head bone');
    bone.position.y = 0.5;
    expect(measureWocPortraitHead(root, 'a')?.baseMinY).toBeCloseTo(0.7, 6);
  });

  it('answers null with no hung head or a hidden one, and drops a hidden eye', () => {
    expect(measureWocPortraitHead(new THREE.Group(), 'a')).toBeNull();
    const { root, wrapper, base } = hungHead();
    for (const eye of wrapper.children.filter((c) => c.name.includes('_eyes_'))) {
      eye.visible = false;
    }
    const noEyes = measureWocPortraitHead(root, 'a');
    expect(noEyes?.eyeY).toBeNull();
    // with no eyes the centre falls back to the base's
    expect(noEyes?.centerX).toBeCloseTo(0, 6);
    base.visible = false;
    expect(measureWocPortraitHead(root, 'a')).toBeNull();
    base.visible = true;
    wrapper.visible = false;
    expect(measureWocPortraitHead(root, 'a')).toBeNull();
  });
});

describe('WOC portrait head uncover', () => {
  function rigWithHelm() {
    const built = hungHead();
    const helm = new THREE.Group();
    helm.name = 'Helm';
    helm.add(piece('Helm_shell', 0, 1.2, 2.2));
    built.root.add(helm);
    // under a helm the dressing hides the hair and raises the bald crown
    built.hair.visible = false;
    built.base.morphTargetDictionary = { FS_Bald_Crown: 0 };
    built.base.morphTargetInfluences = [1];
    return { ...built, helm };
  }

  it('takes the helm off and shows the hair the look draws, crown back down', () => {
    const { root, helm, hair, hidden, base } = rigWithHelm();
    uncoverWocPortraitHead(root, manifest, WOC_HEAD_TYPES.a.defaults);
    expect(helm.visible).toBe(false);
    // Type A's default hairstyle is the swept hair: drawn; the long hair is not the look
    expect(WOC_HEAD_TYPES.a.defaults.hair).toBe('swept');
    expect(hair.visible).toBe(true);
    expect(hidden.visible).toBe(false);
    expect(base.visible).toBe(true);
    expect(base.morphTargetInfluences?.[0]).toBe(0);
    // the measure then sees the hair, not the helm shell
    expect(measureWocPortraitHead(root, 'a')?.topY).toBeCloseTo(1.95, 6);
  });

  it('keeps a bald look bald: the crown stays raised, no hair shows', () => {
    const { root, hair, base } = rigWithHelm();
    uncoverWocPortraitHead(root, manifest, { ...WOC_HEAD_TYPES.a.defaults, hair: 'bald' });
    expect(hair.visible).toBe(false);
    expect(base.morphTargetInfluences?.[0]).toBe(1);
  });

  it('with no head look, only the helm comes off', () => {
    const { root, helm, hair } = rigWithHelm();
    uncoverWocPortraitHead(root, manifest, null);
    expect(helm.visible).toBe(false);
    expect(hair.visible).toBe(false);
  });
});
