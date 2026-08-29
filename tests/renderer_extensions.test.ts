// The renderer's extension sweep: one ordered list, enabled before the first
// program links, so every program of a session and any warm-up context share
// one shader translation state. Node-only (RENDER_PURE_CORES): no Three, no DOM.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  enableRendererExtensions,
  RENDERER_CONTEXT_EXTENSIONS,
} from '../src/render/renderer_extensions';

function host(available: readonly string[], throwing: readonly string[] = []) {
  const calls: string[] = [];
  return {
    calls,
    getExtension(name: string): unknown {
      calls.push(name);
      if (throwing.includes(name)) throw new Error(`no ${name}`);
      return available.includes(name) ? { name } : null;
    },
  };
}

describe('the renderer context extension list', () => {
  it("starts with three's six init extensions, in three's order", () => {
    expect(RENDERER_CONTEXT_EXTENSIONS.slice(0, 6)).toEqual([
      'EXT_color_buffer_float',
      'WEBGL_clip_cull_distance',
      'OES_texture_float_linear',
      'EXT_color_buffer_half_float',
      'WEBGL_multisampled_render_to_texture',
      'WEBGL_render_shared_exponent',
    ]);
  });

  it('carries the parallel compile, the anisotropic filter and the two compressed formats', () => {
    for (const name of [
      'KHR_parallel_shader_compile',
      'EXT_texture_filter_anisotropic',
      'WEBGL_compressed_texture_astc',
      'EXT_texture_compression_bptc',
    ]) {
      expect(RENDERER_CONTEXT_EXTENSIONS).toContain(name);
    }
    expect(new Set(RENDERER_CONTEXT_EXTENSIONS).size).toBe(RENDERER_CONTEXT_EXTENSIONS.length);
  });
});

describe('enableRendererExtensions', () => {
  it('requests every name in list order and reports what the adapter has', () => {
    const gl = host(['EXT_color_buffer_float', 'KHR_parallel_shader_compile']);
    const sweep = enableRendererExtensions(gl);
    expect(gl.calls).toEqual([...RENDERER_CONTEXT_EXTENSIONS]);
    expect(sweep).toEqual({
      parallelCompile: true,
      enabled: ['EXT_color_buffer_float', 'KHR_parallel_shader_compile'],
    });
  });

  it('reports no parallel compile when the adapter lacks it', () => {
    const sweep = enableRendererExtensions(host(['EXT_color_buffer_float']));
    expect(sweep.parallelCompile).toBe(false);
  });

  it('survives a throwing getExtension and keeps sweeping', () => {
    const gl = host(['KHR_parallel_shader_compile'], ['WEBGL_debug_renderer_info']);
    const sweep = enableRendererExtensions(gl);
    expect(gl.calls).toEqual([...RENDERER_CONTEXT_EXTENSIONS]);
    expect(sweep.parallelCompile).toBe(true);
  });
});

describe('the renderer sweeps its context before its first GPU work', () => {
  const rendererSource = (): string =>
    readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

  it('replaces the lone parallel-compile probe and precedes the grass ground bake', () => {
    const source = rendererSource();
    const ctor = source.indexOf('  constructor(');
    // Asserted, not assumed: an unchecked -1 turns indexOf(x, -1) into a
    // whole-file scan and both orderings below would pass from anywhere.
    expect(ctor).toBeGreaterThan(-1);
    const sweep = source.indexOf('enableRendererExtensions(this.webgl.getContext())', ctor);
    const firstBake = source.indexOf('bakeGrassGroundTexture(this.webgl', ctor);
    expect(sweep).toBeGreaterThan(ctor);
    expect(firstBake).toBeGreaterThan(sweep);
    expect(source).not.toContain("getExtension('KHR_parallel_shader_compile')");
  });

  it('derives asyncCompileSupported from the sweep, never from compileAsync alone', () => {
    // The sweep's ordering pin above cannot see WHAT the renderer does with
    // the answer, and that is the load-bearing half: a session that keeps
    // compileAsync but drops `.parallelCompile` would gate every streamed
    // piece on a call that never resolves off-thread, on exactly the hardware
    // the gates exist to protect. Pinned as the whole assignment, inside a
    // bounded slice, so neither half can be dropped in silence.
    const source = rendererSource();
    const at = source.indexOf('this.asyncCompileSupported =');
    expect(at).toBeGreaterThan(-1);
    const end = source.indexOf(';', at);
    expect(end).toBeGreaterThan(at);
    const assignment = source.slice(at, end);
    expect(assignment).toContain("typeof this.webgl.compileAsync === 'function'");
    expect(assignment).toContain(
      'enableRendererExtensions(this.webgl.getContext()).parallelCompile',
    );
    // One derivation only: a second, laxer assignment elsewhere would win.
    expect(source.split('this.asyncCompileSupported =').length - 1).toBe(2);
    expect(source).toContain('this.asyncCompileSupported = false;');
  });
});
