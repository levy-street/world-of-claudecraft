// The sentinel over three's extension object (src/render/extension_drift_sentinel.ts):
// the shader warm-up's cache key includes the context's ENABLED extension set,
// so a name enabled after the sweep silently re-keys every later program and
// the worker's warmed ones stop being hits.

import { describe, expect, it, vi } from 'vitest';
import {
  type ExtensionDriftHost,
  watchExtensionDrift,
} from '../src/render/extension_drift_sentinel';

const PINNED = ['EXT_color_buffer_float', 'KHR_parallel_shader_compile'];

/** three's WebGLExtensions shape: `has` acquires exactly like `get` does. */
function threeLikeHost(available: readonly string[] = []): ExtensionDriftHost & {
  acquired: string[];
} {
  const acquired: string[] = [];
  const acquire = (name: string): unknown => {
    if (!acquired.includes(name)) acquired.push(name);
    return available.includes(name) ? { name } : null;
  };
  return {
    acquired,
    has: (name) => acquire(name) !== null,
    get: (name) => acquire(name),
  };
}

describe('watchExtensionDrift', () => {
  it('says nothing while every acquisition is inside the swept list', () => {
    const host = threeLikeHost(PINNED);
    const onDrift = vi.fn();
    const watch = watchExtensionDrift(host, PINNED, onDrift);
    expect(host.has('EXT_color_buffer_float')).toBe(true);
    expect(host.get('KHR_parallel_shader_compile')).toEqual({
      name: 'KHR_parallel_shader_compile',
    });
    expect(onDrift).not.toHaveBeenCalled();
    expect(watch.drifted).toEqual([]);
  });

  it('reports a name enabled outside the list, through get AND through has', () => {
    // `has` is the commonest caller in three (WebGLUtils.convert reaches for a
    // compressed format that way), so watching `get` alone would miss it.
    const viaGet = threeLikeHost(['WEBGL_compressed_texture_s3tc']);
    const getDrift = vi.fn();
    watchExtensionDrift(viaGet, PINNED, getDrift);
    viaGet.get('WEBGL_compressed_texture_s3tc');
    expect(getDrift).toHaveBeenCalledWith('WEBGL_compressed_texture_s3tc', true);

    const viaHas = threeLikeHost(['WEBGL_compressed_texture_etc']);
    const hasDrift = vi.fn();
    const watch = watchExtensionDrift(viaHas, PINNED, hasDrift);
    viaHas.has('WEBGL_compressed_texture_etc');
    expect(hasDrift).toHaveBeenCalledWith('WEBGL_compressed_texture_etc', true);
    expect(watch.drifted).toEqual(['WEBGL_compressed_texture_etc']);
  });

  it('reports each drifted name ONCE, however often it is asked for', () => {
    // three caches the extension object itself but the callers keep asking;
    // a report per call would drown the readout and retire the worker twice.
    const host = threeLikeHost();
    const onDrift = vi.fn();
    const watch = watchExtensionDrift(host, PINNED, onDrift);
    host.get('WEBGL_compressed_texture_pvrtc');
    host.has('WEBGL_compressed_texture_pvrtc');
    host.get('WEBGL_compressed_texture_pvrtc');
    expect(onDrift).toHaveBeenCalledTimes(1);
    expect(watch.drifted).toEqual(['WEBGL_compressed_texture_pvrtc']);
  });

  it('says a name the adapter does NOT have did not grow the set', () => {
    // The harmless drift: three caches the null and the context's enabled set
    // is unchanged, so the warm-up is still keyed right. Reported all the same
    // (it says the list is short), but flagged so the caller does not throw
    // the worker away over it.
    const host = threeLikeHost([]);
    const onDrift = vi.fn();
    watchExtensionDrift(host, PINNED, onDrift);
    expect(host.get('WEBGL_compressed_texture_astc')).toBeNull();
    expect(onDrift).toHaveBeenCalledWith('WEBGL_compressed_texture_astc', false);
    expect(host.has('WEBGL_compressed_texture_pvrtc')).toBe(false);
    expect(onDrift).toHaveBeenCalledWith('WEBGL_compressed_texture_pvrtc', false);
  });

  it('passes the host answer through untouched, and restores it on stop', () => {
    const host = threeLikeHost(['EXT_color_buffer_float']);
    const ownHas = host.has;
    const watch = watchExtensionDrift(host, PINNED);
    expect(host.has).not.toBe(ownHas);
    expect(host.has('EXT_color_buffer_float')).toBe(true);
    expect(host.has('WEBGL_compressed_texture_etc1')).toBe(false);
    watch.stop();
    expect(host.has).toBe(ownHas);
    // Every acquisition still reached the host, in order, exactly once each.
    expect(host.acquired).toEqual(['EXT_color_buffer_float', 'WEBGL_compressed_texture_etc1']);
  });
});
