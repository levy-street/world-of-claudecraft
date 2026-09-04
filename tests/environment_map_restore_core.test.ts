// Behavioral pins for src/render/environment_map_restore_core.ts: rebuilding
// the per-biome PMREM environment targets after an in-place WebGL context
// restore (issue 3846). Pure core: a structural fake of the renderer's env
// map host, no three.
import { describe, expect, it, vi } from 'vitest';
import {
  type EnvironmentMapRestoreHost,
  type RestorableEnvironmentTarget,
  restoreEnvironmentMaps,
} from '../src/render/environment_map_restore_core';

type Key = 'vale' | 'dusk' | 'frost';

interface FakeTarget extends RestorableEnvironmentTarget {
  texture: { name: string };
  disposed: number;
}

function target(name: string): FakeTarget {
  const t: FakeTarget = {
    texture: { name },
    disposed: 0,
    dispose() {
      t.disposed++;
    },
  };
  return t;
}

interface Harness {
  host: EnvironmentMapRestoreHost<Key, FakeTarget>;
  envRTs: Map<Key, FakeTarget>;
  scene: { environment: object | null };
  ensured: Key[];
  resetCaches: ReturnType<typeof vi.fn>;
}

/** A host whose ensure path mints a fresh target per key (recording the
 *  order), except for the keys listed in `decline`. */
function harness(resident: Key[], bound: Key | null, decline: Key[] = []): Harness {
  const envRTs = new Map<Key, FakeTarget>();
  for (const key of resident) envRTs.set(key, target(`old:${key}`));
  const scene = { environment: bound ? (envRTs.get(bound)?.texture ?? null) : null };
  const ensured: Key[] = [];
  const resetCaches = vi.fn();
  const host: EnvironmentMapRestoreHost<Key, FakeTarget> = {
    envRTs: () => envRTs,
    resetPrefilterCaches: resetCaches,
    ensureEnvironmentBiome(key) {
      ensured.push(key);
      if (decline.includes(key)) return null;
      const fresh = target(`new:${key}`);
      envRTs.set(key, fresh);
      return fresh;
    },
    scene: () => scene,
  };
  return { host, envRTs, scene, ensured, resetCaches };
}

describe('restoreEnvironmentMaps (synchronous host)', () => {
  it('disposes every old target, resets the prefilter caches, rebuilds every key and re-binds the scene', async () => {
    const h = harness(['vale', 'dusk'], 'dusk');
    const oldVale = h.envRTs.get('vale') as FakeTarget;
    const oldDusk = h.envRTs.get('dusk') as FakeTarget;

    const result = restoreEnvironmentMaps(h.host);

    expect(oldVale.disposed).toBe(1);
    expect(oldDusk.disposed).toBe(1);
    expect(h.resetCaches).toHaveBeenCalledOnce();
    expect(result.rebuilt).toEqual(['dusk', 'vale']);
    expect(result.missing).toEqual([]);
    expect(result.deferred).toEqual([]);
    expect(result.rebound).toBe(true);
    await expect(result.settled).resolves.toBeUndefined();
    expect(h.envRTs.get('dusk')?.texture).toEqual({ name: 'new:dusk' });
    expect(h.envRTs.get('vale')?.texture).toEqual({ name: 'new:vale' });
    expect(h.scene.environment).toBe(h.envRTs.get('dusk')?.texture);
  });

  it('rebuilds the bound key FIRST so a one-prefilter memory profile keeps the one on screen', () => {
    const h = harness(['vale', 'dusk', 'frost'], 'frost');

    restoreEnvironmentMaps(h.host);

    expect(h.ensured[0]).toBe('frost');
    expect(h.ensured).toEqual(['frost', 'vale', 'dusk']);
  });

  it('disposes a target shared by aliased keys exactly once', () => {
    const h = harness([], null);
    const shared = target('old:shared');
    h.envRTs.set('vale', shared);
    h.envRTs.set('dusk', shared);

    const result = restoreEnvironmentMaps(h.host);

    expect(shared.disposed).toBe(1);
    expect(result.rebuilt).toEqual(['vale', 'dusk']);
  });

  it('reports a declined key as missing and unbinds a bound environment it could not rebuild', () => {
    const h = harness(['vale', 'dusk'], 'vale', ['vale']);

    const result = restoreEnvironmentMaps(h.host);

    expect(result.rebuilt).toEqual(['dusk']);
    expect(result.missing).toEqual(['vale']);
    expect(result.rebound).toBe(false);
    // The old texture is dead on the restored context: an unbound environment
    // is plain ambient lighting, a dead one is black.
    expect(h.scene.environment).toBeNull();
    expect(h.envRTs.has('vale')).toBe(false);
  });

  it('is a no-op on a host with no resident targets (the low tier keeps no prefilters)', () => {
    const h = harness([], null);

    const result = restoreEnvironmentMaps(h.host);

    expect(result.rebuilt).toEqual([]);
    expect(result.rebound).toBe(false);
    expect(h.resetCaches).toHaveBeenCalledOnce();
    expect(h.ensured).toEqual([]);
  });
});

describe('restoreEnvironmentMaps (failure paths)', () => {
  it('propagates an ensure failure so the coordinator counts the producer as failed', () => {
    const h = harness(['vale'], 'vale');
    h.host.ensureEnvironmentBiome = () => {
      throw new Error('context lost again');
    };

    expect(() => restoreEnvironmentMaps(h.host)).toThrow('context lost again');
    // Never left bound to the disposed texture.
    expect(h.scene.environment).toBeNull();
  });

  it('keeps the scene bound to the rebuilt on-screen key when a later key throws', () => {
    const h = harness(['vale', 'dusk'], 'vale');
    const ensure = h.host.ensureEnvironmentBiome.bind(h.host);
    h.host.ensureEnvironmentBiome = (key) => {
      if (key === 'dusk') throw new Error('dusk failed');
      return ensure(key);
    };

    expect(() => restoreEnvironmentMaps(h.host)).toThrow('dusk failed');
    expect(h.scene.environment).toEqual({ name: 'new:vale' });
    expect(h.scene.environment).toBe(h.envRTs.get('vale')?.texture);
  });
});

describe('restoreEnvironmentMaps (untracked bound environment)', () => {
  it('rebuilds the dome-prefilter fallback through the host and re-binds it', () => {
    const h = harness(['vale'], null);
    h.scene.environment = { name: 'old:dome' };
    const freshDome = { name: 'new:dome' };
    h.host.rebuildUntrackedEnvironment = vi.fn(() => freshDome);

    const result = restoreEnvironmentMaps(h.host);

    expect(h.host.rebuildUntrackedEnvironment).toHaveBeenCalledOnce();
    expect(h.scene.environment).toBe(freshDome);
    expect(result.rebound).toBe(true);
    expect(result.rebuilt).toEqual(['vale']);
  });

  it('unbinds an untracked environment when the host cannot rebuild it (ambient beats a dead texture)', () => {
    const h = harness(['vale'], null);
    h.scene.environment = { name: 'old:dome' };

    const result = restoreEnvironmentMaps(h.host);

    expect(h.scene.environment).toBeNull();
    expect(result.rebound).toBe(false);
  });
});

describe('restoreEnvironmentMaps (deferring host)', () => {
  it('rebuilds only the bound key synchronously and hands every other key to the deferral, in order', async () => {
    const h = harness(['vale', 'dusk', 'frost'], 'dusk');
    const deferredRuns: Key[] = [];
    h.host.deferEnvironmentBiome = (key) => {
      deferredRuns.push(key);
      return Promise.resolve().then(() => h.host.ensureEnvironmentBiome(key));
    };

    const result = restoreEnvironmentMaps(h.host);

    expect(result.rebuilt).toEqual(['dusk']);
    expect(result.deferred).toEqual(['vale', 'frost']);
    expect(h.ensured).toEqual(['dusk']);
    expect(h.scene.environment).toBe(h.envRTs.get('dusk')?.texture);
    await result.settled;
    expect(deferredRuns).toEqual(['vale', 'frost']);
    expect(h.ensured).toEqual(['dusk', 'vale', 'frost']);
    expect(h.envRTs.size).toBe(3);
  });

  it('settled rejects when a deferred key fails, so the producer counts as failed', async () => {
    const h = harness(['vale', 'dusk'], 'vale');
    h.host.deferEnvironmentBiome = () => Promise.reject(new Error('queue shut down'));

    const result = restoreEnvironmentMaps(h.host);

    expect(result.rebuilt).toEqual(['vale']);
    expect(result.deferred).toEqual(['dusk']);
    expect(result.rebound).toBe(true);
    await expect(result.settled).rejects.toThrow('queue shut down');
  });

  it('with nothing bound, every key is deferred', async () => {
    const h = harness(['vale', 'dusk'], null);
    h.host.deferEnvironmentBiome = (key) =>
      Promise.resolve().then(() => h.host.ensureEnvironmentBiome(key));

    const result = restoreEnvironmentMaps(h.host);

    expect(result.rebuilt).toEqual([]);
    expect(result.deferred).toEqual(['vale', 'dusk']);
    await result.settled;
    expect(h.envRTs.size).toBe(2);
  });
});
