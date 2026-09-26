// The THREE half of the shapeshift form adornments: Moonwing Form's antlers,
// crescent and wings (moonwing_adornment.ts), Gloamveil's veil
// (gloamveil_veil.ts), and the per-rig owner CharacterVisual holds
// (form_adornments.ts). Driven on a bare synthetic rig (a `chest` bone with a
// `head` child, the KayKit names every player rig carries), so each pin reads
// the real painters without loading a GLB.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createMoonwingPose,
  MOONWING_UNFURL_SECONDS,
} from '../src/render/characters/form_adornment_core';
import { FormAdornments } from '../src/render/characters/form_adornments';
import {
  buildGloamveilStandIn,
  GloamveilVeil,
  gloamveilMaterials,
  VEIL_EYES,
} from '../src/render/characters/gloamveil_veil';
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

describe('GloamveilVeil', () => {
  it('veils the face with a shell and two mirrored eyes in front of it', () => {
    const { model, head } = rig();
    const veil = new GloamveilVeil(model);
    expect(veil.root?.parent).toBe(head);
    expect(names(head)).toEqual(['gloamveil_eye_left', 'gloamveil_eye_right', 'gloamveil_shell']);
    const left = head.getObjectByName('gloamveil_eye_left') as THREE.Mesh;
    const right = head.getObjectByName('gloamveil_eye_right') as THREE.Mesh;
    expect(left.position.x).toBeCloseTo(-right.position.x, 6);
    expect(right.position.z).toBe(VEIL_EYES.z);
    const shell = head.getObjectByName('gloamveil_shell') as THREE.Mesh;
    shell.geometry.computeBoundingBox();
    const box = shell.geometry.boundingBox as THREE.Box3;
    // The shell covers the FRONT of the head (+Z), and the eyes sit on it.
    expect(box.max.z).toBeGreaterThan(0.53);
    expect(box.min.z).toBeGreaterThan(-0.3);
    expect(right.position.z).toBeGreaterThanOrEqual(box.max.z - 0.01);
    // The additive eyes draw after the gloom.
    expect(left.renderOrder).toBeGreaterThan(shell.renderOrder);
    for (const mesh of meshesUnder(head)) {
      expect(mesh.userData.weaponVfxMesh).toBe(true);
      expect(mesh.castShadow).toBe(false);
    }
    veil.apply(0.9);
    expect(left.scale.x).toBeCloseTo(0.9, 6);
    expect(right.scale.y).toBeCloseTo(0.9, 6);
    veil.dispose();
    expect(meshesUnder(model)).toEqual([]);
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
    if (
      /^(moonwing|gloamveil)_(head|wing_left|wing_right|veil)$/.test(object.name) &&
      object.visible
    )
      out.push(object.name);
  });
  return out.sort();
}

describe('FormAdornments (the per-rig owner)', () => {
  it('mounts and unmounts each form set on its edge, idempotently', () => {
    const { model, head } = rig();
    const owner = new FormAdornments(model, 'composed', noGate);
    owner.sync(true, false, false);
    expect(head.getObjectByName('moonwing_antlers')).toBeDefined();
    const antlers = head.getObjectByName('moonwing_antlers');
    owner.sync(true, false, false);
    expect(meshesUnder(model).length).toBe(5);
    expect(head.getObjectByName('moonwing_antlers')).toBe(antlers);
    owner.sync(false, false, false);
    expect(meshesUnder(model)).toEqual([]);
    owner.sync(false, true, false);
    expect(names(model)).toEqual(['gloamveil_eye_left', 'gloamveil_eye_right', 'gloamveil_shell']);
    owner.sync(false, false, false);
    expect(meshesUnder(model)).toEqual([]);
  });

  it('grows antlers only on a composed body, and veils no replacement body', () => {
    const fixed = rig();
    new FormAdornments(fixed.model, 'classRig', noGate).sync(true, false, false);
    expect(fixed.head.getObjectByName('moonwing_antlers')).toBeUndefined();
    expect(fixed.head.getObjectByName('moonwing_crescent')).toBeDefined();
    const mech = rig();
    const owner = new FormAdornments(mech.model, 'replacement', noGate);
    owner.sync(false, true, false);
    expect(meshesUnder(mech.model)).toEqual([]);
    owner.sync(true, false, false);
    expect(names(mech.model)).toEqual([
      'moonwing_crescent',
      'moonwing_wing_left_feathers',
      'moonwing_wing_right_feathers',
    ]);
  });

  it('unfurls the wings over time only while the rig is shown', () => {
    const { model, chest } = rig();
    const owner = new FormAdornments(model, 'composed', noGate);
    owner.sync(true, false, false);
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
    owner.sync(true, false, false);
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
    owner.sync(true, false, false);
    owner.update(5, false, false, false, true);
    owner.sync(false, false, false);
    owner.sync(true, false, false);
    const wing = chest.getObjectByName('moonwing_wing_right') as THREE.Object3D;
    const reshift = wing.rotation.y;
    owner.update(5, false, false, false, true);
    expect(wing.rotation.y).toBeLessThan(reshift);
  });

  it('holds a first mount hidden behind the gate and reveals it on the frame path', () => {
    const { model, chest } = rig();
    const recorder = recordingGate();
    const owner = new FormAdornments(model, 'composed', () => recorder.gate);
    owner.sync(true, false, false);
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
    owner.sync(false, false, false);
    owner.sync(true, false, false);
    expect(recorder.targets.length).toBe(3);
    expect(shownRoots(model).length).toBe(3);
  });

  it('never reveals a set dropped while its gate was in flight', () => {
    const { model } = rig();
    const recorder = recordingGate();
    const owner = new FormAdornments(model, 'classRig', () => recorder.gate);
    owner.sync(false, true, false);
    owner.sync(false, false, false);
    recorder.settleAll();
    owner.update(0.01, false, false, false, true);
    expect(meshesUnder(model)).toEqual([]);
    // The dropped set never proved a link, so the next shift is held again.
    owner.sync(false, true, false);
    expect(recorder.targets.length).toBe(2);
    expect(shownRoots(model)).toEqual([]);
  });

  it('hides the pieces while the body is a ghost and restores them after', () => {
    const { model } = rig();
    const owner = new FormAdornments(model, 'composed', noGate);
    owner.sync(true, false, false);
    expect(shownRoots(model).length).toBe(3);
    owner.sync(true, false, true);
    expect(shownRoots(model)).toEqual([]);
    owner.sync(true, false, false);
    expect(shownRoots(model).length).toBe(3);
    // A set mounted while ghosted starts hidden too.
    owner.sync(true, true, true);
    expect(shownRoots(model)).toEqual([]);
    owner.sync(true, true, false);
    expect(shownRoots(model)).toContain('gloamveil_veil');
  });

  it('is inert after dispose: a late edge mounts nothing', () => {
    const { model } = rig();
    const owner = new FormAdornments(model, 'composed', noGate);
    owner.sync(true, false, false);
    owner.dispose();
    owner.sync(true, true, false);
    owner.update(1, false, false, false, true);
    expect(meshesUnder(model)).toEqual([]);
  });
});

describe('prewarm stand-ins', () => {
  it('stage every material each kit can hand a live rig, on plain meshes', () => {
    for (const [build, materials] of [
      [buildMoonwingStandIn, moonwingMaterials],
      [buildGloamveilStandIn, gloamveilMaterials],
    ] as const) {
      const staged = new Set(meshesUnder(build()).map((mesh) => mesh.material));
      const produced = materials();
      expect(produced.length).toBeGreaterThan(0);
      for (const material of produced) expect(staged.has(material)).toBe(true);
      for (const mesh of meshesUnder(build())) {
        expect((mesh as THREE.Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh).not.toBe(true);
        expect((mesh as THREE.Mesh & { isInstancedMesh?: boolean }).isInstancedMesh).not.toBe(true);
      }
    }
  });

  it('tag the stand-in meshes for the boot texture upload, never the live pieces', () => {
    for (const build of [buildMoonwingStandIn, buildGloamveilStandIn]) {
      const meshes = meshesUnder(build());
      expect(meshes.length).toBeGreaterThan(0);
      for (const mesh of meshes) expect(mesh.userData.renderCategory).toBe('vfx');
    }
    const { model } = rig();
    new MoonwingAdornment(model, true);
    new GloamveilVeil(model);
    for (const mesh of meshesUnder(model)) expect(mesh.userData.renderCategory).toBeUndefined();
  });

  it('mark every kit material, map and geometry shared, and name the glow materials', () => {
    const { model } = rig();
    new MoonwingAdornment(model, true);
    new GloamveilVeil(model);
    for (const mesh of meshesUnder(model)) {
      expect(isSharedGeometry(mesh.geometry)).toBe(true);
      const material = mesh.material as THREE.MeshBasicMaterial;
      expect(isSharedMaterial(material)).toBe(true);
      if (material.isMeshBasicMaterial) {
        expect(material.name).toMatch(/^(moonwing_adornment|gloamveil_veil):/);
        expect(isSharedTexture(material.map as THREE.Texture)).toBe(true);
      }
    }
  });

  it('share one unlit glow program recipe across the wings, crescent, veil and eyes', () => {
    const glow = [...moonwingMaterials(), ...gloamveilMaterials()].filter(
      (material): material is THREE.MeshBasicMaterial =>
        (material as THREE.MeshBasicMaterial).isMeshBasicMaterial === true,
    );
    expect(glow.length).toBe(4);
    for (const material of glow) {
      expect(material.map).not.toBeNull();
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.side).toBe(THREE.DoubleSide);
      expect(material.fog).toBe(false);
    }
  });
});
