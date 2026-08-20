// A composed body whose look pieces are not resident builds WITHOUT its face
// decals (the body is the stand-in: nothing a player reacts to is hidden) and
// attaches them later, through the compile gate, once the pieces land
// (src/render/characters/assets.ts attachFaceDecals / attachDeferredFaceDecals,
// CharacterVisual.attachDeferredDecals).
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachDeferredFaceDecals,
  attachFaceDecals,
  recolorMesh,
} from '../src/render/characters/assets';
import { lookPiecesStats, resetLookPiecesForTest } from '../src/render/characters/look_pieces';
import {
  ensureMakeupGeometry,
  makeupTextureData,
  makeupTextureFromData,
} from '../src/render/characters/makeup';
import { VISUALS } from '../src/render/characters/manifest';
import {
  DEFAULT_APPEARANCE,
  hairColor,
  MAT_STUBBLE,
  MODULAR_WARRIOR_KEY,
  type ModularAppearance,
  type ModularLook,
  makeupSelection,
  skinColor,
  stubbleDecals,
} from '../src/render/characters/modular';
import {
  DECAL_TEX_SIZE,
  decalTextureData,
  decalTextureFromData,
  ensureDecalGeometry,
} from '../src/render/characters/stubble';
import { CharacterVisual, type FarBakeGate } from '../src/render/characters/visual';

const DEF = VISUALS[MODULAR_WARRIOR_KEY];

function lookWith(app: Partial<ModularAppearance>): ModularLook {
  return { app: { ...DEFAULT_APPEARANCE, ...app }, worn: {} };
}

/** A composed clone of the real shape as far as the decals care: a group
 *  holding the head as a SkinnedMesh named after the gender, with one morph
 *  target under the name a face slider drives. */
function composedRoot(): { root: THREE.Group; head: THREE.SkinnedMesh } {
  const geo = new THREE.SphereGeometry(1, 24, 18);
  geo.scale(1, 0.95, 1.1);
  geo.computeVertexNormals();
  const pos = geo.getAttribute('position');
  const skinIndex = new Uint16Array(pos.count * 4);
  const skinWeight = new Float32Array(pos.count * 4);
  const morph = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    skinIndex[i * 4] = 0;
    skinWeight[i * 4] = 1;
    morph[i * 3 + 1] = 0.05 * pos.getY(i);
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geo.morphAttributes.position = [new THREE.BufferAttribute(morph, 3)];
  geo.morphTargetsRelative = true;
  const bone = new THREE.Bone();
  const head = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ name: 'mod_skin' }));
  head.name = 'M_Head';
  head.morphTargetDictionary = { nose_up: 0 };
  head.morphTargetInfluences = [0];
  head.add(bone);
  head.bind(new THREE.Skeleton([bone]));
  const root = new THREE.Group();
  root.add(head);
  return { root, head };
}

const decalsOf = (root: THREE.Object3D): THREE.Mesh[] =>
  root.children.filter((o) => o.userData.faceDecal) as THREE.Mesh[];

/** Make the look's pieces resident the way the queue does, off the given head. */
function publishPieces(look: ModularLook, head: THREE.SkinnedMesh): void {
  const stubble = stubbleDecals(look.app, look.worn);
  decalTextureFromData(stubble, decalTextureData(stubble, DECAL_TEX_SIZE));
  ensureDecalGeometry(head, stubble);
  const makeup = makeupSelection(look.app, look.worn);
  makeupTextureFromData(makeup, makeupTextureData(makeup));
  ensureMakeupGeometry(head);
}

describe('the compose step defers the face decals when allowed and the look is not ready', () => {
  it('leaves both decals off and flags the root when the pieces are not resident', () => {
    const look = lookWith({ hair: 'buzz', beard: 'stubble', blush: 'rose', eyeshadow: 'none' });
    const { root } = composedRoot();
    attachFaceDecals(root, DEF, look, { deferDecals: true });
    expect(decalsOf(root)).toEqual([]);
    expect(root.userData.deferredDecals).toBe(true);
  });

  it('attaches both decals at once without the option, ready or not (the synchronous compose)', () => {
    const look = lookWith({ hair: 'buzz', beard: 'stubble', blush: 'rose', eyeshadow: 'none' });
    const { root } = composedRoot();
    attachFaceDecals(root, DEF, look);
    expect(
      decalsOf(root)
        .map((d) => d.name)
        .sort(),
    ).toEqual(['ModMakeupDecal', 'ModStubbleDecal']);
    expect(root.userData.deferredDecals).toBeUndefined();
  });

  it('builds no decal and sets no flag with skipDecals, ready or not, and counts no deferral', () => {
    // The composed far bake's arm: its flatten drops every face decal, so the
    // compose it bakes must not mint the two decal maps (a whole synchronous
    // build per unseen style, on the per-frame far crossing) nor leave a
    // deferral behind for a late attach nobody will run.
    const before = lookPiecesStats().deferred;
    const look = lookWith({ hair: 'buzz', beard: 'stubble', blush: 'rose', eyeshadow: 'none' });
    const cold = composedRoot();
    attachFaceDecals(cold.root, DEF, look, { skipDecals: true, deferDecals: true });
    expect(decalsOf(cold.root)).toEqual([]);
    expect(cold.root.userData.deferredDecals).toBeUndefined();
    expect(attachDeferredFaceDecals(cold.root, look)).toEqual([]);
    const warm = composedRoot();
    publishPieces(look, warm.head);
    attachFaceDecals(warm.root, DEF, look, { skipDecals: true });
    expect(decalsOf(warm.root)).toEqual([]);
    expect(warm.root.userData.deferredDecals).toBeUndefined();
    expect(lookPiecesStats().deferred).toBe(before);
  });

  it('attaches at once with the option when every piece is resident (the ~1 ms cache-hit build)', () => {
    const look = lookWith({ hair: 'crew', beard: 'scruff', blush: 'peach', eyeshadow: 'plum' });
    const { root, head } = composedRoot();
    publishPieces(look, head);
    attachFaceDecals(root, DEF, look, { deferDecals: true });
    expect(decalsOf(root)).toHaveLength(2);
    expect(root.userData.deferredDecals).toBeUndefined();
    // and the late half then has nothing to do
    expect(attachDeferredFaceDecals(root, look)).toEqual([]);
    expect(decalsOf(root)).toHaveLength(2);
  });

  it('the late half adds the same two siblings, hair-tinted and morphed, and clears the flag', () => {
    const look = lookWith({
      hair: 'crew',
      beard: 'stubble',
      blush: 'rose',
      eyeshadow: 'teal',
      face: { ...DEFAULT_APPEARANCE.face, nose: 0.5 },
    });
    const { root, head } = composedRoot();
    attachFaceDecals(root, DEF, look, { deferDecals: true });
    expect(root.userData.deferredDecals).toBe(true);
    const decals = attachDeferredFaceDecals(root, look);
    expect(decals.map((d) => d.name)).toEqual(['ModStubbleDecal', 'ModMakeupDecal']);
    // siblings of the head, exactly where the synchronous compose puts them
    for (const decal of decals) expect(decal.parent).toBe(head.parent);
    expect(decalsOf(root)).toEqual(decals);
    expect(root.userData.deferredDecals).toBeUndefined();
    // the recolour sweep's write: the stubble decal wears the hair colour on
    // its own clone of the shared MAT_STUBBLE material
    const stubble = decals[0].material as THREE.MeshStandardMaterial;
    expect(stubble.name).toBe(MAT_STUBBLE);
    expect(stubble.color.getHex()).toBe(hairColor(look.app));
    // the look's morph influences, driven off the head's own dictionary
    for (const decal of decals) {
      expect(decal.morphTargetDictionary).toBe(head.morphTargetDictionary);
      expect(decal.morphTargetInfluences).toEqual([0.5]);
    }
    // a second late attach is a no-op (nothing deferred any more)
    expect(attachDeferredFaceDecals(root, look)).toEqual([]);
    expect(decalsOf(root)).toHaveLength(2);
  });

  it('does nothing on a root without the head node: no decal, no deferral flag, ready or not', () => {
    const look = lookWith({ hair: 'buzz', beard: 'stubble', blush: 'rose', eyeshadow: 'none' });
    const headless = new THREE.Group();
    const other = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    other.name = 'M_Torso';
    headless.add(other);
    expect(() => attachFaceDecals(headless, DEF, look, { deferDecals: true })).not.toThrow();
    expect(decalsOf(headless)).toEqual([]);
    expect(headless.userData.deferredDecals).toBeUndefined();
    expect(() => attachFaceDecals(headless, DEF, look)).not.toThrow();
    expect(decalsOf(headless)).toEqual([]);
    expect(headless.children).toEqual([other]);
    // and the late half has nothing to attach either
    expect(attachDeferredFaceDecals(headless, look)).toEqual([]);
  });

  it('the late half returns empty and clears the flag when the head left between build and attach', () => {
    const look = lookWith({ hair: 'buzz', beard: 'stubble', blush: 'rose', eyeshadow: 'none' });
    const { root, head } = composedRoot();
    attachFaceDecals(root, DEF, look, { deferDecals: true });
    expect(root.userData.deferredDecals).toBe(true);
    root.remove(head);
    expect(attachDeferredFaceDecals(root, look)).toEqual([]);
    expect(decalsOf(root)).toEqual([]);
    // the deferral is consumed, not left armed: the flag is cleared before
    // the head lookup, so a later call finds nothing to do even if the head
    // came back
    expect(root.userData.deferredDecals).toBeUndefined();
    root.add(head);
    expect(attachDeferredFaceDecals(root, look)).toEqual([]);
    expect(decalsOf(root)).toEqual([]);
  });

  it('recolorMesh is the sweep step: skin and hair tinted, anything else passed through', () => {
    const look = lookWith({ hairHue: 12, hairSat: 0.6, hairLight: 0.3 });
    const skinSource = new THREE.MeshStandardMaterial({ name: 'mod_skin' });
    const skin = new THREE.Mesh(new THREE.BufferGeometry(), skinSource);
    recolorMesh(skin, look);
    expect(skin.material).not.toBe(skinSource);
    expect((skin.material as THREE.MeshStandardMaterial).color.getHex()).toBe(skinColor(look.app));
    const hair = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ name: 'mod_hair' }),
    );
    recolorMesh(hair, look);
    expect((hair.material as THREE.MeshStandardMaterial).color.getHex()).toBe(hairColor(look.app));
    // an unrelated material passes through untouched
    const other = new THREE.MeshStandardMaterial({ name: 'mod_cloth_none' });
    const cloth = new THREE.Mesh(new THREE.BufferGeometry(), other);
    recolorMesh(cloth, look);
    expect(cloth.material).toBe(other);
    expect(cloth.userData.bodyMesh).toBeUndefined();
  });
});

describe('CharacterVisual.attachDeferredDecals', () => {
  beforeEach(() => resetLookPiecesForTest());
  afterEach(() => vi.restoreAllMocks());

  // The real prototype method against a minimal object whose prototype IS
  // CharacterVisual's (the modular_far_lod.test.ts pattern): the class needs
  // a loaded GLB to construct, and everything this method touches beyond its
  // own decal work resolves through the prototype (effectMaterial and the
  // overlay chain) or is a field listed here. A new constructor field the
  // method reads must be added to this list too.
  function fakeVisual(look: ModularLook, gate: FarBakeGate | null) {
    const { root, head } = composedRoot();
    // biome-ignore lint/suspicious/noExplicitAny: private-field access, see above
    const fake: any = Object.create(CharacterVisual.prototype);
    Object.assign(fake, {
      disposed: false,
      look,
      key: 'test_key',
      def: DEF,
      model: root,
      entityColor: 0xffffff,
      skinIndex: 0,
      tintedRigClaims: new Set(),
      originalMaterials: new Map(),
      casters: [],
      shadowOn: true,
      farBakeGate: gate,
      ghosted: false,
      ghostStyle: 'spirit',
      ghostMaterials: new Map(),
      soulRend: false,
      moonkin: false,
      shadowform: false,
      ferocityStage: 0,
      ascended: false,
      runeTint: null,
      auraGlowIntensity: 0,
    });
    return { fake, root, head };
  }

  const LOOK = lookWith({ hair: 'buzz', beard: 'scruff', blush: 'mauve', eyeshadow: 'plum' });

  it('is a no-op on a body built whole, on a fixed rig, and after dispose', () => {
    const whole = fakeVisual(LOOK, null);
    attachFaceDecals(whole.root, DEF, LOOK);
    expect(whole.fake.attachDeferredDecals()).toBe(false);
    expect(decalsOf(whole.root)).toHaveLength(2);
    const fixed = fakeVisual(LOOK, null);
    fixed.fake.look = null;
    fixed.root.userData.deferredDecals = true;
    expect(fixed.fake.attachDeferredDecals()).toBe(false);
    const disposed = fakeVisual(LOOK, null);
    attachFaceDecals(disposed.root, DEF, LOOK, { deferDecals: true });
    disposed.fake.disposed = true;
    expect(disposed.fake.attachDeferredDecals()).toBe(false);
    expect(decalsOf(disposed.root)).toEqual([]);
    expect(lookPiecesStats().attached).toBe(0);
  });

  it('attaches the two decals with everything the constructor gives a mesh, revealed at once without a gate', () => {
    const { fake, root, head } = fakeVisual(LOOK, null);
    attachFaceDecals(root, DEF, LOOK, { deferDecals: true });
    expect(fake.attachDeferredDecals()).toBe(true);
    const decals = decalsOf(root);
    expect(decals.map((d) => d.name)).toEqual(['ModStubbleDecal', 'ModMakeupDecal']);
    for (const decal of decals) {
      expect(decal.parent).toBe(head.parent);
      // hair colour on the stubble (recolorMesh), then the tier tint clone the
      // constructor's applyMaterials sweep mounts, and THAT is what the
      // ghost/stealth swap restores to
      expect(fake.originalMaterials.get(decal)).toBe(decal.material);
      expect(decal.morphTargetInfluences).toBeInstanceOf(Array);
      // the caster sweep's flags
      expect(decal.castShadow).toBe(true);
      expect(decal.receiveShadow).toBe(false);
      expect(decal.frustumCulled).toBe(false);
      expect(fake.casters).toContain(decal);
      expect(decal.visible).toBe(true);
    }
    const stubble = decals[0].material as THREE.MeshStandardMaterial;
    expect(stubble.color.getHex()).toBe(hairColor(LOOK.app));
    expect(fake.tintedRigClaims.size).toBeGreaterThan(0);
    expect(root.userData.deferredDecals).toBeUndefined();
    expect(lookPiecesStats().attached).toBe(1);
    // the second call finds nothing deferred
    expect(fake.attachDeferredDecals()).toBe(false);
    expect(decalsOf(root)).toHaveLength(2);
    expect(lookPiecesStats().attached).toBe(1);
  });

  it('follows the shadow state the visual is in, not the constructor default', () => {
    const { fake, root } = fakeVisual(LOOK, null);
    fake.shadowOn = false;
    attachFaceDecals(root, DEF, LOOK, { deferDecals: true });
    expect(fake.attachDeferredDecals()).toBe(true);
    for (const decal of decalsOf(root)) expect(decal.castShadow).toBe(false);
  });

  it('with a gate, the decals stay hidden until their compile settles, one gate call each', () => {
    const settles: (() => void)[] = [];
    const targets: THREE.Object3D[] = [];
    const gate: FarBakeGate = (target, onSettled) => {
      targets.push(target);
      settles.push(onSettled);
    };
    const { fake, root } = fakeVisual(LOOK, gate);
    attachFaceDecals(root, DEF, LOOK, { deferDecals: true });
    expect(fake.attachDeferredDecals()).toBe(true);
    const decals = decalsOf(root);
    expect(decals).toHaveLength(2);
    expect(targets).toEqual(decals);
    for (const decal of decals) expect(decal.visible).toBe(false);
    settles[0]();
    expect(decals[0].visible).toBe(true);
    expect(decals[1].visible).toBe(false);
    settles[1]();
    expect(decals[1].visible).toBe(true);
  });

  it('a settle after dispose reveals nothing (the visual no longer draws it)', () => {
    const settles: (() => void)[] = [];
    const gate: FarBakeGate = (_target, onSettled) => {
      settles.push(onSettled);
    };
    const { fake, root } = fakeVisual(LOOK, gate);
    attachFaceDecals(root, DEF, LOOK, { deferDecals: true });
    expect(fake.attachDeferredDecals()).toBe(true);
    fake.disposed = true;
    for (const settle of settles) settle();
    for (const decal of decalsOf(root)) expect(decal.visible).toBe(false);
  });

  it('a gate that refuses outright reveals the decal ungated and keeps attaching', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gate: FarBakeGate = () => {
      throw new Error('lane shut down');
    };
    const { fake, root } = fakeVisual(LOOK, gate);
    attachFaceDecals(root, DEF, LOOK, { deferDecals: true });
    expect(fake.attachDeferredDecals()).toBe(true);
    const decals = decalsOf(root);
    expect(decals).toHaveLength(2);
    for (const decal of decals) {
      expect(decal.visible).toBe(true);
      expect(fake.originalMaterials.has(decal)).toBe(true);
      expect(fake.casters).toContain(decal);
    }
    expect(warn).toHaveBeenCalledTimes(2);
    expect(lookPiecesStats().attached).toBe(1);
  });

  it('a body already wearing an effect gives the late decals that effect too', () => {
    const { fake, root } = fakeVisual(LOOK, null);
    fake.ghosted = true;
    attachFaceDecals(root, DEF, LOOK, { deferDecals: true });
    expect(fake.attachDeferredDecals()).toBe(true);
    for (const decal of decalsOf(root)) {
      const original = fake.originalMaterials.get(decal);
      expect(original).toBeDefined();
      // the mounted material is the ghost clone of the snapshot, so leaving
      // stealth restores the decal like any other mesh
      expect(decal.material).not.toBe(original);
      expect(fake.ghostMaterials.get(original)).toBe(decal.material);
    }
  });
});
