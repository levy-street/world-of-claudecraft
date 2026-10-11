// @vitest-environment happy-dom
// The CharacterVisual wiring of the shapeshift form adornments: the renderer
// already forwards the Moonwing (`setMoonkin`) edge every frame, and the visual
// turns it into rig-parented pieces (form_adornments.ts). Pins, on the REAL
// CharacterVisual over a mocked loader (the character_halo.test.ts rig):
//  - the edge mounts and unmounts the set, and dispose() takes it down;
//  - antlers only on a composed body (a fixed druid rig wears its own hood);
//  - the pieces stay out of the body's overlay cycle: a ghost, stealth or Soul
//    Rend swap, a weapon swap (rebuildCasters re-traverses the model) or the
//    tint itself never mounts an effect clone on them, and they never cast
//    shadows; under a ghost or stealth body they hide instead;
//  - Gloamveil (`setShadowform`) mounts NO piece on a rig: its look rides the
//    rig's own materials (tests/character_gloam_form.test.ts);
//  - the first mount rides the visual's injected compile gate.
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { failWocHeads, landWocBodies } from './helpers/woc_streamed';

type Visual = import('../src/render/characters/visual').CharacterVisual;
let CharacterVisual: typeof import('../src/render/characters/visual').CharacterVisual;

function stubGltf() {
  const scene = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
  body.name = 'body';
  scene.add(body);
  const chest = new THREE.Bone();
  chest.name = 'chest';
  const head = new THREE.Bone();
  head.name = 'head';
  chest.add(head);
  scene.add(chest);
  return { scene, animations: [new THREE.AnimationClip('Idle', 1, [])] };
}

beforeAll(async () => {
  vi.resetModules();
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
    loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    releaseGltf: vi.fn(),
  }));
  const assets = await import('../src/render/characters/assets');
  await assets.charactersReady();
  // The druid is a WOC body: its base and clip library stream on demand, never in the boot
  // preload, so land them through the stub loader; and the stub rig can hang no head, so end
  // the head wait a WOC body otherwise holds its draw for.
  failWocHeads(await import('../src/render/characters/woc_head_packs'));
  await landWocBodies(assets, ['player_druid']);
  ({ CharacterVisual } = await import('../src/render/characters/visual'));
});

afterAll(() => {
  vi.doUnmock('../src/render/assets/loader');
  vi.resetModules();
});

function adornments(visual: Visual): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  visual.root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && /^moonwing_/.test(mesh.name)) out.push(mesh);
  });
  return out;
}

function idleState(): Parameters<Visual['update']>[1] {
  return {
    moving: false,
    running: false,
    airborne: false,
    casting: false,
    dead: false,
  } as unknown as Parameters<Visual['update']>[1];
}

function pieceNames(visual: Visual): string[] {
  return adornments(visual)
    .map((mesh) => mesh.name)
    .sort();
}

describe('CharacterVisual form adornments', () => {
  it('mounts Moonwing on the edge, without antlers on the fixed druid rig', () => {
    const visual = new CharacterVisual('player_druid', 0xffffff, 0);
    expect(pieceNames(visual)).toEqual([]);
    visual.setMoonkin(true);
    expect(pieceNames(visual)).toEqual([
      'moonwing_crescent',
      'moonwing_wing_left_feathers',
      'moonwing_wing_right_feathers',
    ]);
    visual.setMoonkin(false);
    expect(pieceNames(visual)).toEqual([]);
    visual.dispose();
  });

  it('grows the antlers back on a composed body', () => {
    const visual = new CharacterVisual('player_druid', 0xffffff, 0);
    // The constructor keeps `look` only for a modular def, which a stubbed
    // loader cannot assemble; set the field it would hold so the SAME wiring
    // reads a composed body.
    (visual as unknown as { look: unknown }).look = { app: {}, worn: {} };
    visual.setMoonkin(true);
    expect(pieceNames(visual)).toContain('moonwing_antlers');
    expect(pieceNames(visual)).toContain('moonwing_antler_wraps');
    visual.dispose();
  });

  it('mounts no piece on a rig for Gloamveil: the form parents nothing to a bone', () => {
    const visual = new CharacterVisual('player_priest', 0xffffff, 0);
    const meshes = (): string[] => {
      const out: string[] = [];
      visual.root.traverse((object) => {
        if ((object as THREE.Mesh).isMesh) out.push(object.name);
      });
      return out.sort();
    };
    const head = visual.root.getObjectByName('head') as THREE.Object3D;
    const before = meshes();
    const onHead = [...head.children];
    visual.setShadowform(true);
    // The whole mesh list, not a name filter: the retired face veil would show
    // up here under any name, and so would a piece hung on any bone.
    expect(meshes()).toEqual(before);
    expect(head.children).toEqual(onHead);
    visual.dispose();
  });

  it('keeps the pieces on their kit materials through every overlay and weapon swap', async () => {
    const { moonwingMaterials } = await import('../src/render/characters/moonwing_adornment');
    const kit = new Set<THREE.Material>(moonwingMaterials());
    {
      const visual = new CharacterVisual('player_druid', 0xffffff, 0);
      visual.setMoonkin(true);
      const body = visual.root.getObjectByName('body') as THREE.Mesh;
      const bodyOriginal = body.material;
      // Pinned to the KIT instances, not a snapshot taken after the tint ran:
      // a tint that cloned a piece would fail here.
      const onKit = (): void => {
        const pieces = adornments(visual);
        expect(pieces.length).toBeGreaterThan(0);
        for (const mesh of pieces) {
          expect(kit.has(mesh.material as THREE.Material)).toBe(true);
          expect(mesh.castShadow).toBe(false);
        }
      };
      onKit();
      // The body DOES take the overlays: the checks are meaningful only
      // because each swap really ran.
      visual.setGhost(true);
      expect(body.material).not.toBe(bodyOriginal);
      onKit();
      visual.setGhost(false);
      visual.setSoulRend(true);
      expect(body.material).not.toBe(bodyOriginal);
      onKit();
      visual.setSoulRend(false);
      // A weapon swap re-traverses the model (rebuildCasters) and re-snapshots
      // every mesh it meets; the pieces must not enter that snapshot.
      visual.setShadow(true);
      visual.setWeapon('bogoak_staff');
      onKit();
      visual.setGhost(true, 'stealth');
      onKit();
      visual.dispose();
    }
  });

  it('hides the pieces while the body is a stealth or spirit ghost', () => {
    const visual = new CharacterVisual('player_druid', 0xffffff, 0);
    visual.setMoonkin(true);
    const roots = ['moonwing_head', 'moonwing_wing_left', 'moonwing_wing_right'].map(
      (name) => visual.root.getObjectByName(name) as THREE.Object3D,
    );
    expect(roots.every((root) => root.visible)).toBe(true);
    for (const style of ['stealth', 'spirit'] as const) {
      visual.setGhost(true, style);
      expect(roots.some((root) => root.visible)).toBe(false);
      visual.setGhost(false);
      expect(roots.every((root) => root.visible)).toBe(true);
    }
    visual.dispose();
  });

  it('holds the first mount behind the injected compile gate', () => {
    const visual = new CharacterVisual('player_druid', 0xffffff, 0);
    const settles: (() => void)[] = [];
    // The Moonwing tint stages its transparent clones through the same gate;
    // count only what the adornments hand it.
    visual.setFarBakeGate((target, settle) => {
      if (target.name.startsWith('moonwing_')) settles.push(() => settle());
    });
    visual.setMoonkin(true);
    const head = visual.root.getObjectByName('moonwing_head') as THREE.Object3D;
    expect(settles.length).toBe(3);
    expect(head.visible).toBe(false);
    for (const settle of settles) settle();
    visual.update(0.01, idleState(), true, false);
    expect(head.visible).toBe(true);
    visual.dispose();
  });

  it('animates the wings on the per-frame update', () => {
    const visual = new CharacterVisual('player_druid', 0xffffff, 0);
    visual.setMoonkin(true);
    const wing = visual.root.getObjectByName('moonwing_wing_right') as THREE.Object3D;
    const folded = wing.rotation.y;
    visual.update(1, idleState(), true, false);
    expect(wing.rotation.y).toBeLessThan(folded);
    visual.dispose();
  });
});
