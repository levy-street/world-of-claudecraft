import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/characters', async () => {
  const MockThree = await import('three');
  return {
    createMountVisual: () => ({
      root: new MockThree.Group(),
      dispose: () => {},
    }),
  };
});

vi.mock('../src/render/characters/assets', () => ({
  mountAssetsReady: () => true,
  preloadMountAssets: () => Promise.resolve(),
}));

vi.mock('../src/render/mount_glow', () => ({
  attachMountGlows: vi.fn(() => null),
  disposeMountGlows: vi.fn(),
}));

import type { CharacterVisual } from '../src/render/characters';
import { attachMountGlows, disposeMountGlows, type MountGlows } from '../src/render/mount_glow';
import {
  disposeMountView,
  gateMountSwapOnCompile,
  type MountViewState,
  placeRider,
  seatRiderOnBone,
  syncMountTransitionFx,
  syncMountVisual,
} from '../src/render/mount_lifecycle';
import { type MountVisualSpec, mountVisualSpec } from '../src/render/mount_visuals';
import { MOUNT_KEYS } from '../src/sim/content/mounts';

// The rider seat rule of src/render/mount_lifecycle.ts, driven on bare
// three.js objects: a moving seat (a mount with a seatBone) puts the rider on
// the bone, and the fixed-lift fallback resets EVERYTHING that seat wrote,
// x included, so a dismount mid-stride cannot leave the rider offset for the
// life of the view.

const troll = (): MountVisualSpec => {
  const spec = mountVisualSpec('lanternback_troll');
  if (!spec?.seatBone) throw new Error('the troll rides a seat bone');
  return spec;
};
const horse = (): MountVisualSpec => {
  const spec = mountVisualSpec('valorsteed');
  if (!spec || spec.seatBone) throw new Error('the horse is a fixed-lift saddle');
  return spec;
};
const bear = (): MountVisualSpec => {
  const spec = mountVisualSpec('grag_bear');
  if (!spec) throw new Error('the bear has a mount visual spec');
  return spec;
};
const tortoise = (): MountVisualSpec => {
  const spec = mountVisualSpec('chimeglass_tortoise');
  if (!spec) throw new Error('the tortoise has a mount visual spec');
  return spec;
};

function rig(): { v: MountViewState; rider: THREE.Object3D; chair: THREE.Object3D } {
  const group = new THREE.Group();
  const rider = new THREE.Object3D();
  const mountRoot = new THREE.Object3D();
  const chair = new THREE.Object3D();
  chair.name = 'chair';
  // A seat that has rolled sideways mid-stride: a lateral offset AND a lean.
  chair.position.set(0.3, 1.2, -0.4);
  chair.rotation.z = 0.5;
  mountRoot.add(chair);
  group.add(rider);
  group.add(mountRoot);
  const v: MountViewState = {
    group,
    mountVisual: { root: mountRoot } as unknown as CharacterVisual,
    mountVisualKey: 'mount_lanternback_troll',
    mountLamps: null,
    mountGlows: null,
    mountCompilePending: false,
    mountSeatBone: null,
    mountPullerVisual: null,
  };
  return { v, rider, chair };
}

function mountRoot(v: MountViewState): THREE.Object3D {
  const root = v.mountVisual?.root;
  if (!root) throw new Error('the test rig has a mount root');
  return root;
}

describe('seatRiderOnBone', () => {
  it('parks the rider at the seat offset in the bone frame, rebased into group space', () => {
    const { v, rider, chair } = rig();
    const spec = troll();
    const seatBone = spec.seatBone;
    if (!seatBone) throw new Error('the troll rides a seat bone');
    expect(seatRiderOnBone(v.group, rider, mountRoot(v), spec, v)).toBe(true);
    const expected = new THREE.Vector3(...seatBone.offset);
    chair.updateWorldMatrix(true, false);
    expected.applyMatrix4(chair.matrixWorld);
    expect(rider.position.distanceTo(expected)).toBeLessThan(1e-6);
    // The rider took the seat's lean with it, and the lookup is cached.
    expect(rider.quaternion.equals(new THREE.Quaternion())).toBe(false);
    expect(v.mountSeatBone).toBe(chair);
  });

  it('declines a mount with no seat bone so the caller falls back to the fixed lift', () => {
    const { v, rider } = rig();
    expect(seatRiderOnBone(v.group, rider, mountRoot(v), horse(), v)).toBe(false);
    expect(rider.position.length()).toBe(0);
  });
});

describe('placeRider', () => {
  it('resets x, y, z and the rotation on dismount after a bone seat', () => {
    const { v, rider } = rig();
    placeRider(v, rider, troll(), troll().seat, 0);
    expect(rider.position.x).not.toBe(0);
    placeRider(v, rider, null, 0, 0);
    expect(rider.position.toArray()).toEqual([0, 0, 0]);
    expect(rider.quaternion.equals(new THREE.Quaternion())).toBe(true);
  });

  it('holds a fixed-lift saddle at lift plus bob and the authored forward shift, x at zero', () => {
    const { v, rider } = rig();
    placeRider(v, rider, troll(), troll().seat, 0); // leave a stale x behind
    const spec = horse();
    placeRider(v, rider, spec, spec.seat, 0.05);
    expect(rider.position.x).toBe(0);
    expect(rider.position.y).toBeCloseTo(spec.seat + 0.05, 9);
    expect(rider.position.z).toBe(spec.seatFwd);
  });
});

describe('mount compile ownership', () => {
  it('does not let a superseded mount gate reveal the replacement', () => {
    const { v } = rig();
    const firstRoot = mountRoot(v);
    const callbacks: Array<() => void> = [];
    const gate = (_root: THREE.Object3D, done: () => void): void => {
      callbacks.push(done);
    };

    gateMountSwapOnCompile(v, firstRoot, gate);
    const replacementRoot = new THREE.Object3D();
    v.mountVisual = { root: replacementRoot } as unknown as CharacterVisual;
    gateMountSwapOnCompile(v, replacementRoot, gate);

    callbacks[0]();
    expect(v.mountCompilePending, 'the old gate must not reveal the replacement').toBe(true);
    callbacks[1]();
    expect(v.mountCompilePending, 'the replacement gate owns the reveal').toBe(false);
  });

  it('keeps the production sync path owned by the replacement mount gate', () => {
    const { v } = rig();
    v.mountVisual = null;
    v.mountVisualKey = '';
    const callbacks: Array<() => void> = [];
    const host = {
      reconcileViewLights: vi.fn(),
      gateSwapFlagOnCompile: (_root: THREE.Object3D, done: () => void): void => {
        callbacks.push(done);
      },
      recordBuild: vi.fn(),
    };

    syncMountVisual(v, horse(), host);
    const firstRoot = mountRoot(v);
    syncMountVisual(v, bear(), host);
    const replacementRoot = mountRoot(v);

    expect(replacementRoot).not.toBe(firstRoot);
    expect(callbacks).toHaveLength(2);
    callbacks[0]();
    expect(v.mountCompilePending, 'the stale production callback must not reveal the bear').toBe(
      true,
    );
    callbacks[1]();
    expect(v.mountCompilePending, 'the bear callback owns the production reveal').toBe(false);
  });

  it('attaches and disposes the shipped glow through the production lifecycle', () => {
    const { v } = rig();
    v.mountVisual = null;
    v.mountVisualKey = '';
    const glows: MountGlows = { sprites: [], peaks: [], pulses: [], rates: [], sizes: [] };
    vi.mocked(attachMountGlows).mockReset().mockReturnValueOnce(glows);
    vi.mocked(disposeMountGlows).mockClear();
    const host = {
      reconcileViewLights: vi.fn(),
      gateSwapFlagOnCompile: (_root: THREE.Object3D, done: () => void): void => done(),
      recordBuild: vi.fn(),
    };
    const spec = tortoise();

    syncMountVisual(v, spec, host);
    expect(attachMountGlows).toHaveBeenCalledWith(mountRoot(v), spec);
    expect(v.mountGlows).toBe(glows);

    syncMountVisual(v, null, host);
    expect(disposeMountGlows).toHaveBeenCalledWith(glows);
    expect(v.mountGlows).toBeNull();
  });

  it('disposes the old glow before attaching the replacement mount glow', () => {
    const { v } = rig();
    v.mountVisual = null;
    v.mountVisualKey = '';
    const first: MountGlows = { sprites: [], peaks: [], pulses: [], rates: [], sizes: [] };
    const second: MountGlows = { sprites: [], peaks: [], pulses: [], rates: [], sizes: [] };
    vi.mocked(attachMountGlows).mockReset().mockReturnValueOnce(first).mockReturnValueOnce(second);
    vi.mocked(disposeMountGlows).mockClear();
    const host = {
      reconcileViewLights: vi.fn(),
      gateSwapFlagOnCompile: (_root: THREE.Object3D, done: () => void): void => done(),
      recordBuild: vi.fn(),
    };

    syncMountVisual(v, tortoise(), host);
    const firstRoot = mountRoot(v);
    const replacement = { ...horse(), glows: tortoise().glows };
    syncMountVisual(v, replacement, host);
    const replacementRoot = mountRoot(v);

    expect(replacementRoot).not.toBe(firstRoot);
    expect(disposeMountGlows).toHaveBeenCalledOnce();
    expect(disposeMountGlows).toHaveBeenCalledWith(first);
    expect(attachMountGlows).toHaveBeenNthCalledWith(2, replacementRoot, replacement);
    expect(v.mountGlows).toBe(second);
    expect(vi.mocked(disposeMountGlows).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(attachMountGlows).mock.invocationCallOrder[1],
    );
  });

  it('disposes a live glow when its whole entity view is removed', () => {
    const { v } = rig();
    const glows: MountGlows = { sprites: [], peaks: [], pulses: [], rates: [], sizes: [] };
    const dispose = vi.fn();
    v.mountGlows = glows;
    v.mountVisual = { root: mountRoot(v), dispose } as unknown as CharacterVisual;
    vi.mocked(disposeMountGlows).mockClear();

    disposeMountView(v);

    expect(disposeMountGlows).toHaveBeenCalledOnce();
    expect(disposeMountGlows).toHaveBeenCalledWith(glows);
    expect(dispose).toHaveBeenCalledOnce();
    expect(v.mountGlows).toBeNull();
    expect(v.mountVisual).toBeNull();
    expect(v.mountVisualKey).toBe('');
  });
});

describe('mount transition effects', () => {
  function transitionInputs(
    overrides: Partial<Parameters<typeof syncMountTransitionFx>[1]> = {},
  ): Parameters<typeof syncMountTransitionFx>[1] {
    return {
      mountCasting: false,
      mountCastKey: '',
      mountCastRemaining: 0,
      mountKey: '',
      poseAllowed: true,
      present: true,
      playCallPose: vi.fn(),
      summonGlow: vi.fn(),
      summonCall: vi.fn(),
      engineReset: vi.fn(),
      preloadEngine: vi.fn(),
      ...overrides,
    };
  }

  it('preloads and plays the call pose once on a summon-cast edge', () => {
    const state = { lastMountKey: '', wasMountCasting: false };
    const summon = transitionInputs({
      mountCasting: true,
      mountCastKey: 'mech_bird',
      mountCastRemaining: 2.75,
    });

    state.wasMountCasting = syncMountTransitionFx(state, summon);
    expect(summon.playCallPose).toHaveBeenCalledOnce();
    expect(summon.playCallPose).toHaveBeenCalledWith(2.75);
    expect(summon.preloadEngine).toHaveBeenCalledOnce();
    expect(summon.preloadEngine).toHaveBeenCalledWith('mech_bird');
    state.wasMountCasting = syncMountTransitionFx(state, summon);
    expect(summon.playCallPose).toHaveBeenCalledOnce();
    expect(summon.preloadEngine).toHaveBeenCalledOnce();
  });

  it('preloads a summon when the current body cannot play the optional call pose', () => {
    const state = { lastMountKey: '', wasMountCasting: false };
    const summon = transitionInputs({
      mountCasting: true,
      mountCastKey: 'mech_bird',
      mountCastRemaining: 2.75,
      poseAllowed: false,
    });

    expect(syncMountTransitionFx(state, summon)).toBe(true);
    expect(summon.playCallPose).not.toHaveBeenCalled();
    expect(summon.preloadEngine).toHaveBeenCalledOnce();
    expect(summon.preloadEngine).toHaveBeenCalledWith('mech_bird');
  });

  it.each([
    ['no active cast', false, 'mech_bird', false],
    ['dismount cast', true, '', false],
    ['already-latched summon cast', true, 'mech_bird', true],
  ] as const)(
    'does not fire summon-start work for %s',
    (_label, mountCasting, mountCastKey, wasMountCasting) => {
      const state = { lastMountKey: '', wasMountCasting };
      const input = transitionInputs({ mountCasting, mountCastKey });

      syncMountTransitionFx(state, input);

      expect(input.playCallPose).not.toHaveBeenCalled();
      expect(input.preloadEngine).not.toHaveBeenCalled();
    },
  );

  it('returns a false latch on the first frame after casting ends', () => {
    const state = { lastMountKey: '', wasMountCasting: true };
    const input = transitionInputs({ mountCasting: false, mountCastKey: 'mech_bird' });

    expect(syncMountTransitionFx(state, input)).toBe(false);
    expect(input.playCallPose).not.toHaveBeenCalled();
    expect(input.preloadEngine).not.toHaveBeenCalled();
  });

  it('fires appearance, swap, and dismount effects exactly on mount-key edges', () => {
    const state = { lastMountKey: '', wasMountCasting: false };
    const summon = transitionInputs({ mountKey: 'mech_bird' });
    syncMountTransitionFx(state, summon);
    expect(state.lastMountKey).toBe('mech_bird');
    expect(summon.summonGlow).toHaveBeenCalledOnce();
    expect(summon.summonCall).toHaveBeenCalledOnce();
    expect(summon.engineReset).toHaveBeenCalledOnce();
    expect(summon.preloadEngine).toHaveBeenCalledWith('mech_bird');

    syncMountTransitionFx(state, summon);
    expect(summon.summonGlow).toHaveBeenCalledOnce();
    expect(summon.summonCall).toHaveBeenCalledOnce();
    expect(summon.engineReset).toHaveBeenCalledOnce();
    expect(summon.preloadEngine).toHaveBeenCalledOnce();

    const swap = transitionInputs({ mountKey: 'grag_bear', present: false });
    syncMountTransitionFx(state, swap);
    expect(state.lastMountKey).toBe('grag_bear');
    expect(swap.summonGlow).not.toHaveBeenCalled();
    expect(swap.summonCall).toHaveBeenCalledOnce();
    expect(swap.engineReset).toHaveBeenCalledOnce();
    expect(swap.preloadEngine).toHaveBeenCalledWith('grag_bear');

    const dismount = transitionInputs({ mountKey: '' });
    syncMountTransitionFx(state, dismount);
    expect(state.lastMountKey).toBe('');
    expect(dismount.summonGlow).toHaveBeenCalledOnce();
    expect(dismount.summonCall).not.toHaveBeenCalled();
    expect(dismount.engineReset).toHaveBeenCalledOnce();
    expect(dismount.preloadEngine).not.toHaveBeenCalled();
  });
});

describe('mount visual spec flags', () => {
  it('only the rickshaw tips off a jump; every other mount keeps a level body', () => {
    for (const key of MOUNT_KEYS) {
      expect(mountVisualSpec(key)?.jumpTips, key).toBe(key === 'rickshaw_mount');
    }
  });
});
