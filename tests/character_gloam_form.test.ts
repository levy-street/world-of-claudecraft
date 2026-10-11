// @vitest-environment happy-dom
// The CharacterVisual wiring of Gloamveil (the Shadow priest's form, driven by
// the `setShadowform` edge the renderer forwards every frame). Pins, on the
// REAL CharacterVisual over a mocked loader (the character_halo.test.ts rig):
//  - the form shows on the frame of the shift, gate or no gate: with a gate
//    still linking, the rig wears program-free stand-ins, and swaps to the
//    transparent set on the per-frame path once the gate settles;
//  - neither set costs a program the body does not already own;
//  - the entry is reported once, only for a shift seen happening, and never
//    under a ghost body or for a viewer who asked for reduced motion;
//  - every clone goes with the form, a re-skin and the rig.
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  GLOAM_CUE_ENTER,
  GLOAM_CUE_HIDDEN,
  GLOAM_CUE_PRESENT,
  GLOAM_CUE_REST,
  GLOAM_CUE_STILL,
} from '../src/render/characters/gloam_climb_core';
import { failWocHeads, landWocBodies } from './helpers/woc_streamed';

type Visual = import('../src/render/characters/visual').CharacterVisual;
type Gate = import('../src/render/characters/visual').FarBakeGate;
let CharacterVisual: typeof import('../src/render/characters/visual').CharacterVisual;
let hasGloamClimb: typeof import('../src/render/characters/gloam_climb').hasGloamClimb;

function stubGltf() {
  const scene = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
  body.name = 'body';
  scene.add(body);
  const chest = new THREE.Bone();
  chest.name = 'chest';
  const head = new THREE.Bone();
  head.name = 'head';
  head.position.set(0, 2, 0);
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
  // The priest is a WOC body: its base and clip library stream on demand, so
  // land them through the stub loader, and end the head wait the stub rig
  // (which can hang no head) would otherwise hold its draw for.
  failWocHeads(await import('../src/render/characters/woc_head_packs'));
  await landWocBodies(assets, ['player_priest']);
  ({ CharacterVisual } = await import('../src/render/characters/visual'));
  ({ hasGloamClimb } = await import('../src/render/characters/gloam_climb'));
});

afterAll(() => {
  vi.doUnmock('../src/render/assets/loader');
  vi.resetModules();
});

function idleState(swimming = false): Parameters<Visual['update']>[1] {
  return {
    moving: false,
    running: false,
    airborne: false,
    casting: false,
    swimming,
    dead: false,
  } as unknown as Parameters<Visual['update']>[1];
}

/** The material every mesh of the rig's effect cycle is drawing with right
 *  now (the cycle's own mesh list: the body, the halo, whatever the rig hung;
 *  never the hidden compile scratch set or a shadow stand-in). */
function mounted(visual: Visual): THREE.Material[] {
  const cycle = (visual as unknown as { originalMaterials: Map<THREE.Mesh, unknown> })
    .originalMaterials;
  const out: THREE.Material[] = [];
  for (const mesh of cycle.keys()) {
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) out.push(m);
  }
  return out;
}

const inForm = (material: THREE.Material): boolean =>
  material.userData.wocCharacterEffect === 'shadowform';

/** A gate that records what it was handed and settles only when told. */
function heldGate(): { gate: Gate; staged: THREE.Object3D[]; settle(): void } {
  const staged: THREE.Object3D[] = [];
  const pending: (() => void)[] = [];
  return {
    staged,
    gate: (target, settle) => {
      staged.push(target);
      pending.push(() => settle());
    },
    settle: () => {
      for (const done of pending.splice(0)) done();
    },
  };
}

describe('CharacterVisual in Gloamveil', () => {
  it('builds its rig materials with the dormant climb, so the form has programs to reuse', () => {
    const visual = new CharacterVisual('player_priest', 0xffffff, 0);
    const lit = mounted(visual).filter(
      (m) => (m as THREE.MeshStandardMaterial).isMeshStandardMaterial,
    );
    expect(lit.length).toBeGreaterThan(0);
    for (const material of lit) expect(hasGloamClimb(material)).toBe(true);
    visual.dispose();
  });

  it('mounts the settled form at once where nothing links asynchronously', () => {
    const visual = new CharacterVisual('player_priest', 0xffffff, 0);
    const originals = mounted(visual);
    expect(originals.length).toBeGreaterThan(0);
    visual.setShadowform(true);
    const form = mounted(visual);
    expect(form.length).toBe(originals.length);
    for (let i = 0; i < form.length; i++) {
      expect(inForm(form[i])).toBe(true);
      expect(form[i]).not.toBe(originals[i]);
      expect(form[i].transparent).toBe(true);
      // The transparent variant of the SAME hook chain: the one the ghost run
      // and stealth link, nothing of the form's own.
      expect(form[i].customProgramCacheKey()).toBe(originals[i].customProgramCacheKey());
    }
    visual.setShadowform(false);
    expect(mounted(visual)).toEqual(originals);
    visual.dispose();
  });

  it('shows the form on the frame of the shift while the transparent set is still linking', () => {
    const visual = new CharacterVisual('player_priest', 0xffffff, 0);
    const held = heldGate();
    visual.setFarBakeGate(held.gate);
    const originals = mounted(visual);
    const opaque = originals.map((m) => m.transparent);
    visual.setShadowform(true);
    // The gate holds the transparent clones on a hidden scratch set...
    expect(held.staged.length).toBe(1);
    expect(held.staged[0].visible).toBe(false);
    // ...and the body already reads as the form, on clones that flip nothing:
    // same pass, same program key as the materials it was drawing a frame ago.
    const standIns = mounted(visual);
    for (let i = 0; i < standIns.length; i++) {
      expect(inForm(standIns[i])).toBe(true);
      expect(standIns[i]).not.toBe(originals[i]);
      expect(standIns[i].transparent).toBe(opaque[i]);
      expect(standIns[i].customProgramCacheKey()).toBe(originals[i].customProgramCacheKey());
    }
    // Still the stand-ins for as long as the gate holds, however many frames.
    for (let i = 0; i < 5; i++) visual.update(1 / 60, idleState(), true, false);
    expect(mounted(visual)).toEqual(standIns);
    // The settle only flags; the swap lands on the per-frame path.
    held.settle();
    expect(mounted(visual)).toEqual(standIns);
    visual.update(1 / 60, idleState(), true, false);
    const settled = mounted(visual);
    for (let i = 0; i < settled.length; i++) {
      expect(inForm(settled[i])).toBe(true);
      expect(settled[i]).not.toBe(standIns[i]);
      expect(settled[i].transparent).toBe(true);
    }
    // Linked once: the next shift goes straight to the settled set.
    visual.setShadowform(false);
    expect(mounted(visual)).toEqual(originals);
    visual.setShadowform(true);
    expect(mounted(visual)).toEqual(settled);
    expect(held.staged.length).toBe(1);
    visual.dispose();
  });

  it('never mounts an unlinked clone when another effect outranks the form', () => {
    const visual = new CharacterVisual('player_priest', 0xffffff, 0);
    const held = heldGate();
    visual.setFarBakeGate(held.gate);
    const originals = mounted(visual);
    // A ghost body wins over the form, and its clones are still linking: the
    // rig must keep its linked materials, not take the form's stand-in arm.
    visual.setGhost(true);
    visual.setShadowform(true);
    expect(mounted(visual)).toEqual(originals);
    held.settle();
    visual.update(1 / 60, idleState(), true, false);
    for (const material of mounted(visual)) {
      expect(material.userData.wocCharacterEffect).toBe('spirit');
    }
    visual.dispose();
  });

  it('reports the entry once, for a shift seen happening', () => {
    const visual = new CharacterVisual('player_priest', 0xffffff, 0);
    expect(visual.gloamCue()).toBe(GLOAM_CUE_HIDDEN);
    // The rig has drawn out of the form: this shift is seen.
    visual.update(1 / 60, idleState(), true, false);
    visual.setShadowform(true);
    expect(visual.gloamCue()).toBe(GLOAM_CUE_ENTER);
    expect(visual.gloamCue()).toBe(GLOAM_CUE_PRESENT);
    visual.update(1 / 60, idleState(), true, false);
    expect(visual.gloamCue()).toBe(GLOAM_CUE_PRESENT);
    // Out and back in: a new shift, a new entry.
    visual.setShadowform(false);
    expect(visual.gloamCue()).toBe(GLOAM_CUE_HIDDEN);
    visual.setShadowform(true);
    expect(visual.gloamCue()).toBe(GLOAM_CUE_ENTER);
    visual.dispose();
  });

  it('plays no entry for a rig that comes into view already in the form', () => {
    const visual = new CharacterVisual('player_priest', 0xffffff, 0);
    visual.setShadowform(true);
    expect(visual.gloamCue()).toBe(GLOAM_CUE_PRESENT);
    visual.dispose();
  });

  it('hides the floor and smoke cue under a ghost or stealth body', () => {
    const visual = new CharacterVisual('player_priest', 0xffffff, 0);
    visual.update(1 / 60, idleState(), true, false);
    visual.setShadowform(true);
    visual.gloamCue();
    for (const style of ['stealth', 'spirit'] as const) {
      visual.setGhost(true, style);
      expect(visual.gloamCue()).toBe(GLOAM_CUE_HIDDEN);
      visual.setGhost(false);
      expect(visual.gloamCue()).toBe(GLOAM_CUE_PRESENT);
    }
    visual.dispose();
  });

  it('wears the opaque stand-ins while it swims, so the water draws over it', () => {
    const visual = new CharacterVisual('player_priest', 0xffffff, 0);
    // Let the rig settle first: its first frames can re-dress it, and a
    // re-dress re-derives every clone from the new materials.
    for (let i = 0; i < 3; i++) visual.update(1 / 60, idleState(), true, false);
    const originals = mounted(visual);
    visual.setShadowform(true);
    const settled = mounted(visual);
    expect(settled.every((m) => m.transparent)).toBe(true);
    // Into the water: same look, same programs as out of the form, opaque pass.
    visual.update(1 / 60, idleState(true), true, false);
    const swimming = mounted(visual);
    for (let i = 0; i < swimming.length; i++) {
      expect(inForm(swimming[i])).toBe(true);
      expect(swimming[i].transparent).toBe(originals[i].transparent);
      expect(swimming[i].customProgramCacheKey()).toBe(originals[i].customProgramCacheKey());
    }
    // It stays that way while swimming, and comes back out on the settled set.
    visual.update(1 / 60, idleState(true), true, false);
    expect(mounted(visual)).toEqual(swimming);
    visual.update(1 / 60, idleState(false), true, false);
    expect(mounted(visual)).toEqual(settled);
    // The floor layer rests while it swims (no floor to stain) and resumes ashore.
    visual.update(1 / 60, idleState(true), true, false);
    expect(visual.gloamCue()).toBe(GLOAM_CUE_REST);
    visual.update(1 / 60, idleState(false), true, false);
    expect(visual.gloamCue()).toBe(GLOAM_CUE_PRESENT);
    // A shift made in the water starts on the stand-ins too.
    visual.setShadowform(false);
    visual.setShadowform(true);
    visual.update(1 / 60, idleState(true), true, false);
    expect(mounted(visual)).toEqual(swimming);
    visual.dispose();
  });

  it('never stages a link for a swimming body, whatever the gate holds', () => {
    const visual = new CharacterVisual('player_priest', 0xffffff, 0);
    for (let i = 0; i < 3; i++) visual.update(1 / 60, idleState(), true, false);
    const held = heldGate();
    visual.setFarBakeGate(held.gate);
    visual.setShadowform(true);
    expect(held.staged.length).toBe(1);
    visual.update(1 / 60, idleState(true), true, false);
    // Nothing new was handed to the gate for the water.
    expect(held.staged.length).toBe(1);
    for (const material of mounted(visual)) {
      expect(inForm(material)).toBe(true);
    }
    // The settle that was pending when it dived does not pull it out of the stand-ins.
    held.settle();
    visual.update(1 / 60, idleState(true), true, false);
    expect(mounted(visual).some((m) => m.transparent && m.type !== 'MeshBasicMaterial')).toBe(
      false,
    );
    visual.dispose();
  });

  it('asks the floor layer for the still read under reduced motion, and plays no entry', () => {
    const visual = new CharacterVisual('player_priest', 0xffffff, 0);
    visual.update(1 / 60, idleState(), true, true);
    // The renderer's order within one frame: the form edge, the rig's update
    // (which carries the viewer's setting), then the cue for the floor layer.
    visual.setShadowform(true);
    visual.update(1 / 60, idleState(), true, true);
    expect(visual.gloamCue()).toBe(GLOAM_CUE_STILL);
    visual.update(1 / 60, idleState(), true, true);
    expect(visual.gloamCue()).toBe(GLOAM_CUE_STILL);
    // The dark is simply there, at rest: no whole-body beat.
    const look = (visual as unknown as { gloam: { look: { state: { value: THREE.Vector2 } } } })
      .gloam.look;
    expect(look.state.value.x).toBe(0);
    // Setting off again: the form is present, and the missed entry is not replayed.
    visual.update(1 / 60, idleState(), true, false);
    expect(visual.gloamCue()).toBe(GLOAM_CUE_PRESENT);
    visual.dispose();
  });

  it('disposes the stand-ins and the settled clones with the rig', () => {
    const visual = new CharacterVisual('player_priest', 0xffffff, 0);
    const held = heldGate();
    visual.setFarBakeGate(held.gate);
    visual.setShadowform(true);
    const standIns = mounted(visual);
    held.settle();
    visual.update(1 / 60, idleState(), true, false);
    const settled = mounted(visual);
    const disposed = new Set<THREE.Material>();
    for (const material of [...standIns, ...settled]) {
      material.addEventListener('dispose', () => disposed.add(material));
    }
    visual.dispose();
    expect(disposed.size).toBe(new Set([...standIns, ...settled]).size);
  });

  it('pays nothing on a rig that never takes the form', () => {
    const visual = new CharacterVisual('player_priest', 0xffffff, 0);
    visual.update(1 / 60, idleState(), true, false);
    expect((visual as unknown as { gloam: unknown }).gloam).toBeNull();
    visual.dispose();
  });
});
