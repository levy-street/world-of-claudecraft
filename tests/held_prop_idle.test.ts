import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  disposeHeldPropIdles,
  pruneHeldPropIdles,
  registerHeldPropIdle,
  selectHeldPropIdleClip,
  updateHeldPropIdles,
} from '../src/render/characters/held_prop_idle';

// A 2s looping translation clip like the Ignivar legendaries' "Idle": one node
// bobs from y 0 to y 1 and back.
function bobClip(name: string, targetNodeName: string): THREE.AnimationClip {
  const track = new THREE.VectorKeyframeTrack(
    `${targetNodeName}.position`,
    [0, 1, 2],
    [0, 0, 0, 0, 1, 0, 0, 0, 0],
  );
  return new THREE.AnimationClip(name, 2, [track]);
}

function payloadWithPart(root: THREE.Object3D, partName: string): THREE.Object3D {
  const payload = new THREE.Group();
  const part = new THREE.Object3D();
  part.name = partName;
  payload.add(part);
  root.add(payload);
  return payload;
}

describe('selectHeldPropIdleClip', () => {
  it('picks the clip named Idle regardless of case or position', () => {
    expect(selectHeldPropIdleClip(['Walk', 'Idle'])).toBe(1);
    expect(selectHeldPropIdleClip(['idle', 'Walk'])).toBe(0);
    expect(selectHeldPropIdleClip(['Spin', 'IDLE', 'Walk'])).toBe(1);
  });

  it('falls back to the first clip when none is named Idle', () => {
    expect(selectHeldPropIdleClip(['Spin', 'Whirr'])).toBe(0);
  });

  it('returns -1 for an empty clip list', () => {
    expect(selectHeldPropIdleClip([])).toBe(-1);
  });
});

describe('registerHeldPropIdle / updateHeldPropIdles', () => {
  it('drives the payload subtree with the looping idle clip', () => {
    const root = new THREE.Group();
    const payload = payloadWithPart(root, 'engine');
    registerHeldPropIdle(root, payload, [bobClip('Idle', 'engine')]);
    updateHeldPropIdles(root, 1); // mid-clip: the bob peak
    const part = payload.getObjectByName('engine');
    expect(part?.position.y).toBeCloseTo(1, 5);
    // Past the clip end: LoopRepeat wraps instead of clamping at the last key.
    updateHeldPropIdles(root, 1.5); // t = 2.5 -> wrapped 0.5 -> y 0.5
    expect(part?.position.y).toBeCloseTo(0.5, 5);
  });

  it('binds each payload to its own clips even when node names collide', () => {
    // Both Tripo drops ship tripo_part_N node names; per-payload mixers must
    // keep each clip on its own payload. The SECOND-added payload is the
    // decisive direction: a shared root mixer would bind its clip onto the
    // FIRST payload's same-named node (PropertyBinding takes the first match),
    // which this would catch; the first-payload direction alone would not.
    const root = new THREE.Group();
    const hammer = payloadWithPart(root, 'tripo_part_3');
    const shield = payloadWithPart(root, 'tripo_part_3');
    registerHeldPropIdle(root, shield, [bobClip('Idle', 'tripo_part_3')]);
    updateHeldPropIdles(root, 1);
    expect(shield.getObjectByName('tripo_part_3')?.position.y).toBeCloseTo(1, 5);
    expect(hammer.getObjectByName('tripo_part_3')?.position.y).toBe(0);
    // And the other direction, so no insertion order hides a regression.
    const root2 = new THREE.Group();
    const first = payloadWithPart(root2, 'tripo_part_3');
    const second = payloadWithPart(root2, 'tripo_part_3');
    registerHeldPropIdle(root2, first, [bobClip('Idle', 'tripo_part_3')]);
    updateHeldPropIdles(root2, 1);
    expect(first.getObjectByName('tripo_part_3')?.position.y).toBeCloseTo(1, 5);
    expect(second.getObjectByName('tripo_part_3')?.position.y).toBe(0);
  });

  it('registers nothing for a clipless (static) weapon', () => {
    const root = new THREE.Group();
    const payload = payloadWithPart(root, 'blade');
    registerHeldPropIdle(root, payload, []);
    updateHeldPropIdles(root, 1);
    expect(payload.getObjectByName('blade')?.position.y).toBe(0);
    // No entry (and so no mixer) was allocated at all: the common static
    // weapon path stays one length check.
    expect((root.userData.heldPropIdleEntries as unknown[] | undefined) ?? []).toHaveLength(0);
  });

  it('prunes an entry once its payload is detached (the swap/stow removeFromParent)', () => {
    const root = new THREE.Group();
    const payload = payloadWithPart(root, 'engine');
    registerHeldPropIdle(root, payload, [bobClip('Idle', 'engine')]);
    updateHeldPropIdles(root, 0.25);
    payload.removeFromParent();
    updateHeldPropIdles(root, 0.25);
    expect((root.userData.heldPropIdleEntries as unknown[]).length).toBe(0);
    // A detached payload no longer advances.
    const y = payload.getObjectByName('engine')?.position.y ?? -1;
    updateHeldPropIdles(root, 0.25);
    expect(payload.getObjectByName('engine')?.position.y).toBe(y);
  });

  it('pruneHeldPropIdles drops detached entries without advancing the survivors', () => {
    // The replace/stow paths prune at detach time, so a pooled or offscreen
    // visual never holds a stale mixer until its next animated frame.
    const root = new THREE.Group();
    const kept = payloadWithPart(root, 'engine');
    const dropped = payloadWithPart(root, 'gears');
    registerHeldPropIdle(root, kept, [bobClip('Idle', 'engine')]);
    registerHeldPropIdle(root, dropped, [bobClip('Idle', 'gears')]);
    dropped.removeFromParent();
    pruneHeldPropIdles(root);
    expect((root.userData.heldPropIdleEntries as unknown[]).length).toBe(1);
    // Pruning advanced nothing: the surviving idle is still at t=0.
    expect(kept.getObjectByName('engine')?.position.y).toBe(0);
    updateHeldPropIdles(root, 1);
    expect(kept.getObjectByName('engine')?.position.y).toBeCloseTo(1, 5);
  });

  it('releases the mixer (stop + uncache) when pruning a detached payload', () => {
    // The prune/dispose paths exist for leak avoidance, so the release calls
    // themselves are the behavior under test, not just the registry length.
    const stop = vi.spyOn(THREE.AnimationMixer.prototype, 'stopAllAction');
    const uncache = vi.spyOn(THREE.AnimationMixer.prototype, 'uncacheRoot');
    try {
      const root = new THREE.Group();
      const payload = payloadWithPart(root, 'engine');
      registerHeldPropIdle(root, payload, [bobClip('Idle', 'engine')]);
      payload.removeFromParent();
      pruneHeldPropIdles(root);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(uncache).toHaveBeenCalledTimes(1);
      expect(uncache).toHaveBeenCalledWith(payload);
    } finally {
      stop.mockRestore();
      uncache.mockRestore();
    }
  });

  it('disposeHeldPropIdles releases every mixer, attached AND detached, and empties the registry', () => {
    const stop = vi.spyOn(THREE.AnimationMixer.prototype, 'stopAllAction');
    const uncache = vi.spyOn(THREE.AnimationMixer.prototype, 'uncacheRoot');
    try {
      const root = new THREE.Group();
      const attached = payloadWithPart(root, 'engine');
      const detached = payloadWithPart(root, 'gears');
      registerHeldPropIdle(root, attached, [bobClip('Idle', 'engine')]);
      registerHeldPropIdle(root, detached, [bobClip('Idle', 'gears')]);
      updateHeldPropIdles(root, 0.5);
      detached.removeFromParent();
      stop.mockClear();
      uncache.mockClear();
      disposeHeldPropIdles(root);
      expect((root.userData.heldPropIdleEntries as unknown[]).length).toBe(0);
      // BOTH arms released: a dispose implemented as prune-then-clear would
      // release only the detached one.
      expect(uncache).toHaveBeenCalledTimes(2);
      const roots = uncache.mock.calls.map(([r]) => r);
      expect(roots).toEqual(expect.arrayContaining([attached, detached]));
      expect(stop).toHaveBeenCalledTimes(2);
      const y = attached.getObjectByName('engine')?.position.y ?? -1;
      updateHeldPropIdles(root, 0.5);
      expect(attached.getObjectByName('engine')?.position.y).toBe(y);
    } finally {
      stop.mockRestore();
      uncache.mockRestore();
    }
  });
});

describe('engine wiring', () => {
  // The module is proven above in isolation; these pin the integration points
  // that make it visible in game (the same source-scan style
  // tests/back_grips.test.ts uses for the attach tables). Comments are
  // stripped first so a commented-out call cannot satisfy a pin, and the
  // prune calls are located per FUNCTION so moving them all into one place
  // cannot satisfy the count.
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`])\/\/[^\n]*/gm, '$1');
  const read = (rel: string): string =>
    stripComments(
      readFileSync(path.join(__dirname, '..', 'src', 'render', 'characters', rel), 'utf8'),
    );
  const slice = (src: string, marker: string): string => {
    const start = src.indexOf(marker);
    expect(start, marker).toBeGreaterThanOrEqual(0);
    const next = src.indexOf('\nexport function ', start + 1);
    return src.slice(start, next === -1 ? undefined : next);
  };

  it('strips comments without eating live code (matcher control)', () => {
    expect(stripComments('live(); // dead()\n/* dead2() */ live2();')).toContain('live()');
    expect(stripComments('live(); // dead()')).not.toContain('dead()');
    expect(stripComments('/* x */ y')).not.toContain('x');
  });

  it('attachProp registers every animated payload and each replace path prunes', () => {
    const assets = read('assets.ts');
    expect(slice(assets, 'function attachProp')).toMatch(
      /registerHeldPropIdle\(root, payload, gltf\.animations\)/,
    );
    for (const fn of ['setHeldWeapon', 'setHeldOffhand', 'setWeaponsStowed']) {
      const body = slice(assets, `export function ${fn}`);
      const calls = body.match(/pruneHeldPropIdles\(root\);/g) ?? [];
      expect(calls.length, `${fn} prunes after its removeFromParent sweep`).toBe(1);
    }
  });

  it('CharacterVisual pumps the idles inside the far-LOD guard and disposes them', () => {
    const visual = read('visual.ts');
    // The pump must sit INSIDE the farMeshShown gate (like updateWeaponVfx):
    // an ungated pump would integrate mixers for props the far bake hides.
    expect(visual).toMatch(
      /if \(!farMeshShown\(this\.far, this\.farMesh !== null, this\.farCompilePending\)\) \{\s*updateHeldPropIdles\(this\.model, animationDt\);/,
    );
    expect(visual).toMatch(/disposeHeldPropIdles\(this\.model\)/);
    // Positive control: the stripped source still shows a known-live call.
    expect(visual).toMatch(/this\.updateMixer\(animationDt\);/);
  });
});
