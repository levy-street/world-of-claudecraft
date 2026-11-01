// The THREE half of the shapeshift form adornments: Moonwing Form's antlers
// and crescent, no wings (moonwing_adornment.ts) and the per-rig owner
// CharacterVisual holds (form_adornments.ts). Gloamveil mounts nothing on a
// rig (its look is a shader layer and a floor layer, tests/gloam_*.test.ts),
// which the owner block below pins. Driven on a bare synthetic rig (a `chest` bone with a
// `head` child, the KayKit names every player rig carries), so each pin reads
// the real painters without loading a GLB.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createMoonwingPose } from '../src/render/characters/form_adornment_core';
import { FormAdornments } from '../src/render/characters/form_adornments';
import {
  buildMoonwingStandIn,
  CRESCENT_REST,
  MoonwingAdornment,
  moonwingMaterials,
} from '../src/render/characters/moonwing_adornment';
import type { FarBakeGate } from '../src/render/characters/visual';
import { isSharedGeometry, isSharedMaterial, isSharedTexture } from '../src/render/shared_resource';

function rig(): { model: THREE.Group; chest: THREE.Bone; head: THREE.Bone } {
  const model = new THREE.Group();
  const chest = new THREE.Bone();
  chest.name = 'chest';
  const head = new THREE.Bone();
  head.name = 'head';
  chest.add(head);
  model.add(chest);
  return { model, chest, head };
}

function meshesUnder(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) out.push(object as THREE.Mesh);
  });
  return out;
}

function names(root: THREE.Object3D): string[] {
  return meshesUnder(root)
    .map((mesh) => mesh.name)
    .sort();
}

describe('MoonwingAdornment', () => {
  it('crowns the head with antlers, wraps and the crescent, and grows no wings', () => {
    const { model, chest, head } = rig();
    const adornment = new MoonwingAdornment(model, true);
    expect(adornment.head?.parent).toBe(head);
    expect(names(head)).toEqual(['moonwing_antler_wraps', 'moonwing_antlers', 'moonwing_crescent']);
    // Nothing rides the chest: the back stays bare.
    expect(chest.children).toEqual([head]);
    expect(adornment.roots).toEqual([adornment.head]);
    // The antlers rise above the crown, the crescent sits between them.
    const antlers = head.getObjectByName('moonwing_antlers') as THREE.Mesh;
    antlers.geometry.computeBoundingBox();
    const box = antlers.geometry.boundingBox as THREE.Box3;
    expect(box.max.y).toBeGreaterThan(1.2);
    expect(box.min.x).toBeCloseTo(-box.max.x, 5);
    expect(CRESCENT_REST.y).toBeGreaterThan(1);
    expect(CRESCENT_REST.y).toBeLessThan(box.max.y);
  });

  it('leaves the antlers off a rig that already wears them', () => {
    const { model, head } = rig();
    new MoonwingAdornment(model, false);
    expect(names(head)).toEqual(['moonwing_crescent']);
  });

  it('keeps every piece out of the body overlay cycle and the shadow pass', () => {
    const { model } = rig();
    new MoonwingAdornment(model, true);
    const pieces = meshesUnder(model);
    expect(pieces.length).toBe(3);
    for (const mesh of pieces) {
      expect(mesh.userData.weaponVfxMesh).toBe(true);
      expect(mesh.castShadow).toBe(false);
    }
  });

  it('bobs and sways the crescent from the pose', () => {
    const { model } = rig();
    const adornment = new MoonwingAdornment(model, true);
    adornment.apply({ ...createMoonwingPose(), crescentLift: 0.03 });
    expect(adornment.crescent?.position.y).toBeCloseTo(CRESCENT_REST.y + 0.03, 6);
    adornment.apply({ ...createMoonwingPose(), crescentSway: 0.05 });
    expect(adornment.crescent?.rotation.z).toBeCloseTo(0.35 + 0.05, 6);
  });

  it('detaches every piece on dispose and shares its kit across rigs', () => {
    const a = rig();
    const b = rig();
    const first = new MoonwingAdornment(a.model, true);
    new MoonwingAdornment(b.model, true);
    const pairs = meshesUnder(a.model).map((mesh) => [mesh.name, mesh] as const);
    for (const [name, mesh] of pairs) {
      const twin = b.model.getObjectByName(name) as THREE.Mesh;
      expect(twin.geometry).toBe(mesh.geometry);
      expect(twin.material).toBe(mesh.material);
    }
    first.dispose();
    expect(meshesUnder(a.model)).toEqual([]);
    expect(meshesUnder(b.model).length).toBe(3);
  });

  it('skips pieces a rig has no bone for instead of throwing', () => {
    const bare = new THREE.Group();
    const adornment = new MoonwingAdornment(bare, true);
    adornment.apply(createMoonwingPose());
    expect(meshesUnder(bare)).toEqual([]);
    adornment.dispose();
  });
});

/** A recording stand-in for the visual's compile gate: nothing settles until
 *  the test says so, like an async link still in flight. */
function recordingGate(): { gate: FarBakeGate; targets: THREE.Object3D[]; settleAll(): void } {
  const targets: THREE.Object3D[] = [];
  const pending: (() => void)[] = [];
  return {
    targets,
    gate: (target, settle) => {
      targets.push(target);
      pending.push(() => settle());
    },
    settleAll: () => {
      for (const settle of pending.splice(0)) settle();
    },
  };
}

const noGate = (): FarBakeGate | null => null;

function shownRoots(model: THREE.Object3D): string[] {
  const out: string[] = [];
  model.traverse((object) => {
    if (object.name === 'moonwing_head' && object.visible) {
      out.push(object.name);
    }
  });
  return out.sort();
}

describe('FormAdornments (the per-rig owner)', () => {
  it('mounts and unmounts the Moonwing set on its edge, idempotently', () => {
    const { model, head } = rig();
    const owner = new FormAdornments(model, 'composed', noGate);
    owner.sync(true, false);
    expect(head.getObjectByName('moonwing_antlers')).toBeDefined();
    const antlers = head.getObjectByName('moonwing_antlers');
    owner.sync(true, false);
    expect(meshesUnder(model).length).toBe(3);
    expect(head.getObjectByName('moonwing_antlers')).toBe(antlers);
    owner.sync(false, false);
    expect(meshesUnder(model)).toEqual([]);
  });

  it('grows antlers only on a composed body', () => {
    const fixed = rig();
    new FormAdornments(fixed.model, 'classRig', noGate).sync(true, false);
    expect(fixed.head.getObjectByName('moonwing_antlers')).toBeUndefined();
    expect(fixed.head.getObjectByName('moonwing_crescent')).toBeDefined();
    const mech = rig();
    const owner = new FormAdornments(mech.model, 'replacement', noGate);
    owner.sync(true, false);
    expect(names(mech.model)).toEqual(['moonwing_crescent']);
  });

  it('drifts the crescent over time only while the rig is shown', () => {
    const { model, head } = rig();
    const owner = new FormAdornments(model, 'composed', noGate);
    owner.sync(true, false);
    const crescent = head.getObjectByName('moonwing_crescent') as THREE.Object3D;
    const rest = crescent.position.y;
    // Hidden (culled or far LOD): no pose work, the clock holds.
    owner.update(1, false, false);
    expect(crescent.position.y).toBe(rest);
    owner.update(1, false, true);
    expect(crescent.position.y).not.toBe(rest);
    owner.dispose();
    expect(meshesUnder(model)).toEqual([]);
  });

  it('holds the crescent at rest under reduced motion', () => {
    const { model, head } = rig();
    const owner = new FormAdornments(model, 'composed', noGate);
    owner.sync(true, false);
    const crescent = head.getObjectByName('moonwing_crescent') as THREE.Object3D;
    owner.update(5, true, true);
    expect(crescent.position.y).toBe(CRESCENT_REST.y);
  });

  it('holds a first mount hidden behind the gate and reveals it on the frame path', () => {
    const { model } = rig();
    const recorder = recordingGate();
    const owner = new FormAdornments(model, 'composed', () => recorder.gate);
    owner.sync(true, false);
    // Every root this set parented into the rig went through the gate, hidden.
    expect(recorder.targets.map((target) => target.name)).toEqual(['moonwing_head']);
    expect(shownRoots(model)).toEqual([]);
    // Held pieces do not drift off screen: the clock starts once they show.
    const crescent = model.getObjectByName('moonwing_crescent') as THREE.Object3D;
    owner.update(1, false, true);
    expect(crescent.position.y).toBe(CRESCENT_REST.y);
    recorder.settleAll();
    // The settle only flags; the reveal waits for the per-frame update.
    expect(shownRoots(model)).toEqual([]);
    owner.update(0.01, false, true);
    expect(shownRoots(model)).toEqual(['moonwing_head']);
    // Linked once on this rig: the next shift shows at once, no second hold.
    owner.sync(false, false);
    owner.sync(true, false);
    expect(recorder.targets.length).toBe(1);
    expect(shownRoots(model).length).toBe(1);
  });

  it('never reveals a set dropped while its gate was in flight', () => {
    const { model } = rig();
    const recorder = recordingGate();
    const owner = new FormAdornments(model, 'classRig', () => recorder.gate);
    owner.sync(true, false);
    const firstMount = recorder.targets.length;
    expect(firstMount).toBe(1);
    owner.sync(false, false);
    recorder.settleAll();
    owner.update(0.01, false, true);
    expect(meshesUnder(model)).toEqual([]);
    // The dropped set never proved a link, so the next shift is held again.
    owner.sync(true, false);
    expect(recorder.targets.length).toBe(firstMount * 2);
    expect(shownRoots(model)).toEqual([]);
  });

  it('hides the pieces while the body is a ghost and restores them after', () => {
    const { model } = rig();
    const owner = new FormAdornments(model, 'composed', noGate);
    owner.sync(true, false);
    expect(shownRoots(model).length).toBe(1);
    owner.sync(true, true);
    expect(shownRoots(model)).toEqual([]);
    owner.sync(true, false);
    expect(shownRoots(model).length).toBe(1);
    // A set mounted while ghosted starts hidden too.
    owner.sync(false, true);
    owner.sync(true, true);
    expect(meshesUnder(model).length).toBe(3);
    expect(shownRoots(model)).toEqual([]);
    owner.sync(true, false);
    expect(shownRoots(model).length).toBe(1);
  });

  it('is inert after dispose: a late edge mounts nothing', () => {
    const { model } = rig();
    const owner = new FormAdornments(model, 'composed', noGate);
    owner.sync(true, false);
    owner.dispose();
    owner.sync(true, false);
    owner.update(1, false, true);
    expect(meshesUnder(model)).toEqual([]);
  });
});

describe('prewarm stand-ins', () => {
  it('stage every material each kit can hand a live rig, on plain meshes', () => {
    const staged = new Set(meshesUnder(buildMoonwingStandIn()).map((mesh) => mesh.material));
    const produced = moonwingMaterials();
    expect(produced.length).toBeGreaterThan(0);
    for (const material of produced) expect(staged.has(material)).toBe(true);
    for (const mesh of meshesUnder(buildMoonwingStandIn())) {
      expect((mesh as THREE.Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh).not.toBe(true);
      expect((mesh as THREE.Mesh & { isInstancedMesh?: boolean }).isInstancedMesh).not.toBe(true);
    }
  });

  it('tag the stand-in meshes for the boot texture upload, never the live pieces', () => {
    const meshes = meshesUnder(buildMoonwingStandIn());
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) expect(mesh.userData.renderCategory).toBe('vfx');
    const { model } = rig();
    new MoonwingAdornment(model, true);
    for (const mesh of meshesUnder(model)) expect(mesh.userData.renderCategory).toBeUndefined();
  });

  it('mark every kit material, map and geometry shared, and name the glow materials', () => {
    const { model } = rig();
    new MoonwingAdornment(model, true);
    for (const mesh of meshesUnder(model)) {
      expect(isSharedGeometry(mesh.geometry)).toBe(true);
      const material = mesh.material as THREE.MeshBasicMaterial;
      expect(isSharedMaterial(material)).toBe(true);
      if (material.isMeshBasicMaterial) {
        expect(material.name).toMatch(/^moonwing_adornment:/);
        expect(isSharedTexture(material.map as THREE.Texture)).toBe(true);
      }
    }
  });

  it('give the crescent the shared unlit glow program recipe', () => {
    const glow = moonwingMaterials().filter(
      (material): material is THREE.MeshBasicMaterial =>
        (material as THREE.MeshBasicMaterial).isMeshBasicMaterial === true,
    );
    expect(glow.length).toBe(1);
    for (const material of glow) {
      expect(material.map).not.toBeNull();
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.side).toBe(THREE.DoubleSide);
      expect(material.fog).toBe(false);
    }
  });
});
