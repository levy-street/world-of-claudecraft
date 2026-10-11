// @vitest-environment happy-dom
// A released spirit on the real CharacterVisual (src/render/characters/visual.ts
// over ghost_veil.ts): the veil mounts on death and comes off on revive, the
// face decals keep their mask, the halo and the weapon-skin VFX hide, the
// shadow goes and comes back, and no material is disposed that someone still
// draws. The other veil users (Ghost Wolf, the March) wear their own palette
// on the same programs and keep what their palette's policy says.

import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnimState } from '../src/render/characters/anim_state';
import type { CharacterVisual } from '../src/render/characters/visual';

const FRAME = 1 / 60;

const anim = (over: Partial<AnimState> = {}): AnimState => ({
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: false,
  ...over,
});

const MAP = new THREE.DataTexture(new Uint8Array([200, 180, 160, 255]), 1, 1);

function skinned(
  name: string,
  material: THREE.Material,
  bones: THREE.Bone[],
  morphs: string[],
): THREE.SkinnedMesh {
  const geometry = new THREE.BoxGeometry(0.6, 1.8, 0.4);
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4),
  );
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  if (morphs.length > 0) {
    geometry.morphAttributes.position = morphs.map(
      () => new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3),
    );
    geometry.morphTargetsRelative = true;
  }
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = name;
  mesh.bind(new THREE.Skeleton(bones));
  if (morphs.length > 0) {
    mesh.updateMorphTargets();
    mesh.morphTargetDictionary = Object.fromEntries(morphs.map((m, i) => [m, i]));
  }
  return mesh;
}

const morphNames = (stem: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${stem}_${i}`);

/** A player rig with a mapped skinned body carrying face morphs and a
 *  transparent face decal over it (the stubble / scalp / makeup shape); held
 *  models are one mapped plain mesh. */
function stubGltf(url: string) {
  const scene = new THREE.Group();
  if (url.includes('models/weapons/')) {
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 1, 0.1),
      new THREE.MeshStandardMaterial({ map: MAP }),
    );
    blade.name = 'weapon_blade';
    scene.add(blade);
    return { scene, animations: [] };
  }
  const root = new THREE.Bone();
  root.name = 'RigRoot';
  const head = new THREE.Bone();
  head.name = 'head';
  head.position.y = 1.6;
  const handR = new THREE.Bone();
  handR.name = 'handslotr';
  const handL = new THREE.Bone();
  handL.name = 'handslotl';
  root.add(head, handR, handL);
  const bones = [root, head, handR, handL];
  // The composed body's merged skin shape (mapped, 14 targets) and the
  // head-cut decal's (17 targets): both tuples of the pinned family.
  const body = skinned(
    'body',
    new THREE.MeshStandardMaterial({ map: MAP }),
    bones,
    morphNames('body', 14),
  );
  body.add(root);
  const decalMaterial = new THREE.MeshStandardMaterial({
    map: MAP,
    color: 0x3a2a1a,
    transparent: true,
    depthWrite: false,
  });
  decalMaterial.polygonOffset = true;
  decalMaterial.polygonOffsetFactor = -1;
  decalMaterial.polygonOffsetUnits = -1;
  const decal = skinned('ModStubbleDecal', decalMaterial, bones, morphNames('face', 17));
  // assets.ts markFaceDecal: the far-LOD bake leaves face decals out
  decal.userData.faceDecal = true;
  scene.add(body, decal);
  const clip = (name: string) => new THREE.AnimationClip(name, 1, []);
  return { scene, animations: ['Idle', 'Walk', 'Run', 'Death'].map(clip) };
}

type Veil = typeof import('../src/render/characters/ghost_veil');
type Family = typeof import('../src/render/characters/spirit_veil_family_core');
type GateCall = { target: THREE.Object3D; settle: () => void };

interface Harness {
  visual: CharacterVisual;
  veil: Veil;
  family: Family;
  gateCalls: GateCall[];
}

async function makePriest(linked: boolean): Promise<Harness> {
  vi.resetModules();
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn((url: string) => Promise.resolve(stubGltf(url))),
    loadHdr: vi.fn(() => new Promise(() => undefined)),
    loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    releaseGltf: vi.fn(),
  }));
  const { charactersReady } = await import('../src/render/characters/assets');
  await charactersReady();
  const { CharacterVisual } = await import('../src/render/characters/visual');
  const veil = await import('../src/render/characters/ghost_veil');
  const family = await import('../src/render/characters/spirit_veil_family_core');
  veil.resetSpiritVeilLedger();
  if (linked) for (const key of family.SPIRIT_VEIL_FAMILY_KEYS) veil.noteSpiritVeilTupleLinked(key);
  const visual = new CharacterVisual('player_priest', 0xffffff, 0);
  visual.update(FRAME, anim(), true);
  const gateCalls: GateCall[] = [];
  // The form adornments (form_adornments.ts) hold their first mount behind the
  // same gate; they are rig FX, not an effect swap, so they settle at once.
  visual.setFarBakeGate((target, settle) => {
    if (/^(moonwing|gloamveil)_/.test(target.name)) settle();
    else gateCalls.push({ target, settle });
  });
  visual.setShadow(true);
  return { visual, veil, family, gateCalls };
}

afterEach(() => {
  vi.doUnmock('../src/render/assets/loader');
  vi.restoreAllMocks();
  vi.resetModules();
});

const model = (visual: CharacterVisual): THREE.Object3D =>
  (visual as unknown as { model: THREE.Object3D }).model;

function named(visual: CharacterVisual, name: string): THREE.Mesh {
  const found = model(visual).getObjectByName(name) as THREE.Mesh | undefined;
  if (!found) throw new Error(`the harness lost ${name}`);
  return found;
}

/** The rig's own drawn meshes, depth siblings excluded. */
function rigMeshes(visual: CharacterVisual): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  model(visual).traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.name !== 'spirit_veil_depth') out.push(mesh);
  });
  return out;
}

function depthSiblings(visual: CharacterVisual): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  model(visual).traverse((object) => {
    if (object.name === 'spirit_veil_depth') out.push(object as THREE.Mesh);
  });
  return out;
}

function single(mesh: THREE.Mesh): THREE.Material {
  return Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
}

describe('the spirit veil on a released spirit', () => {
  it('mounts on the frame the ghost appears when the family is linked, and comes off on revive', async () => {
    const { visual, veil, family, gateCalls } = await makePriest(true);
    const body = named(visual, 'body');
    const blade = named(visual, 'weapon_blade');
    const living = new Map(rigMeshes(visual).map((mesh) => [mesh, mesh.material]));

    visual.setGhost(true, 'spirit');

    // No staging: every tuple is linked, so nothing waits on the gate.
    expect(gateCalls).toHaveLength(0);
    for (const mesh of [body, blade]) {
      expect(veil.spiritVeilPassOf(single(mesh))).toBe('color');
      // exactly one depth sibling, a child of its body, on the shared
      // per-shape depth material, culled and skinned like the body
      const siblings = mesh.children.filter((child) => child.name === 'spirit_veil_depth');
      expect(siblings).toHaveLength(1);
      const sibling = siblings[0] as THREE.Mesh;
      expect(sibling.material).toBe(veil.spiritVeilDepthMaterial(veil.spiritVeilShapeKey(mesh)));
      expect((sibling as THREE.SkinnedMesh).isSkinnedMesh === true).toBe(
        (mesh as THREE.SkinnedMesh).isSkinnedMesh === true,
      );
      expect(sibling.geometry).toBe(mesh.geometry);
      expect(sibling.castShadow).toBe(false);
      expect(sibling.frustumCulled).toBe(mesh.frustumCulled);
      // the rig is one sort unit: body and sibling carry the same token
      expect(sibling.userData[family.SPIRIT_VEIL_UNIT_KEY]).toBe(
        mesh.userData[family.SPIRIT_VEIL_UNIT_KEY],
      );
      expect(sibling.userData[family.SPIRIT_VEIL_PASS_KEY]).toBe('depth');
      expect(mesh.userData[family.SPIRIT_VEIL_PASS_KEY]).toBe('color');
    }
    expect(body.userData[family.SPIRIT_VEIL_UNIT_KEY]).toBe(
      blade.userData[family.SPIRIT_VEIL_UNIT_KEY],
    );
    // the baked far LOD veils too, over a plain depth sibling of its own
    const far = (visual as unknown as { farMesh: THREE.Mesh | null }).farMesh;
    expect(far).not.toBeNull();
    const farMesh = far as THREE.Mesh;
    expect(veil.spiritVeilPassOf(single(farMesh))).toBe('color');
    const farSibling = farMesh.children.find((c) => c.name === 'spirit_veil_depth') as THREE.Mesh;
    expect(farSibling).toBeDefined();
    expect((farSibling as THREE.SkinnedMesh).isSkinnedMesh).not.toBe(true);
    expect(farSibling.material).toBe(veil.spiritVeilDepthMaterial('depth:r:0'));
    // the skinned sibling shares the body's skeleton and its live morphs
    const bodySibling = body.children.find(
      (c) => c.name === 'spirit_veil_depth',
    ) as THREE.SkinnedMesh;
    expect(bodySibling.skeleton).toBe((body as THREE.SkinnedMesh).skeleton);
    expect(bodySibling.morphTargetInfluences).toBe(body.morphTargetInfluences);

    visual.setGhost(false);
    for (const [mesh, material] of living) expect(mesh.material).toBe(material);
    expect(depthSiblings(visual)).toHaveLength(0);
    for (const mesh of rigMeshes(visual)) {
      expect(mesh.userData[family.SPIRIT_VEIL_UNIT_KEY]).toBeUndefined();
      expect(mesh.userData[family.SPIRIT_VEIL_PASS_KEY]).toBeUndefined();
    }
    visual.dispose();
  });

  it('keeps one colour material per (source, shape): a source two shapes draw gets two', async () => {
    const { visual } = await makePriest(true);
    const body = named(visual, 'body');
    const blade = named(visual, 'weapon_blade');
    // One source drawn by a skinned body and a rigid prop: three would
    // re-derive a shared material's program at every alternation.
    const originals = (visual as unknown as { originalMaterials: Map<THREE.Mesh, unknown> })
      .originalMaterials;
    originals.set(blade, originals.get(body));
    visual.setGhost(true, 'spirit');
    expect(single(body)).not.toBe(single(blade));
    expect((single(body) as THREE.MeshBasicMaterial).map).toBe(
      (single(blade) as THREE.MeshBasicMaterial).map,
    );
    visual.dispose();
  });

  it('stages behind the effect gate when a tuple is not linked, depth pre-pass included, and names it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { visual, veil, gateCalls } = await makePriest(false);
    const body = named(visual, 'body');
    const living = single(body);

    visual.setGhost(true, 'spirit');

    // The body keeps drawing its linked materials (never a live link)...
    expect(single(body)).toBe(living);
    expect(depthSiblings(visual)).toHaveLength(0);
    expect(gateCalls).toHaveLength(1);
    const scratch = gateCalls[0].target as THREE.Group;
    const passes = scratch.children.map((child) =>
      veil.spiritVeilPassOf(single(child as THREE.Mesh)),
    );
    // ...while the veil colour, the decal variant and the depth pre-pass link
    // hidden on the rig's own geometry.
    expect(passes).toContain('color');
    expect(passes).toContain('decal');
    expect(passes).toContain('depth');
    const depthTwin = scratch.children.find(
      (child) =>
        veil.spiritVeilPassOf(single(child as THREE.Mesh)) === 'depth' &&
        (child as THREE.Mesh).geometry === body.geometry,
    ) as THREE.SkinnedMesh;
    expect(depthTwin.isSkinnedMesh).toBe(true);
    expect(warn.mock.calls.some((call) => String(call[0]).startsWith('[spirit-veil]'))).toBe(true);
    // Its shadow and halo stay until the swap actually lands.
    const halo = named(visual, 'class_halo');
    const proxy = (visual as unknown as { shadowProxy: THREE.Mesh }).shadowProxy;
    visual.setProxyShadow(true);
    expect(body.castShadow).toBe(true);
    expect(halo.visible).toBe(true);
    expect(proxy.visible).toBe(true);

    gateCalls[0].settle();
    visual.update(FRAME, anim(), true);
    expect(veil.spiritVeilPassOf(single(body))).toBe('color');
    expect(depthSiblings(visual).length).toBeGreaterThan(0);
    expect(body.castShadow).toBe(false);
    expect(halo.visible).toBe(false);
    expect(proxy.visible).toBe(false);
    visual.dispose();
  });

  it('keeps the face decal as an alpha-preserving variant with no depth pass of its own', async () => {
    const { visual, veil } = await makePriest(true);
    const decal = named(visual, 'ModStubbleDecal');
    const source = single(decal) as THREE.MeshStandardMaterial;
    expect(source.transparent).toBe(true);

    visual.setGhost(true, 'spirit');

    const worn = single(decal) as THREE.MeshBasicMaterial;
    expect(veil.spiritVeilPassOf(worn)).toBe('decal');
    expect(worn.defines).toHaveProperty('SPIRIT_VEIL_DECAL');
    expect(worn.map).toBe(source.map);
    expect(worn.color.getHex()).toBe(source.color.getHex());
    expect(worn.transparent).toBe(true);
    expect(worn.depthWrite).toBe(false);
    expect(worn.side).toBe(THREE.FrontSide);
    expect(worn.polygonOffset).toBe(true);
    expect(worn.polygonOffsetFactor).toBe(source.polygonOffsetFactor);
    expect(decal.visible).toBe(true);
    expect(decal.children.filter((child) => child.name === 'spirit_veil_depth')).toHaveLength(0);
    // The body veil, for contrast, overwrites the alpha and draws both faces.
    const body = single(named(visual, 'body')) as THREE.MeshBasicMaterial;
    expect(body.defines ?? {}).not.toHaveProperty('SPIRIT_VEIL_DECAL');
    expect(body.side).toBe(THREE.DoubleSide);
    expect(body.forceSinglePass).toBe(true);
    visual.dispose();
  });

  it('hides the class halo on its own material and shows it again on revive', async () => {
    const { visual } = await makePriest(true);
    const halo = named(visual, 'class_halo');
    const haloMaterial = halo.material;
    expect(halo.visible).toBe(true);

    visual.setGhost(true, 'spirit');
    expect(halo.visible).toBe(false);
    expect(halo.material).toBe(haloMaterial);
    expect(halo.children.filter((child) => child.name === 'spirit_veil_depth')).toHaveLength(0);

    visual.setGhost(false);
    expect(halo.visible).toBe(true);
    expect(halo.material).toBe(haloMaterial);
    visual.dispose();
  });

  it('casts no shadow while veiled, whatever the plan says, and gets it back on revive', async () => {
    const { visual } = await makePriest(true);
    const body = named(visual, 'body');
    const blade = named(visual, 'weapon_blade');
    expect(body.castShadow).toBe(true);
    expect(blade.castShadow).toBe(true);
    const receive = rigMeshes(visual).map((mesh) => mesh.receiveShadow);

    visual.setGhost(true, 'spirit');
    expect(body.castShadow).toBe(false);
    expect(blade.castShadow).toBe(false);
    visual.setShadow(false);
    visual.setShadow(true);
    expect(body.castShadow).toBe(false);
    // a weapon swapped while dead rebuilds the casters: still no shadow
    visual.setWeapon('bogoak_staff');
    expect(named(visual, 'weapon_blade').castShadow).toBe(false);
    expect(body.castShadow).toBe(false);
    // receiveShadow is no program input and the veil never touches it
    expect(rigMeshes(visual).map((mesh) => mesh.receiveShadow)).toEqual(receive);

    visual.setGhost(false);
    expect(body.castShadow).toBe(true);
    expect(named(visual, 'weapon_blade').castShadow).toBe(true);
    visual.setShadow(false);
    expect(body.castShadow).toBe(false);
    visual.dispose();
  });

  it('hides the far shadow proxy while veiled, whatever the plan asks, and restores it on revive', async () => {
    const { visual } = await makePriest(true);
    const proxy = (visual as unknown as { shadowProxy: THREE.Mesh | null }).shadowProxy;
    expect(proxy).not.toBeNull();
    const shadowProxy = proxy as THREE.Mesh;
    visual.setProxyShadow(true);
    expect(shadowProxy.visible).toBe(true);

    visual.setGhost(true, 'spirit');
    expect(shadowProxy.visible).toBe(false);
    // the renderer's per-frame plan keeps asking for it
    visual.setProxyShadow(true);
    visual.setFar(true);
    visual.setFar(false);
    expect(shadowProxy.visible).toBe(false);

    visual.setGhost(false);
    expect(shadowProxy.visible).toBe(true);
    visual.setProxyShadow(false);
    expect(shadowProxy.visible).toBe(false);
    visual.dispose();
  });

  it('hides the weapon-skin VFX but keeps its light counted at intensity 0', async () => {
    const { visual } = await makePriest(true);
    const group = new THREE.Group();
    const light = new THREE.PointLight(0xffaa55, 2, 6, 2);
    const shell = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const motes = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());
    group.add(light, shell, motes);
    // The rig's light is budget-dynamic: its own update() writes the flicker
    // (weapon_vfx.ts), which is what brings it back after a revive.
    const update = vi.fn(() => {
      light.intensity = 1.37;
    });
    const handle = { group, light, update, setTuning: vi.fn(), dispose: vi.fn() };
    (visual as unknown as { weaponVfx: unknown[] }).weaponVfx.push(handle);

    visual.setGhost(true, 'spirit');
    expect(shell.visible).toBe(false);
    expect(motes.visible).toBe(false);
    expect(light.visible).toBe(true);
    expect(light.intensity).toBe(0);
    visual.updateWeaponVfx(FRAME);
    expect(update).not.toHaveBeenCalled();
    expect(light.intensity).toBe(0);

    visual.setGhost(false);
    expect(shell.visible).toBe(true);
    expect(motes.visible).toBe(true);
    expect(light.visible).toBe(true);
    visual.updateWeaponVfx(FRAME);
    expect(update).toHaveBeenCalled();
    expect(light.intensity).toBe(1.37);
    (visual as unknown as { weaponVfx: unknown[] }).weaponVfx.length = 0;
    visual.dispose();
  });

  it('never meets a depth sibling in a rig sweep, and survives a skin sweep mid-veil', async () => {
    const { visual, veil } = await makePriest(true);
    visual.setGhost(true, 'spirit');
    const priv = visual as unknown as {
      originalMaterials: Map<THREE.Mesh, unknown>;
      casters: THREE.Mesh[];
      rebuildCasters(): void;
      applyVisualMaterials(): void;
    };
    priv.rebuildCasters();
    priv.applyVisualMaterials();
    visual.setSkin(1);
    for (const mesh of priv.originalMaterials.keys())
      expect(mesh.name).not.toBe('spirit_veil_depth');
    for (const mesh of priv.casters) expect(mesh.name).not.toBe('spirit_veil_depth');
    // still veiled, one sibling per body, none of them nested in another
    const body = named(visual, 'body');
    expect(veil.spiritVeilPassOf(single(body))).toBe('color');
    expect(body.children.filter((child) => child.name === 'spirit_veil_depth')).toHaveLength(1);
    for (const sibling of depthSiblings(visual)) expect(sibling.children).toHaveLength(0);
    visual.dispose();
  });

  it('disposes its own veil materials only, never a source or the shared depth pass', async () => {
    const { visual, veil } = await makePriest(true);
    const body = named(visual, 'body');
    const source = single(body);
    const sourceDispose = vi.spyOn(source, 'dispose');
    visual.setGhost(true, 'spirit');
    const worn = single(body);
    const wornDispose = vi.spyOn(worn, 'dispose');
    const depth = veil.spiritVeilDepthMaterial(veil.spiritVeilShapeKey(body));
    const depthDispose = vi.spyOn(depth, 'dispose');

    visual.setGhost(false);
    visual.setGhost(true, 'spirit');
    // a second death reuses the cached veil material
    expect(single(body)).toBe(worn);
    expect(wornDispose).not.toHaveBeenCalled();

    visual.dispose();
    expect(wornDispose).toHaveBeenCalled();
    expect(sourceDispose).not.toHaveBeenCalled();
    expect(depthDispose).not.toHaveBeenCalled();
  });
});

function weaponSkinHandle(visual: CharacterVisual) {
  const group = new THREE.Group();
  const light = new THREE.PointLight(0xffaa55, 2, 6, 2);
  const shell = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  group.add(light, shell);
  // weapon_vfx.ts hangs a glow shell off the weapon mesh itself, outside the
  // handle's group
  const glow = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  glow.userData.__vfx = true;
  glow.userData.weaponVfxMesh = true;
  named(visual, 'weapon_blade').add(glow);
  const update = vi.fn(() => {
    light.intensity = 1.37;
  });
  const handle = { group, light, update, setTuning: vi.fn(), dispose: vi.fn() };
  (visual as unknown as { weaponVfx: unknown[] }).weaponVfx.push(handle);
  return { handle, light, shell, glow, update };
}

describe('the other veil users wear their own palette on the same programs', () => {
  it('mounts each palette at once, with a depth pre-pass of that palette, and swaps between them', async () => {
    const { visual, veil, gateCalls } = await makePriest(true);
    const body = named(visual, 'body');
    const decal = named(visual, 'ModStubbleDecal');
    const seen = new Set<THREE.Material>();
    for (const palette of ['wolf', 'march', 'spirit'] as const) {
      visual.setGhost(true, palette);
      expect(gateCalls).toHaveLength(0);
      const worn = single(body);
      expect(veil.spiritVeilPassOf(worn)).toBe('color');
      expect(veil.spiritVeilPaletteOf(worn)).toBe(palette);
      expect(veil.spiritVeilPaletteOf(single(decal))).toBe(palette);
      expect(seen.has(worn)).toBe(false);
      seen.add(worn);
      const siblings = body.children.filter((child) => child.name === 'spirit_veil_depth');
      expect(siblings).toHaveLength(1);
      expect((siblings[0] as THREE.Mesh).material).toBe(
        veil.spiritVeilDepthMaterial(veil.spiritVeilShapeKey(body), palette),
      );
      expect(named(visual, 'class_halo').visible).toBe(false);
    }
    // a palette worn before is the cached material, not a new one
    visual.setGhost(true, 'wolf');
    expect(seen.has(single(body))).toBe(true);
    visual.setGhost(false);
    expect(depthSiblings(visual)).toHaveLength(0);
    expect(named(visual, 'class_halo').visible).toBe(true);
    visual.dispose();
  });

  it('keeps the weapon-skin VFX and its light under the March, never its shadow', async () => {
    const { visual } = await makePriest(true);
    const body = named(visual, 'body');
    const { light, shell, glow, update } = weaponSkinHandle(visual);
    const proxy = (visual as unknown as { shadowProxy: THREE.Mesh }).shadowProxy;
    visual.setProxyShadow(true);
    visual.setGhost(true, 'march');
    expect(proxy.visible).toBe(false);
    expect(shell.visible).toBe(true);
    expect(glow.visible).toBe(true);
    visual.updateWeaponVfx(FRAME);
    expect(update).toHaveBeenCalled();
    expect(light.intensity).toBe(1.37);
    expect(body.castShadow).toBe(false);
    // the same rig dead: the released-spirit palette hides them again
    visual.setGhost(true, 'spirit');
    expect(shell.visible).toBe(false);
    expect(glow.visible).toBe(false);
    expect(light.intensity).toBe(0);
    update.mockClear();
    visual.updateWeaponVfx(FRAME);
    expect(update).not.toHaveBeenCalled();
    visual.setGhost(false);
    expect(shell.visible).toBe(true);
    expect(glow.visible).toBe(true);
    expect(body.castShadow).toBe(true);
    (visual as unknown as { weaponVfx: unknown[] }).weaponVfx.length = 0;
    visual.dispose();
  });

  it('casts no shadow under the Ghost Wolf palette, and hides a weapon skin there', async () => {
    const { visual } = await makePriest(true);
    const body = named(visual, 'body');
    const { light, shell } = weaponSkinHandle(visual);
    const proxy = (visual as unknown as { shadowProxy: THREE.Mesh }).shadowProxy;
    visual.setProxyShadow(true);
    visual.setGhost(true, 'wolf');
    expect(body.castShadow).toBe(false);
    expect(proxy.visible).toBe(false);
    expect(shell.visible).toBe(false);
    expect(light.intensity).toBe(0);
    visual.setGhost(false);
    expect(body.castShadow).toBe(true);
    expect(proxy.visible).toBe(true);
    (visual as unknown as { weaponVfx: unknown[] }).weaponVfx.length = 0;
    visual.dispose();
  });

  it('stages a palette behind the effect gate like the released spirit when unlinked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { visual, veil, gateCalls } = await makePriest(false);
    const body = named(visual, 'body');
    const living = single(body);
    visual.setGhost(true, 'march');
    expect(single(body)).toBe(living);
    expect(gateCalls).toHaveLength(1);
    const scratch = gateCalls[0].target as THREE.Group;
    const depthTwin = scratch.children.find(
      (child) => veil.spiritVeilPassOf(single(child as THREE.Mesh)) === 'depth',
    ) as THREE.Mesh;
    expect(veil.spiritVeilPaletteOf(single(depthTwin))).toBe('march');
    gateCalls[0].settle();
    visual.update(FRAME, anim(), true);
    expect(veil.spiritVeilPaletteOf(single(body))).toBe('march');
    expect(warn).toHaveBeenCalled();
    visual.dispose();
  });
});

describe("stealth wears the veil in its source's palette", () => {
  it('mounts the rogue or the other stealth palette at once, hides a weapon skin, casts no shadow', async () => {
    const { visual, veil, gateCalls } = await makePriest(true);
    const body = named(visual, 'body');
    const { light, shell, glow } = weaponSkinHandle(visual);
    const proxy = (visual as unknown as { shadowProxy: THREE.Mesh }).shadowProxy;
    visual.setProxyShadow(true);
    for (const palette of ['stealth-rogue', 'stealth-other'] as const) {
      visual.setGhost(true, palette);
      expect(gateCalls).toHaveLength(0);
      expect(veil.spiritVeilPaletteOf(single(body))).toBe(palette);
      expect(body.children.filter((child) => child.name === 'spirit_veil_depth')).toHaveLength(1);
      expect(body.castShadow).toBe(false);
      expect(proxy.visible).toBe(false);
      expect(shell.visible).toBe(false);
      expect(glow.visible).toBe(false);
      expect(light.intensity).toBe(0);
      expect(named(visual, 'class_halo').visible).toBe(false);
    }
    visual.setGhost(false);
    expect(body.castShadow).toBe(true);
    expect(shell.visible).toBe(true);
    (visual as unknown as { weaponVfx: unknown[] }).weaponVfx.length = 0;
    visual.dispose();
  });
});

describe('Moonkin and Soul Rend wear the veil', () => {
  it('keeps the Moonkin shadow, with the side the living caster had, and its weapon-skin VFX', async () => {
    const { visual, veil, gateCalls } = await makePriest(true);
    const body = named(visual, 'body');
    const source = single(body);
    const { light, shell, update } = weaponSkinHandle(visual);
    const proxy = (visual as unknown as { shadowProxy: THREE.Mesh }).shadowProxy;
    visual.setProxyShadow(true);
    visual.setMoonkin(true);
    expect(gateCalls).toHaveLength(0);
    const worn = single(body);
    expect(veil.spiritVeilPaletteOf(worn)).toBe('moonkin');
    expect(worn.shadowSide).toBe(source.shadowSide ?? THREE.BackSide);
    expect(body.castShadow).toBe(true);
    expect(proxy.visible).toBe(true);
    expect(shell.visible).toBe(true);
    visual.updateWeaponVfx(FRAME);
    expect(update).toHaveBeenCalled();
    expect(light.intensity).toBe(1.37);
    // the depth pre-pass never casts: the body's own caster is the shadow
    for (const sibling of depthSiblings(visual)) expect(sibling.castShadow).toBe(false);
    expect(named(visual, 'class_halo').visible).toBe(false);
    // a death while in the form: the spirit veil wins and drops the shadow
    visual.setGhost(true, 'spirit');
    expect(veil.spiritVeilPaletteOf(single(body))).toBe('spirit');
    expect(body.castShadow).toBe(false);
    visual.setGhost(false);
    expect(veil.spiritVeilPaletteOf(single(body))).toBe('moonkin');
    expect(body.castShadow).toBe(true);
    visual.setMoonkin(false);
    expect(single(body)).toBe(source);
    (visual as unknown as { weaponVfx: unknown[] }).weaponVfx.length = 0;
    visual.dispose();
  });

  it('commits Soul Rend on the frame it lands even unlinked, late-links the tuples, keeps the weapon glow, drops the shadow', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { visual, veil, gateCalls } = await makePriest(false);
    const late: string[][] = [];
    veil.setSpiritVeilLateLink((keys) => late.push([...keys]));
    const body = named(visual, 'body');
    const { light, shell, update } = weaponSkinHandle(visual);
    const proxy = (visual as unknown as { shadowProxy: THREE.Mesh }).shadowProxy;
    visual.setProxyShadow(true);
    visual.setSoulRend(true);
    // never deferred: no gate, mounted now
    expect(gateCalls).toHaveLength(0);
    expect(veil.spiritVeilPaletteOf(single(body))).toBe('soul-rend');
    expect(depthSiblings(visual).length).toBeGreaterThan(0);
    expect(late).toHaveLength(1);
    expect(late[0]).toEqual(
      expect.arrayContaining([
        veil.spiritVeilShapeKey(body),
        ...(veil.spiritVeilKeysFor(single(body), body) ?? []),
      ]),
    );
    expect(
      warn.mock.calls.some((call) => String(call[0]).includes('committed a never-deferred veil')),
    ).toBe(true);
    expect(body.castShadow).toBe(false);
    expect(proxy.visible).toBe(false);
    expect(shell.visible).toBe(true);
    visual.updateWeaponVfx(FRAME);
    expect(update).toHaveBeenCalled();
    expect(light.intensity).toBe(1.37);
    expect(named(visual, 'class_halo').visible).toBe(false);
    visual.setSoulRend(false);
    expect(proxy.visible).toBe(true);
    expect(veil.spiritVeilPassOf(single(body))).toBeNull();
    (visual as unknown as { weaponVfx: unknown[] }).weaponVfx.length = 0;
    visual.dispose();
  });

  it('draws Soul Rend over a ghost look and over Moonkin, and hands the body back to them', async () => {
    const { visual, veil } = await makePriest(true);
    const body = named(visual, 'body');
    for (const under of ['march', 'moonkin'] as const) {
      if (under === 'moonkin') visual.setMoonkin(true);
      else visual.setGhost(true, under);
      visual.setSoulRend(true);
      expect(veil.spiritVeilPaletteOf(single(body))).toBe('soul-rend');
      visual.setSoulRend(false);
      expect(veil.spiritVeilPaletteOf(single(body))).toBe(under);
      visual.setGhost(false);
      visual.setMoonkin(false);
    }
    visual.dispose();
  });
});

describe('Shadowform is an opaque tint on the source programs, not a veil', () => {
  it('tints every rig material on a program-preserving clone, never staged, keeping shadow, glow and a tinted halo', async () => {
    const { visual, veil, gateCalls } = await makePriest(false);
    const { SHADOWFORM_TINT, SHADOWFORM_EMISSIVE, SHADOWFORM_EMISSIVE_INTENSITY } = await import(
      '../src/render/characters/shadowform_tint'
    );
    // today's colours, pinned as the literals the old twin used
    expect(SHADOWFORM_TINT).toBe(0x5a2a8f);
    expect(SHADOWFORM_EMISSIVE).toBe(0x2a0a4a);
    expect(SHADOWFORM_EMISSIVE_INTENSITY).toBe(0.4);
    const body = named(visual, 'body');
    const halo = named(visual, 'class_halo');
    const living = new Map(rigMeshes(visual).map((mesh) => [mesh, single(mesh)]));
    const { light, shell, update } = weaponSkinHandle(visual);
    visual.setShadowform(true);
    // nothing is linked in this harness, and nothing needs to be
    expect(gateCalls).toHaveLength(0);
    for (const [mesh, source] of living) {
      const worn = single(mesh) as THREE.MeshStandardMaterial;
      expect(worn, mesh.name).not.toBe(source);
      expect(veil.spiritVeilPassOf(worn), mesh.name).toBeNull();
      expect(worn.transparent, mesh.name).toBe(source.transparent);
      expect(worn.customProgramCacheKey(), mesh.name).toBe(source.customProgramCacheKey());
      expect(worn.color.getHex(), mesh.name).toBe(SHADOWFORM_TINT);
      expect(worn.opacity, mesh.name).toBe(source.opacity);
    }
    const bodyWorn = single(body) as THREE.MeshStandardMaterial;
    expect(bodyWorn.emissive.getHex()).toBe(SHADOWFORM_EMISSIVE);
    expect(bodyWorn.emissiveIntensity).toBeGreaterThanOrEqual(0.4);
    expect(halo.visible).toBe(true);
    expect((single(halo) as THREE.MeshBasicMaterial).color.getHex()).toBe(SHADOWFORM_TINT);
    expect(depthSiblings(visual)).toHaveLength(0);
    expect(body.castShadow).toBe(true);
    expect(shell.visible).toBe(true);
    visual.updateWeaponVfx(FRAME);
    expect(update).toHaveBeenCalled();
    expect(light.intensity).toBe(1.37);
    visual.setShadowform(false);
    for (const [mesh, source] of living) expect(single(mesh)).toBe(source);
    (visual as unknown as { weaponVfx: unknown[] }).weaponVfx.length = 0;
    visual.dispose();
  });
});

describe('no effect state reaches a lit transparent twin', () => {
  type Toggle = { name: string; on(v: CharacterVisual): void };
  const TOGGLES: Toggle[] = [
    ...(
      ['spirit', 'wolf', 'march', 'stealth-rogue', 'stealth-other', 'moonkin', 'soul-rend'] as const
    ).map((palette) => ({
      name: `ghost:${palette}`,
      on: (v: CharacterVisual) => v.setGhost(true, palette),
    })),
    { name: 'soul rend', on: (v) => v.setSoulRend(true) },
    { name: 'moonkin', on: (v) => v.setMoonkin(true) },
    { name: 'shadowform', on: (v) => v.setShadowform(true) },
    { name: 'ferocity', on: (v) => v.setFerocityStage(3) },
    { name: 'ascended', on: (v) => v.setAscended(true) },
    { name: 'rune tint', on: (v) => v.setRuneTint(0xff2200) },
    { name: 'aura glow', on: (v) => v.setAuraGlow(0xffffff, 0.6) },
    { name: 'element response', on: (v) => v.respondToElement('fire') },
  ];

  function clear(v: CharacterVisual): void {
    v.setGhost(false);
    v.setSoulRend(false);
    v.setMoonkin(false);
    v.setShadowform(false);
    v.setFerocityStage(0);
    v.setAscended(false);
    v.setRuneTint(null);
    v.setAuraGlow(0xffffff, 0);
    v.clearElementResponse();
  }

  it('mounts only a veil pass or a clone that keeps its source blend, for every state and pair of states', async () => {
    const { visual, veil, gateCalls } = await makePriest(true);
    const priv = visual as unknown as {
      originalMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
      farMesh: THREE.Mesh | null;
      farMaterials: THREE.Material | THREE.Material[] | null;
    };
    const check = (label: string): number => {
      let checked = 0;
      const pairs: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [...priv.originalMaterials];
      if (priv.farMesh && priv.farMaterials) pairs.push([priv.farMesh, priv.farMaterials]);
      for (const [mesh, original] of pairs) {
        const sources = [original].flat();
        const worn = [mesh.material].flat();
        worn.forEach((material, i) => {
          checked++;
          if (veil.spiritVeilPassOf(material) !== null) return;
          expect(material.transparent, `${label} ${mesh.name}`).toBe(sources[i].transparent);
        });
      }
      return checked;
    };
    for (const a of TOGGLES) {
      for (const b of [null, ...TOGGLES]) {
        clear(visual);
        a.on(visual);
        b?.on(visual);
        // whatever staged behind the effect gate lands: what the state MOUNTS
        for (const call of gateCalls.splice(0)) call.settle();
        visual.update(FRAME, anim(), true);
        expect(check(`${a.name}+${b?.name ?? '-'}`)).toBeGreaterThan(3);
      }
    }
    visual.dispose();
  });
});
