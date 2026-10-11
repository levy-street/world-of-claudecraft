// @vitest-environment happy-dom
// The CharacterVisual wiring of the shapeshift form adornments: the renderer
// already forwards the Moonwing (`setMoonkin`) and Gloamveil (`setShadowform`)
// edges every frame, and the visual turns them into rig-parented pieces
// (form_adornments.ts). Pins, on the REAL CharacterVisual over a mocked
// loader (the character_halo.test.ts rig):
//  - each edge mounts and unmounts its set, and dispose() takes it down;
//  - antlers only on a composed body (a fixed druid rig wears its own hood);
//  - the pieces stay out of the body's overlay cycle: a ghost, stealth or Soul
//    Rend swap, a weapon swap (rebuildCasters re-traverses the model) or the
//    tint itself never mounts an effect clone on them, and they never cast
//    shadows; under a ghost or stealth body they hide instead;
//  - the veil stays off a Combat Mech body;
//  - the first mount rides the visual's injected compile gate.
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
  const { charactersReady } = await import('../src/render/characters/assets');
  await charactersReady();
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
    if (mesh.isMesh && /^(moonwing|gloamveil)_/.test(mesh.name)) out.push(mesh);
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

  it('mounts the Gloamveil veil on the Shadowform edge and drops it on dispose', () => {
    const visual = new CharacterVisual('player_priest', 0xffffff, 0);
    visual.setShadowform(true);
    expect(pieceNames(visual)).toEqual([
      'gloamveil_eye_left',
      'gloamveil_eye_right',
      'gloamveil_shell',
    ]);
    visual.dispose();
    expect(pieceNames(visual)).toEqual([]);
  });

  it('keeps the pieces on their kit materials through every overlay and weapon swap', async () => {
    const { moonwingMaterials } = await import('../src/render/characters/moonwing_adornment');
    const { gloamveilMaterials } = await import('../src/render/characters/gloamveil_veil');
    const kit = new Set<THREE.Material>([...moonwingMaterials(), ...gloamveilMaterials()]);
    for (const [key, shift] of [
      ['player_druid', (v: Visual) => v.setMoonkin(true)],
      ['player_priest', (v: Visual) => v.setShadowform(true)],
    ] as const) {
      const visual = new CharacterVisual(key, 0xffffff, 0);
      shift(visual);
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

  it('leaves the veil off a Combat Mech body', async () => {
    // The mech is fetched on demand, never at boot; ride its real preload.
    const { preloadMechAssets } = await import('../src/render/characters/assets');
    await preloadMechAssets();
    const visual = new CharacterVisual('player_mech', 0xffffff, 0);
    visual.setShadowform(true);
    expect(pieceNames(visual)).toEqual([]);
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
