// The THREE half of the shapeshift form adornments: Moonwing Form's antlers,
// crescent and wings (moonwing_adornment.ts) and the per-rig owner
// CharacterVisual holds (form_adornments.ts). Gloamveil mounts nothing on a
// rig (its look is a shader layer and a floor layer, tests/gloam_*.test.ts),
// which the owner block below pins. Driven on a bare synthetic rig (a `chest` bone with a
// `head` child, the KayKit names every player rig carries), so each pin reads
// the real painters without loading a GLB.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createMoonwingPose,
  MOONWING_UNFURL_SECONDS,
  MOONWING_WOC_FIT,
} from '../src/render/characters/form_adornment_core';
import { FormAdornments } from '../src/render/characters/form_adornments';
import {
  buildMoonwingStandIn,
  CRESCENT_REST,
  MoonwingAdornment,
  moonwingMaterials,
  WING_ROOT,
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

/** The WOC body's bind pose where the pieces hang (base_male.glb): the rig
 *  root, `chest` at 0.82, `head` at 1.02 through a `neck`, all at unit scale.
 *  The body stands about 1.2 tall, its back plate about 0.12 behind the spine
 *  line and its skull crown at about 1.17. A wrapper node named `chest` (an
 *  armour slot) sits ahead of the skeleton in traversal order. */
const WOC = { chestY: 0.82, headY: 1.02, crownY: 1.17, backZ: -0.12, height: 1.2 } as const;

function wocRig(): { model: THREE.Group; chest: THREE.Bone; head: THREE.Bone } {
  const model = new THREE.Group();
  const slot = new THREE.Group();
  slot.name = 'chest';
  model.add(slot);
  const root = new THREE.Bone();
  root.name = 'root';
  const chest = new THREE.Bone();
  chest.name = 'chest';
  chest.position.set(0, WOC.chestY, -0.005);
  const neck = new THREE.Bone();
  neck.name = 'neck';
  neck.position.set(0, 0.135, 0);
  const head = new THREE.Bone();
  head.name = 'head';
  head.position.set(0, WOC.headY - WOC.chestY - 0.135, 0);
  neck.add(head);
  chest.add(neck);
  root.add(chest);
  model.add(root);
  return { model, chest, head };
}

/** World-space bounds of one named piece, the rig standing at the origin. */
function pieceBox(model: THREE.Object3D, name: string): THREE.Box3 {
  model.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(model.getObjectByName(name) as THREE.Object3D);
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
  it('crowns the head with antlers, wraps and the crescent, and wings the chest', () => {
    const { model, chest, head } = rig();
    const adornment = new MoonwingAdornment(model, true);
    expect(adornment.head?.parent).toBe(head);
    expect(names(head)).toEqual(['moonwing_antler_wraps', 'moonwing_antlers', 'moonwing_crescent']);
    expect(adornment.leftWing?.parent).toBe(chest);
    expect(adornment.rightWing?.parent).toBe(chest);
    // The wings mirror about the spine, rooted on the back (-Z is behind).
    expect(adornment.rightWing?.position.toArray()).toEqual([
      WING_ROOT.x,
      WING_ROOT.y,
      WING_ROOT.z,
    ]);
    expect(adornment.leftWing?.position.toArray()).toEqual([
      -WING_ROOT.x,
      WING_ROOT.y,
      WING_ROOT.z,
    ]);
    expect(WING_ROOT.z).toBeLessThan(0);
    // The antlers rise above the crown, the crescent sits between them.
    const antlers = head.getObjectByName('moonwing_antlers') as THREE.Mesh;
    antlers.geometry.computeBoundingBox();
    const box = antlers.geometry.boundingBox as THREE.Box3;
    expect(box.max.y).toBeGreaterThan(1.2);
    expect(box.min.x).toBeCloseTo(-box.max.x, 5);
    expect(CRESCENT_REST.y).toBeGreaterThan(1);
    expect(CRESCENT_REST.y).toBeLessThan(box.max.y);
  });

  it('hangs the pieces on the bones, never on a wrapper node of the same name', () => {
    const { model, chest, head } = wocRig();
    const adornment = new MoonwingAdornment(model, true, MOONWING_WOC_FIT);
    expect(adornment.leftWing?.parent).toBe(chest);
    expect(adornment.rightWing?.parent).toBe(chest);
    expect(adornment.head?.parent).toBe(head);
  });

  it('wears the wings on the back of a WOC body, at its size', () => {
    const { model, chest } = wocRig();
    const adornment = new MoonwingAdornment(model, true, MOONWING_WOC_FIT);
    adornment.apply({ ...createMoonwingPose(), unfurl: 1 });
    model.updateWorldMatrix(true, true);
    const bone = chest.getWorldPosition(new THREE.Vector3());
    for (const wing of [adornment.leftWing, adornment.rightWing]) {
      const root = (wing as THREE.Group).getWorldPosition(new THREE.Vector3());
      // Behind the chest bone, at the back plate: the KayKit root sat 0.62
      // behind it, five times the depth of the whole WOC torso.
      expect(root.z).toBeLessThan(bone.z);
      expect(root.z).toBeLessThan(WOC.backZ + 0.03);
      expect(root.z).toBeGreaterThan(WOC.backZ - 0.03);
      expect(root.distanceTo(bone)).toBeLessThan(0.2);
      // Between the chest bone and the neck, by the spine.
      expect(root.y).toBeGreaterThan(WOC.chestY);
      expect(root.y).toBeLessThan(WOC.chestY + 0.135);
      expect(Math.abs(root.x)).toBeLessThan(0.1);
    }
    expect(adornment.rightWing?.position.x).toBeCloseTo(-(adornment.leftWing?.position.x ?? 0), 6);
    // An open wing spans about half the body height, not more than all of it
    // (the KayKit plane is 1.2 x 1.08 against a 1.2 body).
    for (const name of ['moonwing_wing_left_feathers', 'moonwing_wing_right_feathers']) {
      const size = pieceBox(model, name).getSize(new THREE.Vector3());
      expect(size.y).toBeGreaterThan(WOC.height * 0.3);
      expect(size.y).toBeLessThan(WOC.height * 0.6);
      expect(Math.hypot(size.x, size.z)).toBeLessThan(WOC.height * 0.65);
    }
  });

  it('crowns a WOC head: antlers rooted in the skull, the crescent just above it', () => {
    const { model } = wocRig();
    const adornment = new MoonwingAdornment(model, true, MOONWING_WOC_FIT);
    adornment.apply({ ...createMoonwingPose(), unfurl: 1 });
    const antlers = pieceBox(model, 'moonwing_antlers');
    // Rooted inside the skull (below its crown, within its 0.11 width at the
    // base is not required of the tines, so check the root height only) and
    // rising a head's height above it, not a body's.
    expect(antlers.min.y).toBeGreaterThan(WOC.headY);
    expect(antlers.min.y).toBeLessThan(WOC.crownY);
    expect(antlers.max.y).toBeGreaterThan(WOC.crownY + 0.05);
    expect(antlers.max.y).toBeLessThan(WOC.crownY + 0.25);
    expect(antlers.max.x).toBeLessThan(0.25);
    const crescent = pieceBox(model, 'moonwing_crescent');
    const centre = crescent.getCenter(new THREE.Vector3());
    // The KayKit rest height put it 1.24 above the head bone: a whole WOC body.
    expect(centre.y).toBeGreaterThan(WOC.crownY);
    expect(centre.y).toBeLessThan(WOC.crownY + 0.2);
    expect(centre.y).toBeLessThan(antlers.max.y);
    expect(crescent.getSize(new THREE.Vector3()).y).toBeLessThan(0.2);
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
    expect(pieces.length).toBe(5);
    for (const mesh of pieces) {
      expect(mesh.userData.weaponVfxMesh).toBe(true);
      expect(mesh.castShadow).toBe(false);
    }
  });

  it('folds, unfurls and beats the wings from the pose, mirrored', () => {
    const { model } = rig();
    const adornment = new MoonwingAdornment(model, true);
    const pose = createMoonwingPose();
    adornment.apply(pose);
    const folded = adornment.rightWing?.rotation.y ?? 0;
    expect(adornment.leftWing?.rotation.y).toBeCloseTo(-folded, 6);
    // Folded: no lift at all.
    expect(adornment.rightWing?.rotation.z).toBe(0);
    adornment.apply({ ...pose, unfurl: 1 });
    const open = adornment.rightWing?.rotation.y ?? 0;
    expect(open).toBeLessThan(folded);
    expect(open).toBeGreaterThan(0);
    const lift = adornment.rightWing?.rotation.z ?? 0;
    expect(lift).toBeGreaterThan(0);
    expect(adornment.leftWing?.rotation.z).toBeCloseTo(-lift, 6);
    adornment.apply({ ...pose, unfurl: 1, beat: 0.05 });
    expect(adornment.rightWing?.rotation.z).toBeCloseTo(lift + 0.05, 6);
    adornment.apply({ ...pose, unfurl: 1, sweep: 0.2 });
    expect(adornment.rightWing?.rotation.y).toBeCloseTo(open + 0.2, 6);
    adornment.apply({ ...pose, unfurl: 1, crescentLift: 0.03 });
    expect(adornment.crescent?.position.y).toBeCloseTo(CRESCENT_REST.y + 0.03, 6);
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
    expect(meshesUnder(b.model).length).toBe(5);
  });

  it('skips pieces a rig has no bone for instead of throwing', () => {
    const bare = new THREE.Group();
    const adornment = new MoonwingAdornment(bare, true);
    adornment.apply({ ...createMoonwingPose(), unfurl: 1 });
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
    if (/^moonwing_(head|wing_left|wing_right)$/.test(object.name) && object.visible) {
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
    expect(meshesUnder(model).length).toBe(5);
    expect(head.getObjectByName('moonwing_antlers')).toBe(antlers);
    owner.sync(false, false);
    expect(meshesUnder(model)).toEqual([]);
  });

  it('fits the set to a WOC body and crowns its bare head', () => {
    const { model, chest, head } = wocRig();
    new FormAdornments(model, 'woc', noGate).sync(true, false);
    expect(head.getObjectByName('moonwing_antlers')).toBeDefined();
    const wing = chest.getObjectByName('moonwing_wing_right') as THREE.Object3D;
    expect(wing.position.toArray()).toEqual([
      MOONWING_WOC_FIT.wing.x,
      MOONWING_WOC_FIT.wing.y,
      MOONWING_WOC_FIT.wing.z,
    ]);
    expect(wing.scale.x).toBe(MOONWING_WOC_FIT.wing.scale);
    expect(head.getObjectByName('moonwing_head')?.scale.x).toBe(MOONWING_WOC_FIT.head.scale);
  });

  it('keeps the KayKit placement at full size on a KayKit body', () => {
    const { model, chest, head } = rig();
    new FormAdornments(model, 'composed', noGate).sync(true, false);
    const wing = chest.getObjectByName('moonwing_wing_right') as THREE.Object3D;
    expect(wing.position.toArray()).toEqual([WING_ROOT.x, WING_ROOT.y, WING_ROOT.z]);
    expect(wing.scale.toArray()).toEqual([1, 1, 1]);
    const crown = head.getObjectByName('moonwing_head') as THREE.Object3D;
    expect(crown.position.toArray()).toEqual([0, 0, 0]);
    expect(crown.scale.toArray()).toEqual([1, 1, 1]);
  });

  it('grows antlers only on a composed body', () => {
    const fixed = rig();
    new FormAdornments(fixed.model, 'classRig', noGate).sync(true, false);
    expect(fixed.head.getObjectByName('moonwing_antlers')).toBeUndefined();
    expect(fixed.head.getObjectByName('moonwing_crescent')).toBeDefined();
    const mech = rig();
    const owner = new FormAdornments(mech.model, 'replacement', noGate);
    owner.sync(true, false);
    expect(names(mech.model)).toEqual([
      'moonwing_crescent',
      'moonwing_wing_left_feathers',
      'moonwing_wing_right_feathers',
    ]);
  });

  it('unfurls the wings over time only while the rig is shown', () => {
    const { model, chest } = rig();
    const owner = new FormAdornments(model, 'composed', noGate);
    owner.sync(true, false);
    const wing = chest.getObjectByName('moonwing_wing_right') as THREE.Object3D;
    const folded = wing.rotation.y;
    // Hidden (culled or far LOD): no pose work, the clock holds.
    owner.update(MOONWING_UNFURL_SECONDS * 2, false, false, false, false);
    expect(wing.rotation.y).toBe(folded);
    owner.update(MOONWING_UNFURL_SECONDS * 2, false, false, false, true);
    expect(wing.rotation.y).toBeLessThan(folded);
    owner.dispose();
    expect(meshesUnder(model)).toEqual([]);
  });

  it('shows the open wings at once under reduced motion', () => {
    const { model, chest } = rig();
    const owner = new FormAdornments(model, 'composed', noGate);
    owner.sync(true, false);
    const wing = chest.getObjectByName('moonwing_wing_right') as THREE.Object3D;
    const folded = wing.rotation.y;
    owner.update(0.001, false, false, true, true);
    const open = wing.rotation.y;
    expect(open).toBeLessThan(folded);
    owner.update(5, false, false, true, true);
    expect(wing.rotation.y).toBe(open);
  });

  it('re-arms the unfurl on every new shift', () => {
    const { model, chest } = rig();
    const owner = new FormAdornments(model, 'composed', noGate);
    owner.sync(true, false);
    owner.update(5, false, false, false, true);
    owner.sync(false, false);
    owner.sync(true, false);
    const wing = chest.getObjectByName('moonwing_wing_right') as THREE.Object3D;
    const reshift = wing.rotation.y;
    owner.update(5, false, false, false, true);
    expect(wing.rotation.y).toBeLessThan(reshift);
  });

  it('holds a first mount hidden behind the gate and reveals it on the frame path', () => {
    const { model, chest } = rig();
    const recorder = recordingGate();
    const owner = new FormAdornments(model, 'composed', () => recorder.gate);
    owner.sync(true, false);
    // Every root this set parented into the rig went through the gate, hidden.
    expect(recorder.targets.map((target) => target.name).sort()).toEqual([
      'moonwing_head',
      'moonwing_wing_left',
      'moonwing_wing_right',
    ]);
    expect(shownRoots(model)).toEqual([]);
    // Held pieces do not unfurl off screen: the wings unfurl once they show.
    const wing = chest.getObjectByName('moonwing_wing_right') as THREE.Object3D;
    const folded = wing.rotation.y;
    owner.update(MOONWING_UNFURL_SECONDS * 2, false, false, false, true);
    expect(wing.rotation.y).toBe(folded);
    recorder.settleAll();
    // The settle only flags; the reveal waits for the per-frame update.
    expect(shownRoots(model)).toEqual([]);
    owner.update(0.01, false, false, false, true);
    expect(shownRoots(model)).toEqual([
      'moonwing_head',
      'moonwing_wing_left',
      'moonwing_wing_right',
    ]);
    // Revealed folded: the unfurl clock only starts once the wings show.
    expect(wing.rotation.y).toBeGreaterThan(1);
    // Linked once on this rig: the next shift shows at once, no second hold.
    owner.sync(false, false);
    owner.sync(true, false);
    expect(recorder.targets.length).toBe(3);
    expect(shownRoots(model).length).toBe(3);
  });

  it('never reveals a set dropped while its gate was in flight', () => {
    const { model } = rig();
    const recorder = recordingGate();
    const owner = new FormAdornments(model, 'classRig', () => recorder.gate);
    owner.sync(true, false);
    const firstMount = recorder.targets.length;
    expect(firstMount).toBe(3);
    owner.sync(false, false);
    recorder.settleAll();
    owner.update(0.01, false, false, false, true);
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
    expect(shownRoots(model).length).toBe(3);
    owner.sync(true, true);
    expect(shownRoots(model)).toEqual([]);
    owner.sync(true, false);
    expect(shownRoots(model).length).toBe(3);
    // A set mounted while ghosted starts hidden too.
    owner.sync(false, true);
    owner.sync(true, true);
    expect(meshesUnder(model).length).toBe(5);
    expect(shownRoots(model)).toEqual([]);
    owner.sync(true, false);
    expect(shownRoots(model).length).toBe(3);
  });

  it('is inert after dispose: a late edge mounts nothing', () => {
    const { model } = rig();
    const owner = new FormAdornments(model, 'composed', noGate);
    owner.sync(true, false);
    owner.dispose();
    owner.sync(true, false);
    owner.update(1, false, false, false, true);
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

  it('share one unlit glow program recipe across the wings and the crescent', () => {
    const glow = moonwingMaterials().filter(
      (material): material is THREE.MeshBasicMaterial =>
        (material as THREE.MeshBasicMaterial).isMeshBasicMaterial === true,
    );
    expect(glow.length).toBe(2);
    for (const material of glow) {
      expect(material.map).not.toBeNull();
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.side).toBe(THREE.DoubleSide);
      expect(material.fog).toBe(false);
    }
  });
});
