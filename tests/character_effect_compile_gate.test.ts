import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AnimState } from '../src/render/characters/anim_state';
import { SURFACE_RESPONSE_PROGRAM } from '../src/render/characters/surface_response';
import type { CharacterVisual, CharacterVisualOptions } from '../src/render/characters/visual';
import type { Entity } from '../src/sim/types';

// A rig goes translucent (stealth, the spirit run, Shadowform, Moonkin) by
// mounting a `transparent = true` clone of every one of its materials, and
// three keys its program cache on that flip. Swapping those clones onto a
// VISIBLE rig therefore links a brand new program on the next draw: the 4808 ms
// `paladin_metallic` stall of the 2026-08-17 Eastbrook crowd capture, plus four
// `mod_cloth` / `mod_jewel` rows at 115 to 130 ms on the same rig.
//
// These cases pin the hide-compile-reveal that closes it, and the shape of it
// that keeps it fair: the BODY IS NEVER HIDDEN. The rig keeps drawing its
// current, already-linked materials while the clones compile on a hidden
// scratch mesh set, the swap commits on the per-frame update() path once the
// gate settles, and every later toggle of that clone set is immediate.

const FRAME = 1 / 60;

const dummyEntity = {
  kind: 'mob',
  id: 1,
  templateId: 'training_dummy',
  color: 0xffffff,
  skin: 0,
  mainhandItemId: null,
} as unknown as Entity;

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

/** A minimally real skinned GLB: the overlay clones the rig's own materials,
 *  so the harness has to carry real meshes with real materials. It carries a
 *  PLAIN prop mesh next to the skinned body on purpose: a rig's attached
 *  weapons, its class halo and its baked far mesh are all unskinned, and three
 *  keys `skinning` on isSkinnedMesh. */
function stubGltf() {
  const scene = new THREE.Group();
  const rootBone = new THREE.Bone();
  rootBone.name = 'RigRoot';
  const childBone = new THREE.Bone();
  childBone.name = 'RigChild';
  childBone.position.y = 1;
  rootBone.add(childBone);
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const vertexCount = geometry.getAttribute('position').count;
  const skinIndices = new Uint16Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i++) {
    skinIndices[i * 4] = 1;
    skinWeights[i * 4] = 1;
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  mesh.name = 'body';
  mesh.add(rootBone);
  mesh.bind(new THREE.Skeleton([rootBone, childBone]));
  scene.add(mesh);
  const prop = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.2, 0.9),
    new THREE.MeshStandardMaterial(),
  );
  prop.name = 'prop_plank';
  childBone.add(prop);
  const clip = (name: string) =>
    new THREE.AnimationClip(name, 1, [
      new THREE.NumberKeyframeTrack('RigChild.position[x]', [0, 1], [0, 1]),
    ]);
  return { scene, animations: ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'].map(clip) };
}

/** Every material the rig itself is drawing (the scratch set hangs off the
 *  pose wrapper, outside the model, so it can never be counted here). */
function rigMaterials(visual: CharacterVisual): THREE.Material[] {
  const model = (visual as unknown as { model: THREE.Object3D }).model;
  const out: THREE.Material[] = [];
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = mesh.material;
    for (const material of Array.isArray(mats) ? mats : [mats]) if (material) out.push(material);
  });
  return out;
}

function rigIsTranslucent(visual: CharacterVisual): boolean {
  const mats = rigMaterials(visual);
  return mats.length > 0 && mats.every((material) => material.transparent);
}

/** Every geometry a staged twin can be built over, mapped to whether the mesh
 *  the rig actually DRAWS it with is skinned: the rig's own meshes plus the
 *  baked far mesh. */
function sourceIsSkinnedByGeometry(visual: CharacterVisual): Map<THREE.BufferGeometry, boolean> {
  const priv = visual as unknown as { model: THREE.Object3D; farMesh: THREE.Mesh | null };
  const out = new Map<THREE.BufferGeometry, boolean>();
  const record = (mesh: THREE.Mesh | null): void => {
    if (!mesh?.geometry) return;
    out.set(mesh.geometry, (mesh as THREE.SkinnedMesh).isSkinnedMesh === true);
  };
  priv.model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) record(mesh);
  });
  record(priv.farMesh);
  return out;
}

function meshNamed(visual: CharacterVisual, name: string): THREE.Mesh {
  const priv = visual as unknown as { model: THREE.Object3D };
  const found = priv.model.getObjectByName(name) as THREE.Mesh | undefined;
  if (!found) throw new Error(`test harness lost the ${name} mesh`);
  return found;
}

function scratchOf(visual: CharacterVisual): THREE.Group | null {
  return (visual as unknown as { effectSwapScratch: THREE.Group | null }).effectSwapScratch;
}

type GateCall = { target: THREE.Object3D; settle: () => void };

async function makeVisual(opts?: CharacterVisualOptions): Promise<CharacterVisual> {
  vi.resetModules();
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
    loadHdr: vi.fn(() => new Promise(() => undefined)),
    loadTexture: vi.fn(() => new Promise(() => undefined)),
    loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
    releaseGltf: vi.fn(),
  }));
  const { preloadTrainingDummyAssets } = await import('../src/render/characters/assets');
  await preloadTrainingDummyAssets();
  let visual: CharacterVisual | null;
  if (opts) {
    const { CharacterVisual: Visual } = await import('../src/render/characters/visual');
    const { visualKeyFor } = await import('../src/render/characters/manifest');
    visual = new Visual(visualKeyFor(dummyEntity), 0xffffff, 0, null, null, null, null, opts);
  } else {
    const { createCharacterVisual } = await import('../src/render/characters/index');
    visual = createCharacterVisual(dummyEntity);
  }
  if (!visual) throw new Error('test harness failed to build a CharacterVisual');
  visual.update(FRAME, anim(), true);
  return visual;
}

describe('a transparent character effect swaps in only once its programs are linked', () => {
  it('keeps the body drawing, compiles the clones hidden, and commits in update()', async () => {
    const visual = await makeVisual();
    const gateCalls: GateCall[] = [];
    visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));
    const opaque = rigMaterials(visual);
    expect(opaque.length).toBeGreaterThan(0);
    expect(opaque.every((material) => !material.transparent)).toBe(true);

    visual.setGhost(true);

    // The body is NEVER hidden: it keeps drawing the exact materials it had.
    expect(visual.root.visible).toBe(true);
    expect(rigMaterials(visual)).toEqual(opaque);
    // ...while the clones link on a hidden scratch set carrying the rig's own
    // geometry and skinning, so three keys the same programs.
    expect(gateCalls).toHaveLength(1);
    const scratch = gateCalls[0].target as THREE.Group;
    expect(scratch.name).toBe('character_effect_compile_scratch');
    expect(scratch.visible).toBe(false);
    expect(scratch.children.length).toBeGreaterThan(0);
    const stand = scratch.children[0] as THREE.SkinnedMesh;
    expect(stand.isSkinnedMesh).toBe(true);
    expect(stand.visible).toBe(false);
    expect((stand.material as THREE.Material).transparent).toBe(true);
    // The stand-in wears the rig's OWN geometry: the attribute set is in
    // three's program key, so a proxy box would link a variant nothing draws.
    const rigGeometries = new Set<THREE.BufferGeometry>();
    (visual as unknown as { model: THREE.Object3D }).model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry) rigGeometries.add(mesh.geometry);
    });
    expect(rigGeometries.has(stand.geometry)).toBe(true);

    // A frame with the link still in flight changes nothing.
    visual.update(FRAME, anim(), true);
    expect(rigMaterials(visual)).toEqual(opaque);

    // The callback must NOT commit: a material swap that changes what three
    // counts for a frame belongs on the per-frame path (numPointLights).
    gateCalls[0].settle();
    expect(rigMaterials(visual)).toEqual(opaque);

    visual.update(FRAME, anim(), true);
    expect(rigIsTranslucent(visual)).toBe(true);
    expect(scratchOf(visual)).toBeNull();

    // Once a clone set has linked, a later toggle is immediate: a ghost run or
    // a death treatment that MUST show is never held back twice.
    visual.setGhost(false);
    expect(rigMaterials(visual)).toEqual(opaque);
    expect(gateCalls).toHaveLength(1);
    visual.setGhost(true);
    expect(rigIsTranslucent(visual)).toBe(true);
    expect(gateCalls).toHaveLength(1);
    visual.dispose();
  });

  it('twins the SOURCE mesh kind, never a skinned stand-in over a plain source', async () => {
    const visual = await makeVisual();
    const gateCalls: GateCall[] = [];
    visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));

    visual.setGhost(true);
    expect(gateCalls).toHaveLength(1);
    const staged = (gateCalls[0].target as THREE.Group).children as THREE.Mesh[];
    const isSkinned = (mesh: THREE.Mesh): boolean =>
      (mesh as THREE.SkinnedMesh).isSkinnedMesh === true;

    // Both kinds are really in play here (a skinned body, a plain prop and the
    // baked far mesh), so neither arm of the rule is vacuous.
    expect(staged.filter(isSkinned).length).toBeGreaterThan(0);
    expect(staged.filter((mesh) => !isSkinned(mesh)).length).toBeGreaterThan(0);

    // three keys `skinning` on isSkinnedMesh: a twin of the wrong kind links a
    // program the real draw never binds, and the commit frame pays the
    // synchronous link the gate exists to avoid.
    const kinds = sourceIsSkinnedByGeometry(visual);
    for (const twin of staged) {
      expect(kinds.get(twin.geometry)).toBe(isSkinned(twin));
    }
    const prop = meshNamed(visual, 'prop_plank');
    const propTwin = staged.find((mesh) => mesh.geometry === prop.geometry);
    expect(propTwin).toBeDefined();
    expect(isSkinned(propTwin as THREE.Mesh)).toBe(false);

    // The depth arm is a program too: the shadow flags ride along.
    const body = meshNamed(visual, 'body');
    const bodyTwin = staged.find((mesh) => mesh.geometry === body.geometry) as THREE.Mesh;
    expect(bodyTwin.castShadow).toBe(body.castShadow);
    expect(bodyTwin.receiveShadow).toBe(body.receiveShadow);
    visual.dispose();
  });

  it('never defers the Soul Rend mark, which is actionable raid information', async () => {
    const visual = await makeVisual();
    const gateCalls: GateCall[] = [];
    visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));
    const opaque = rigMaterials(visual);

    // Nythraxis' mark tells the marked player to act, so it is exempt from the
    // deferral (graphics-settings fairness): it shows on the frame it lands.
    visual.setSoulRend(true);
    expect(rigIsTranslucent(visual)).toBe(true);
    expect(gateCalls).toHaveLength(0);
    expect(scratchOf(visual)).toBeNull();
    visual.setSoulRend(false);
    expect(rigMaterials(visual)).toEqual(opaque);

    // A cosmetic effect on the same rig still waits for its link...
    visual.setGhost(true);
    expect(gateCalls).toHaveLength(1);
    expect(rigMaterials(visual)).toEqual(opaque);
    // ...and a mark landing while that swap is still in flight wins outright.
    visual.setSoulRend(true);
    expect(rigIsTranslucent(visual)).toBe(true);
    expect(gateCalls).toHaveLength(1);
    expect(scratchOf(visual)).toBeNull();
    visual.dispose();
  });

  it('remembers a set that linked but was superseded before its commit frame', async () => {
    const visual = await makeVisual();
    const gateCalls: GateCall[] = [];
    visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));

    visual.setGhost(true);
    expect(gateCalls).toHaveLength(1);
    // The ghost clones ARE linked, but a shapeshift supersedes the swap before
    // update() commits it. Ghost outranks Shadowform, so what the visual wants
    // is exactly the set that just linked: it must swap in at once instead of
    // re-staging and re-queueing a compile-lane slot for work already done.
    gateCalls[0].settle();
    visual.setShadowform(true);
    expect(gateCalls).toHaveLength(1);
    expect(rigIsTranslucent(visual)).toBe(true);

    // A genuinely new clone set (Shadowform's) still gates once...
    visual.setGhost(false);
    expect(gateCalls).toHaveLength(2);
    // ...and the ghost set stays immediate for every later toggle.
    visual.setGhost(true);
    expect(gateCalls).toHaveLength(2);
    expect(rigIsTranslucent(visual)).toBe(true);
    visual.dispose();
  });

  it('supersedes a swap still in flight, and ignores the stale settle', async () => {
    const visual = await makeVisual();
    const gateCalls: GateCall[] = [];
    visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));
    const opaque = rigMaterials(visual);

    visual.setGhost(true);
    expect(gateCalls).toHaveLength(1);
    const superseded = gateCalls[0].target;

    // A newer effect state before the settle: the in-flight scratch is dropped
    // and the state the visual actually wants is staged instead.
    visual.setShadowform(true);
    expect(gateCalls).toHaveLength(2);
    expect(superseded.parent).toBeNull();
    expect(rigMaterials(visual)).toEqual(opaque);

    // The stale settle commits nothing.
    gateCalls[0].settle();
    visual.update(FRAME, anim(), true);
    expect(rigMaterials(visual)).toEqual(opaque);

    gateCalls[1].settle();
    visual.update(FRAME, anim(), true);
    expect(rigIsTranslucent(visual)).toBe(true);
    visual.dispose();
  });

  it('swaps immediately with no gate installed (previews, tests, no async compile)', async () => {
    const visual = await makeVisual();
    // No setFarBakeGate at all: the pre-gate behaviour, unchanged.
    visual.setGhost(true);
    expect(rigIsTranslucent(visual)).toBe(true);
    expect(scratchOf(visual)).toBeNull();

    // ...and installing a gate afterwards does not retroactively gate what is
    // already mounted, but DOES clear any pending swap (the pool re-acquire).
    const gateCalls: GateCall[] = [];
    visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));
    expect(scratchOf(visual)).toBeNull();
    visual.dispose();
  });

  it('keeps the opaque body and never throws when the gate rejects', async () => {
    const visual = await makeVisual();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    visual.setFarBakeGate(() => {
      throw new Error('compile gate rejected');
    });
    const opaque = rigMaterials(visual);

    expect(() => visual.setGhost(true)).not.toThrow();
    expect(rigMaterials(visual)).toEqual(opaque);
    expect(scratchOf(visual)).toBeNull();
    expect(() => visual.update(FRAME, anim(), true)).not.toThrow();
    expect(rigMaterials(visual)).toEqual(opaque);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    visual.dispose();
  });

  it('drops a swap still in flight on dispose without disposing the live clones', async () => {
    const visual = await makeVisual();
    const gateCalls: GateCall[] = [];
    visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));
    visual.setGhost(true);
    const scratch = gateCalls[0].target;
    expect(scratch.parent).not.toBeNull();

    visual.dispose();
    expect(scratch.parent).toBeNull();
    // A settle landing after the teardown is inert.
    expect(() => gateCalls[0].settle()).not.toThrow();
  });
});

// The element response (a scorch, a frost rime) is its own program per rig
// material shape. A host that knows a rig will be struck links it as the rig is
// built, so the first trigger swaps in on the frame it lands instead of staging
// a link on a combat frame (Fire and Fly's mid-wave hitches).
describe('an element response linked ahead of its first trigger', () => {
  const responding = (visual: CharacterVisual): boolean =>
    rigMaterials(visual).every((material) => material.userData[SURFACE_RESPONSE_PROGRAM] === true);

  it('links the clones hidden on the rig and far twins, and the first trigger after swaps at once', async () => {
    const visual = await makeVisual();
    const gateCalls: GateCall[] = [];
    visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));
    const before = rigMaterials(visual);

    const ready = visual.prepareElementResponse();
    expect(gateCalls).toHaveLength(1);
    const scratch = gateCalls[0].target as THREE.Group;
    expect(scratch.name).toBe('character_element_response_scratch');
    expect(scratch.visible).toBe(false);
    expect(scratch.parent).not.toBeNull();
    const twins = scratch.children as THREE.Mesh[];
    const kinds = sourceIsSkinnedByGeometry(visual);
    // Every source an effect would clone, the far mesh included, each on its own kind.
    expect(new Set(twins.map((twin) => twin.geometry))).toEqual(new Set(kinds.keys()));
    for (const twin of twins) {
      expect(twin.visible).toBe(false);
      expect((twin.material as THREE.Material).userData[SURFACE_RESPONSE_PROGRAM]).toBe(true);
      expect(kinds.get(twin.geometry)).toBe((twin as THREE.SkinnedMesh).isSkinnedMesh === true);
    }
    const farMesh = (visual as unknown as { farMesh: THREE.Mesh | null }).farMesh;
    expect(farMesh).not.toBeNull();
    expect(twins.some((twin) => twin.geometry === farMesh?.geometry)).toBe(true);
    // Nothing shows: the rig keeps its own materials.
    expect(rigMaterials(visual)).toEqual(before);

    gateCalls[0].settle();
    await expect(ready).resolves.toBe(true);
    expect(scratch.parent).toBeNull();
    expect(rigMaterials(visual)).toEqual(before);

    visual.respondToElement('fire', 0.8);
    expect(responding(visual)).toBe(true);
    expect(gateCalls).toHaveLength(1);
    expect(scratchOf(visual)).toBeNull();
    await expect(visual.prepareElementResponse()).resolves.toBe(true);
    expect(gateCalls).toHaveLength(1);
    visual.dispose();
  });

  it('links only the rig twins on a visual built with no far LOD, and still swaps at once', async () => {
    const visual = await makeVisual({ farLod: false });
    const gateCalls: GateCall[] = [];
    visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));
    expect((visual as unknown as { farMesh: THREE.Mesh | null }).farMesh).toBeNull();

    const ready = visual.prepareElementResponse();
    expect(gateCalls).toHaveLength(1);
    const twins = gateCalls[0].target.children as THREE.Mesh[];
    expect(new Set(twins.map((twin) => twin.geometry))).toEqual(
      new Set(sourceIsSkinnedByGeometry(visual).keys()),
    );
    gateCalls[0].settle();
    await expect(ready).resolves.toBe(true);

    visual.respondToElement('fire', 0.8);
    expect(responding(visual)).toBe(true);
    expect(gateCalls).toHaveLength(1);
    expect(scratchOf(visual)).toBeNull();
    visual.dispose();
  });

  it('detaches a stage still in flight when a new compile gate is installed', async () => {
    const visual = await makeVisual();
    const gateCalls: GateCall[] = [];
    visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));
    const ready = visual.prepareElementResponse();
    const scratch = gateCalls[0].target;
    expect(scratch.parent).not.toBeNull();
    visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));
    expect(scratch.parent).toBeNull();
    gateCalls[0].settle();
    await expect(ready).resolves.toBe(false);
    visual.dispose();
  });

  it('records the clones linked with no gate call when a rig of the same shape linked them', async () => {
    const visual = await makeVisual();
    const gateCalls: GateCall[] = [];
    visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));
    await expect(visual.prepareElementResponse({ linked: true })).resolves.toBe(true);
    visual.respondToElement('fire', 0.8);
    expect(responding(visual)).toBe(true);
    expect(gateCalls).toHaveLength(0);
    visual.dispose();
  });

  it('still stages on the first trigger of a rig never prepared', async () => {
    const visual = await makeVisual();
    const gateCalls: GateCall[] = [];
    visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));
    const before = rigMaterials(visual);
    visual.respondToElement('fire', 0.8);
    expect(gateCalls).toHaveLength(1);
    expect(gateCalls[0].target.name).toBe('character_effect_compile_scratch');
    expect(rigMaterials(visual)).toEqual(before);
    visual.dispose();
  });

  it('settles a stage outlived by its visual as not linked, its scratch already detached', async () => {
    const visual = await makeVisual();
    const gateCalls: GateCall[] = [];
    visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));
    const ready = visual.prepareElementResponse();
    const scratch = gateCalls[0].target;
    visual.dispose();
    expect(scratch.parent).toBeNull();
    expect(() => gateCalls[0].settle()).not.toThrow();
    await expect(ready).resolves.toBe(false);
  });

  it('prepares nothing with no gate, and never throws on a gate that rejects', async () => {
    const bare = await makeVisual();
    await expect(bare.prepareElementResponse()).resolves.toBe(false);
    bare.respondToElement('fire', 0.8);
    expect(responding(bare)).toBe(true);
    bare.dispose();

    const visual = await makeVisual();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    visual.setFarBakeGate(() => {
      throw new Error('compile gate rejected');
    });
    await expect(visual.prepareElementResponse()).resolves.toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(
      (visual as unknown as { elementResponseScratch: THREE.Group | null }).elementResponseScratch,
    ).toBeNull();
    warn.mockRestore();
    visual.dispose();
  });
});

// A host that never draws a far LOD (the Fire and Fly arena) builds its rigs with
// none, so the gate that walks the rig at its attach links no far program. The
// far mesh is the one representation such a rig could otherwise show unlinked:
// with none built, setFar keeps the articulated rig, whatever calls it.
describe('a visual built with no far LOD', () => {
  const farNodes = (visual: CharacterVisual): string[] => {
    const names: string[] = [];
    visual.root.traverse((object) => {
      if (/^character_(far_mesh|far_wrap|shadow_proxy)$/.test(object.name)) names.push(object.name);
    });
    return names;
  };
  const modelShown = (visual: CharacterVisual): boolean =>
    (visual as unknown as { modelWrap: THREE.Group }).modelWrap.visible;

  it('carries no far mesh for its gate to link, where a default visual still does', async () => {
    const plain = await makeVisual();
    expect(farNodes(plain)).toContain('character_far_mesh');
    plain.dispose();

    const visual = await makeVisual({ farLod: false });
    expect(farNodes(visual)).toEqual([]);
    visual.dispose();
  });

  it('keeps drawing the articulated rig on a far crossing, before and after a pool re-acquire', async () => {
    const visual = await makeVisual({ farLod: false });
    const gateCalls: GateCall[] = [];
    visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));
    visual.setProxyShadow(true);
    for (let pass = 0; pass < 2; pass++) {
      visual.setFar(true);
      visual.update(FRAME, anim(), true);
      expect(visual.isFar).toBe(true);
      expect(modelShown(visual)).toBe(true);
      expect(visual.displayedFarBody).toBeNull();
      expect(farNodes(visual)).toEqual([]);
      visual.setFar(false);
      visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));
    }
    expect(gateCalls).toHaveLength(0);
    visual.dispose();
  });

  it('is asked for by the Fire and Fly rigs only', () => {
    const users: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (
          /\.ts$/.test(entry.name) &&
          /\bfarLod\b\s*[:,}]/.test(readFileSync(path, 'utf8'))
        ) {
          users.push(path.split('\\').join('/'));
        }
      }
    };
    walk('src');
    expect(users).toEqual(['src/render/turret_defense_visual.ts']);
  });
});
