// The composed far LOD: the two walks that have to be ONE list, and the budget
// that spreads the mint.
//
// A composed body's far mesh is baked once per PART SET and shared, while the
// COLOURS are per character: the bake hands back geometry groups, and each
// character resolves group N against its own captured `userData.farMaterials[N]`.
// So the whole thing rests on one property that nothing in the renderer can
// check at runtime: the walk that captures the materials and the walk that
// builds the groups must produce the same list, in the same order.
//
// That property broke the first time in the most ordinary way. The capture ran
// before attachAllProps and the bake ran after, so the bake saw a held weapon
// the capture had not. It is not a tail-append either: the character GLB stores
// its bone root LAST (Rig_Medium's 248th child), and mergeSkinnedParts appends
// the merged body AFTER that, so a prop hanging off handslot.r is traversed
// BETWEEN the unmerged parts and the merged buckets. Every merged group, the
// armour and the cloth, the bulk of the silhouette, drew the material of the
// slot before it, and the tail fell through the padding to the untextured white
// fallback. Silently: the padding is what turns a length mismatch into a
// mis-colouring rather than a crash.
//
// The fix is composedFarMeshes dropping held props from both walks, which is
// also the only thing that COULD work: the bake composes its throwaway with no
// weapon ids, so its temp wears the class default while the characters
// resolving against it wear whatever they equipped. These tests fabricate a
// tree of the real shape and pin the two walks against each other.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as assets from '../src/render/characters/assets';
import {
  composedFarMeshes,
  farSourceMaterials,
  takeFarBakeBudget,
} from '../src/render/characters/assets';
import { DEFAULT_LOOK, MODULAR_WARRIOR_KEY } from '../src/render/characters/modular';
import { CharacterVisual } from '../src/render/characters/visual';

type AssetsModule = typeof import('../src/render/characters/assets');

function src(file: string): string {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

/** The body of a named function, for the statement-order pins below. */
function fnBody(file: string, signature: string): string {
  const text = src(file);
  const start = text.indexOf(signature);
  expect(start, `${signature} not found in ${file}`).toBeGreaterThan(-1);
  const end = text.indexOf('\n}', start);
  return text.slice(start, end);
}

function mesh(name: string): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: `mat_${name}` }));
  m.name = name;
  return m;
}

/** A prop the way attachProp builds one: every mesh tagged `weaponMesh`, added
 *  under a bone rather than at the root. */
function prop(name: string): THREE.Object3D {
  const payload = new THREE.Group();
  payload.name = `${name}_payload`;
  const m = mesh(name);
  m.userData.weaponMesh = true;
  payload.add(m);
  return payload;
}

/**
 * A composed root shaped like the real one: unmerged parts first (the buckets
 * mergeSkinnedParts refuses because they carry morph targets), then the bone
 * root, then the merged body appended after it by `canon.parent?.add(merged)`.
 *
 * `props` hang off the handslot bone, which is where the ordering hazard lives:
 * mid-traversal, not at the end.
 */
function composedRoot(props: string[]): THREE.Object3D {
  const root = new THREE.Group();
  root.add(mesh('head'));
  root.add(mesh('eyes'));
  const boneRoot = new THREE.Bone();
  boneRoot.name = 'Rig_Medium_root';
  const handslot = new THREE.Bone();
  handslot.name = 'handslot.r';
  boneRoot.add(handslot);
  root.add(boneRoot);
  for (const name of props) handslot.add(prop(name));
  root.add(mesh('plate_bodymerged'));
  root.add(mesh('cloth_bodymerged'));
  return root;
}

const names = (list: THREE.Mesh[]) => list.map((m) => m.name);

describe('composedFarMeshes', () => {
  it('drops held props, so a prop attached mid-traversal cannot shift the groups', () => {
    // The reviewer's probe, as an assertion. A raw traversal puts the sword
    // between the unmerged parts and the merged body; the composed filter does
    // not see it at all.
    const raw: string[] = [];
    composedRoot(['sword']).traverse((o) => {
      if ((o as THREE.Mesh).isMesh) raw.push(o.name);
    });
    expect(raw).toEqual(['head', 'eyes', 'sword', 'plate_bodymerged', 'cloth_bodymerged']);

    expect(names(composedFarMeshes(composedRoot(['sword'])))).toEqual([
      'head',
      'eyes',
      'plate_bodymerged',
      'cloth_bodymerged',
    ]);
  });

  it('gives the SAME list whatever the character is holding', () => {
    // The property the whole far LOD rests on, stated directly. The bake's
    // throwaway is composed with no weapon ids (class default, one mesh) while
    // the character resolving against it carries its own equipment (here a
    // mainhand and an offhand). Any filter that counted props would hand these
    // two different lists, and the difference is not at the end.
    const bakeTemp = composedFarMeshes(composedRoot(['class_default_sword']));
    const character = composedFarMeshes(composedRoot(['greataxe', 'shield']));
    expect(names(character)).toEqual(names(bakeTemp));
    expect(character).toHaveLength(bakeTemp.length);
  });

  it('resolves each merged group to its OWN material', () => {
    // The failure this closes was not an exception, it was every merged group
    // wearing the material of the slot before it. Walk both sides the way the
    // renderer does and check the pairing by name.
    const character = composedRoot(['greataxe', 'shield']);
    const captured = composedFarMeshes(character).map(
      (m) => (m.material as THREE.Material & { name: string }).name,
    );
    const groups = names(composedFarMeshes(composedRoot(['class_default_sword'])));
    expect(captured).toEqual(groups.map((n) => `mat_${n}`));
  });

  it('still drops face decals, hidden chains and geometry-less meshes', () => {
    const root = composedRoot([]);
    const decal = mesh('stubble_decal');
    decal.userData.faceDecal = true;
    root.add(decal);

    const hiddenParent = new THREE.Group();
    hiddenParent.visible = false;
    hiddenParent.add(mesh('hidden_cape'));
    root.add(hiddenParent);

    const empty = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    empty.name = 'no_position';
    root.add(empty);

    expect(names(composedFarMeshes(root))).toEqual([
      'head',
      'eyes',
      'plate_bodymerged',
      'cloth_bodymerged',
    ]);
  });
});

describe('farSourceMaterials', () => {
  it('reads the captured slots back in bake-group order', () => {
    const root = composedRoot(['sword']);
    root.userData.farMaterials = composedFarMeshes(root).map((m) => m.material);
    const out = farSourceMaterials(root, 4);
    expect(out.map((m) => (m as THREE.Material & { name: string }).name)).toEqual([
      'mat_head',
      'mat_eyes',
      'mat_plate_bodymerged',
      'mat_cloth_bodymerged',
    ]);
  });

  it('pads rather than leaving a group without a material', () => {
    const root = composedRoot([]);
    root.userData.farMaterials = [new THREE.MeshStandardMaterial({ name: 'only' })];
    const out = farSourceMaterials(root, 3);
    expect(out).toHaveLength(3);
    for (const m of out) expect(m).toBeInstanceOf(THREE.Material);
    // ...and the pad is one shared fallback instance, not three
    expect(out[2]).toBe(out[1]);
  });
});

describe('takeFarBakeBudget', () => {
  afterEach(() => vi.restoreAllMocks());

  it('admits one bake per window and refuses the rest', () => {
    // The gate exists because setFar drives the bake on the crossing EDGE: a
    // camera riding away from a capital flips every composed peer to far in one
    // frame, and each genuinely new part set is a full compose plus a mixer step
    // plus a static rebake. Without it that is one frame paying for all of them.
    const now = vi.spyOn(performance, 'now');

    now.mockReturnValue(1_000_000);
    expect(takeFarBakeBudget()).toBe(true);
    expect(takeFarBakeBudget()).toBe(false); // same instant: the slot is taken
    now.mockReturnValue(1_000_029);
    expect(takeFarBakeBudget()).toBe(false); // still inside the window
    now.mockReturnValue(1_000_030);
    expect(takeFarBakeBudget()).toBe(true); // window elapsed: a new slot
    expect(takeFarBakeBudget()).toBe(false); // ...and immediately taken again
  });

  it('keeps the window short enough for a crowd to drain in about a second', () => {
    // A 20-look crowd must not take 20 seconds to stop being articulated. Pin
    // the ceiling rather than the constant: the number can move, the property
    // that a crowd drains inside a second cannot.
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(2_000_000);
    expect(takeFarBakeBudget()).toBe(true);
    let elapsed = 0;
    while (elapsed < 1000) {
      elapsed++;
      now.mockReturnValue(2_000_000 + elapsed);
      if (takeFarBakeBudget()) break;
    }
    expect(elapsed).toBeLessThanOrEqual(50); // 20 looks x 50ms = one second
  });
});

describe('far-LOD wiring (source pins)', () => {
  // These four are statement order and call-site identity in code that needs a
  // GPU and a parsed GLB to run. Each one reverts to a green suite without a
  // pin, and each one is silent in the wrong direction: a mis-colouring, a
  // frame spike, a character stuck articulated, or a leaked ref.

  it('captures the far materials AFTER attachAllProps, so both walks see one tree', () => {
    const body = fnBody('src/render/characters/assets.ts', 'export function assembleModular(');
    const attach = body.indexOf('attachAllProps(');
    const capture = body.indexOf('root.userData.farMaterials =');
    expect(attach).toBeGreaterThan(-1);
    expect(capture).toBeGreaterThan(-1);
    expect(attach).toBeLessThan(capture);
    // ...and off the composed filter, never the raw one
    expect(body).toContain('composedFarMeshes(root)');
  });

  it('bakes the composed LOD off composedFarMeshes and the fixed rig off farBakeMeshes', () => {
    // Two different filters on purpose: the fixed-rig bake reads its materials
    // back out of the same walk, so it is self-consistent and keeps the weapon;
    // the composed bake is shared per part set, which cannot represent one.
    const composed = fnBody('src/render/characters/assets.ts', 'export function modularFarBake(');
    expect(composed).toContain('bakeStaticPose(norm, composedFarMeshes(temp))');
    const fixed = fnBody('src/render/characters/assets.ts', 'export function prepareVisual(');
    expect(fixed).toContain('bakeStaticPose(norm, farBakeMeshes(temp))');
  });

  it('peeks before spending the budget, and goes pending when refused', () => {
    // A part set someone already baked must never compete for the frame slot:
    // a crowd sharing a haircut would otherwise drain one character per window
    // for no work at all. And a refusal has to be remembered, or the character
    // stays articulated for as long as it stays far.
    const body = fnBody('src/render/characters/visual.ts', 'private attemptComposedFar()');
    const peek = body.indexOf('peekModularFarBake(');
    const budget = body.indexOf('takeFarBakeBudget()');
    expect(peek).toBeGreaterThan(-1);
    expect(budget).toBeGreaterThan(peek);
    expect(body).toContain('this.farBakePending = true');
  });

  it('answers the peek from the cache without minting a variant', () => {
    // The cheap arm has to STAY cheap. A peek that composed to answer would be
    // exactly the cost it exists to avoid, once per far crossing per peer, and
    // it would mint an entry (and a ref) for a look nobody is wearing.
    const body = fnBody('src/render/characters/assets.ts', 'export function peekModularFarBake(');
    expect(body).toContain('modularVariantCache.get(');
    expect(body).toContain('entry?.far');
    expect(body).not.toContain('modularVariant(');
    expect(body).not.toContain('assembleModular(');
  });

  it('retries a pending bake from the per-frame update', () => {
    const body = fnBody('src/render/characters/visual.ts', '  update(dt: number');
    expect(body).toContain('this.farBakePending && this.far && !this.farBakeTried');
    expect(body).toContain('this.attemptComposedFar()');
  });

  it('releases the retained variant AND the tinted leases when construction throws', () => {
    // assembleModular retains the part set as its LAST act, so a visual that
    // throws anywhere after that (a missing clip, an atlas, a click proxy) owns
    // a ref nothing will ever release: the entry becomes permanently
    // unevictable, which is the precise failure the cache cap exists to prevent.
    //
    // The tinted-material leases are the same hazard one layer over:
    // applyMaterials and the far build claim them before any of those throw
    // points, dispose() is what normally hands them back, and a constructor
    // that throws never reaches dispose. Both releases are asserted here
    // because both are invisible when missing (a leak, not a failure) and the
    // throw they have to survive is the DESIGNED streamed-asset retry.
    const text = src('src/render/characters/visual.ts');
    const ctor = text.indexOf('    } catch (err) {');
    expect(ctor).toBeGreaterThan(-1);
    const body = text.slice(ctor, text.indexOf('throw err;', ctor));
    expect(body).toContain('releaseModularVariant(this.model)');
    expect(body).toContain('releaseTintedMaterials(this.tintedRigClaims)');
    expect(body).toContain('releaseTintedMaterials(this.tintedFarClaims)');
  });
});

describe('buildComposedFar catches a fresh far mesh up on effect state', () => {
  // The far mesh is minted lazily, on the first crossing into the far band,
  // not in the constructor. Every state edge that overlays it (ghost, soul
  // rend, shadowform, moonkin, metamorph, rune tint) runs through
  // applyVisualMaterials, and every one of those setters early-returns when
  // the state has not moved, so a setter that fired BEFORE this mesh existed
  // never re-fires once it does. The only place left to catch it up is the
  // mint itself.
  //
  // `buildComposedFar` is private and the class is heavy to construct for
  // real (a GLTF-backed modular def), so these drive the real prototype
  // method against a minimal object whose prototype IS CharacterVisual's, via
  // Object.create: the private helpers it calls (buildFarMeshes,
  // applyVisualMaterials, and the effect-material chain beneath it) resolve
  // through the prototype exactly as they would on a live instance, while
  // only the module-level bake collaborators (modularFarBake, prepareVisual,
  // tintedFarMaterials, farSourceMaterials, skinTexture, skinEmissiveTexture)
  // are stubbed, since those need a loaded GLB and asset registry this test
  // has no reason to stand up.

  afterEach(() => vi.restoreAllMocks());

  // This field list is a hand-kept mirror of what CharacterVisual's real
  // constructor sets: a new constructor field buildComposedFar reads will
  // read undefined here unless this list tracks it too.
  function fakeVisual(overrides: Record<string, unknown> = {}) {
    // biome-ignore lint/suspicious/noExplicitAny: private-method access, see buildComposedFar
    const fake: any = Object.create(CharacterVisual.prototype);
    Object.assign(fake, {
      farBakeTried: false,
      look: { app: {}, worn: {} },
      key: 'test_key',
      model: new THREE.Group(),
      entityColor: 0xffffff,
      skinIndex: 0,
      tintedFarClaims: new Set(),
      shadowProxy: null,
      poseWrap: new THREE.Group(),
      originalMaterials: new Map(),
      farMesh: null,
      farMaterials: null,
      // A ghost is on before this mesh ever existed, the exact scenario the
      // fix closes: a player who stealthed near the camera, then walked far
      // enough to cross into the far band for the first time.
      ghosted: true,
      ghostStyle: 'spirit',
      ghostMaterials: new Map(),
      soulRend: false,
      metamorph: false,
      moonkin: false,
      shadowform: false,
      runeTint: null,
      auraGlowIntensity: 0,
      ...overrides,
    });
    return fake;
  }

  it('applies the ghost overlay to the far mesh it just minted', () => {
    const rawFarMats = [new THREE.MeshStandardMaterial({ name: 'far_body' })];
    vi.spyOn(assets, 'modularFarBake').mockReturnValue({
      geo: new THREE.BufferGeometry(),
      isBody: [true],
    } as unknown as ReturnType<typeof assets.modularFarBake>);
    vi.spyOn(assets, 'prepareVisual').mockReturnValue({
      def: {},
    } as unknown as ReturnType<typeof assets.prepareVisual>);
    vi.spyOn(assets, 'farSourceMaterials').mockReturnValue([]);
    vi.spyOn(assets, 'skinTexture').mockReturnValue(null);
    vi.spyOn(assets, 'skinEmissiveTexture').mockReturnValue(null);
    vi.spyOn(assets, 'tintedFarMaterials').mockReturnValue(rawFarMats);

    const fake = fakeVisual();
    // biome-ignore lint/suspicious/noExplicitAny: private-method access
    const proto = CharacterVisual.prototype as any;
    // Call-through spies (not mocks): they record order without replacing the
    // real behavior, so buildFarMeshes still mints a real farMesh and
    // applyVisualMaterials still runs the real ghost-material chain.
    const order: string[] = [];
    const buildFarMeshesSpy = vi.spyOn(fake, 'buildFarMeshes').mockImplementation(function (
      this: unknown,
      ...args: unknown[]
    ) {
      order.push('buildFarMeshes');
      return proto.buildFarMeshes.apply(this, args);
    });
    const applyVisualMaterialsSpy = vi
      .spyOn(fake, 'applyVisualMaterials')
      .mockImplementation(function (this: unknown) {
        order.push('applyVisualMaterials');
        return proto.applyVisualMaterials.call(this);
      });

    proto.buildComposedFar.call(fake);

    // The property under test: applyVisualMaterials must run, and it must run
    // AFTER the mesh exists to catch up (a call before buildFarMeshes would
    // find farMesh still null and overlay nothing).
    expect(buildFarMeshesSpy).toHaveBeenCalledTimes(1);
    expect(applyVisualMaterialsSpy).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['buildFarMeshes', 'applyVisualMaterials']);

    // And the effect actually reached the mesh: a ghosted body's far material
    // is a transparent clone, never the raw tinted material tintedFarMaterials
    // handed back. Without the fix this stays the raw, opaque reference.
    const farMesh = fake.farMesh as THREE.Mesh;
    expect(farMesh).not.toBeNull();
    const farMat = (farMesh.material as THREE.Material[])[0] as THREE.MeshStandardMaterial;
    expect(farMat).not.toBe(rawFarMats[0]);
    expect(farMat.transparent).toBe(true);
  });

  it('never calls applyVisualMaterials when the bake yields nothing, so the cheap path stays cheap', () => {
    vi.spyOn(assets, 'modularFarBake').mockReturnValue(null);
    const fake = fakeVisual();
    const applyVisualMaterialsSpy = vi.spyOn(fake, 'applyVisualMaterials');

    // biome-ignore lint/suspicious/noExplicitAny: private-method access
    (CharacterVisual.prototype as any).buildComposedFar.call(fake);

    expect(applyVisualMaterialsSpy).not.toHaveBeenCalled();
    expect(fake.farBakeTried).toBe(true);
  });
});

describe('attemptComposedFar keeps farBakeTried in step with a refused budget', () => {
  // The retry state machine is `setFar` -> `attemptComposedFar` -> `update()`,
  // and it rests on one property attemptComposedFar is not free to break:
  // farBakeTried only latches true once buildComposedFar actually ran (pinned
  // as source above: "peeks before spending the budget, and goes pending when
  // refused"). A refused budget must leave farBakeTried false (and
  // farBakePending true) so update()'s
  // `this.farBakePending && this.far && !this.farBakeTried` guard keeps
  // retrying every frame until a slot frees. Moving `this.farBakeTried = true`
  // out of buildComposedFar and up into attemptComposedFar, above the budget
  // check, keeps every pinned text fragment above intact (peek still precedes
  // the budget call, farBakePending still gets set) while silently stranding a
  // budget-refused character articulated forever: nothing throws, it just
  // never retries.

  afterEach(() => vi.restoreAllMocks());

  // Same caveat as the fakeVisual above: this field list is a hand-kept
  // mirror of CharacterVisual's real constructor and must track it.
  function fakeVisual(overrides: Record<string, unknown> = {}) {
    // biome-ignore lint/suspicious/noExplicitAny: private-method access, see attemptComposedFar
    const fake: any = Object.create(CharacterVisual.prototype);
    Object.assign(fake, {
      farBakeTried: false,
      farBakePending: false,
      look: { app: {}, worn: {} },
      key: 'test_key',
      model: new THREE.Group(),
      entityColor: 0xffffff,
      skinIndex: 0,
      tintedFarClaims: new Set(),
      shadowProxy: null,
      poseWrap: new THREE.Group(),
      originalMaterials: new Map(),
      farMesh: null,
      farMaterials: null,
      ghosted: false,
      ghostStyle: 'spirit',
      ghostMaterials: new Map(),
      soulRend: false,
      metamorph: false,
      moonkin: false,
      shadowform: false,
      runeTint: null,
      auraGlowIntensity: 0,
      ...overrides,
    });
    return fake;
  }

  it('leaves farBakeTried false and goes pending when the budget refuses', () => {
    vi.spyOn(assets, 'peekModularFarBake').mockReturnValue(null);
    const budget = vi.spyOn(assets, 'takeFarBakeBudget').mockReturnValue(false);
    // biome-ignore lint/suspicious/noExplicitAny: private-method access
    const proto = CharacterVisual.prototype as any;
    const buildComposedFarSpy = vi.spyOn(proto, 'buildComposedFar');
    const fake = fakeVisual();

    proto.attemptComposedFar.call(fake);

    expect(budget).toHaveBeenCalledTimes(1);
    // The property the mutation breaks: a refused attempt must never reach
    // buildComposedFar, so farBakeTried (which only buildComposedFar sets)
    // stays false and the retry guard in update() can fire again next frame.
    expect(buildComposedFarSpy).not.toHaveBeenCalled();
    expect(fake.farBakeTried).toBe(false);
    expect(fake.farBakePending).toBe(true);
  });

  it('proceeds through the real bake and latches farBakeTried when the budget allows', () => {
    vi.spyOn(assets, 'peekModularFarBake').mockReturnValue(null);
    vi.spyOn(assets, 'takeFarBakeBudget').mockReturnValue(true);
    vi.spyOn(assets, 'modularFarBake').mockReturnValue({
      geo: new THREE.BufferGeometry(),
      isBody: [true],
    } as unknown as ReturnType<typeof assets.modularFarBake>);
    vi.spyOn(assets, 'prepareVisual').mockReturnValue({
      def: {},
    } as unknown as ReturnType<typeof assets.prepareVisual>);
    vi.spyOn(assets, 'farSourceMaterials').mockReturnValue([]);
    vi.spyOn(assets, 'skinTexture').mockReturnValue(null);
    vi.spyOn(assets, 'skinEmissiveTexture').mockReturnValue(null);
    vi.spyOn(assets, 'tintedFarMaterials').mockReturnValue([
      new THREE.MeshStandardMaterial({ name: 'far_body' }),
    ]);
    const fake = fakeVisual();

    // biome-ignore lint/suspicious/noExplicitAny: private-method access
    (CharacterVisual.prototype as any).attemptComposedFar.call(fake);

    expect(fake.farBakeTried).toBe(true);
    expect(fake.farBakePending).toBe(false);
    expect(fake.farMesh).not.toBeNull();
  });
});

// peekModularFarBake and modularFarBake are the cheap/expensive pair the whole
// budgeted far path rests on. peekModularFarBake is pinned only by call-text
// above ("answers the peek from the cache without minting a variant"), which a
// mutant satisfies while gutting the behavior: `return null` unconditionally
// still contains none of the forbidden substrings, and every character with an
// already-baked part set would queue behind the 30ms budget instead of reusing
// what modularFarBake already minted. Driving the real functions needs a real
// (mocked) GLTF loader and a fresh module instance, the same seam
// character_visual_material_release.test.ts uses for full CharacterVisual
// construction: a trivial non-skinned stub scene flows harmlessly through
// modularVariant (nothing to drop, no skinned parts to merge) and
// attachAllProps (no bone in the stub for any attach slot to resolve against),
// so the real assembleModular/bakeStaticPose pipeline runs end to end without
// needing authored rig/bone data.
describe('peekModularFarBake and modularFarBake', () => {
  afterEach(() => {
    vi.doUnmock('../src/render/assets/loader');
    vi.resetModules();
  });

  function stubGltf() {
    const scene = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
    m.name = 'body';
    scene.add(m);
    return { scene, animations: [] };
  }

  async function loadAssetsReady(): Promise<AssetsModule> {
    vi.resetModules();
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
      loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
      loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    }));
    const assetsModule = (await import('../src/render/characters/assets')) as AssetsModule;
    await assetsModule.charactersReady();
    return assetsModule;
  }

  it('mints a bake once through the real modularFarBake, then the peek answers it for free', async () => {
    const assetsModule = await loadAssetsReady();
    const key = MODULAR_WARRIOR_KEY;

    // Nothing minted yet for this part set.
    expect(assetsModule.peekModularFarBake(key, DEFAULT_LOOK)).toBeNull();

    const minted = assetsModule.modularFarBake(key, DEFAULT_LOOK);
    expect(minted).not.toBeNull();

    // peekModularFarBake and takeFarBakeBudget live in the SAME module, so a
    // namespace spy (vi.spyOn(assetsModule, 'takeFarBakeBudget')) never
    // observes a call the peek makes internally: that call resolves through
    // the module-local binding, not the exported one the spy wraps (proven:
    // inserting takeFarBakeBudget() into the peek left this test green
    // against the old spy assertion). Prove "for free" against the budget's
    // own observable state instead. Take the slot directly, let its window
    // elapse, peek, then take the slot directly again at that SAME instant:
    // if the peek had secretly spent the fresh window, this second direct
    // call would find it already taken.
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1_000_000);
    expect(assetsModule.takeFarBakeBudget()).toBe(true);

    now.mockReturnValue(1_000_010); // still inside the window
    // The peek must answer correctly whether the budget is fresh or already
    // spent: it never touches it either way.
    expect(assetsModule.peekModularFarBake(key, DEFAULT_LOOK)).toBe(minted);

    now.mockReturnValue(1_000_030); // window elapsed: the slot is fresh again
    const peeked = assetsModule.peekModularFarBake(key, DEFAULT_LOOK);
    // The property the `return null` mutation breaks: an already-baked part
    // set answers from the cache, the SAME object modularFarBake minted.
    expect(peeked).toBe(minted);
    // ...and the fresh slot from 1_000_030 is still unclaimed: a direct call
    // at the same instant only reads true if the peek above never spent it.
    expect(assetsModule.takeFarBakeBudget()).toBe(true);
    now.mockRestore();

    // An unrelated key never matches a cached entry.
    expect(assetsModule.peekModularFarBake('does_not_exist_key', DEFAULT_LOOK)).toBeNull();
  }, 20000);
});
