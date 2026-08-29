// The WebGL extensions the world renderer's context ends up with, enabled in
// one ordered sweep before its first program links.
//
// The browser translates a shader against the extensions ENABLED on its
// context at compile time, and its program cache is keyed on that translation:
// the 2026-08-27 measurement (tmp/REPORT_first-seconds_real-regime_2026-08-27.md,
// night addendum) had a hidden-context warm-up hit the cache only when it
// enabled the renderer's own set, and miss with one extension or with every
// supported one. Left to itself the set grows during the session: three's
// init enables six, the constructor probes the parallel compile, the first
// anisotropic texture and the first compressed upload enable theirs while the
// constructor is already building (recorded on 2026-08-28: the two compressed
// formats landed about 0.3 s and 1.5 s after context creation). A program
// linked before that point is keyed under a smaller set than one linked
// after, and a warm-up context has no single set to mirror.
//
// Enabling the whole list up front makes every program of the session share
// one translation state, and gives a warm-up context an exact contract: this
// list, in this order. A name the adapter lacks returns null and changes
// nothing, which is what three's own lazy `extensions.get` gets too.
//
// Host-agnostic: the sweep takes anything with `getExtension`.

/** In the order the world context enabled them on 2026-08-28 (three's
 *  `WebGLExtensions.init` first, then the renderer's own probes, then the
 *  lazily enabled ones). Keep the order: it is part of the contract.
 *
 *  The lazy tail is the load-bearing part, and it is why the list carries
 *  compressed formats this machine does not have. three enables a compressed
 *  format from `WebGLUtils.convert` on the FIRST upload of a texture in that
 *  format, which on a KTX2 target of DXT, ETC or PVRTC lands well after this
 *  sweep. The context's enabled set would then grow mid-session, every program
 *  linked after that point would be keyed differently from the ones the warm
 *  worker had already linked, and the whole warm-up would quietly stop paying.
 *  A name the adapter does not have costs nothing (getExtension returns null,
 *  exactly as three's own lazy get would), so the list names every format the
 *  loader can target rather than the ones one machine happened to enable. */
export const RENDERER_CONTEXT_EXTENSIONS: readonly string[] = [
  'EXT_color_buffer_float',
  'WEBGL_clip_cull_distance',
  'OES_texture_float_linear',
  'EXT_color_buffer_half_float',
  'WEBGL_multisampled_render_to_texture',
  'WEBGL_render_shared_exponent',
  'WEBGL_debug_renderer_info',
  'KHR_parallel_shader_compile',
  'EXT_texture_filter_anisotropic',
  'WEBGL_compressed_texture_astc',
  'EXT_texture_compression_bptc',
  'WEBGL_compressed_texture_s3tc',
  'WEBGL_compressed_texture_s3tc_srgb',
  'WEBGL_compressed_texture_etc',
  'WEBGL_compressed_texture_etc1',
  'WEBGL_compressed_texture_pvrtc',
];

export interface ExtensionHost {
  getExtension(name: string): unknown;
}

export interface RendererExtensionSweep {
  /** `KHR_parallel_shader_compile` is present: programs can link off-thread. */
  parallelCompile: boolean;
  /** The names the host returned an object for, in list order. */
  enabled: string[];
}

/** Enable the list on `gl`, in order; report what the adapter has. */
export function enableRendererExtensions(gl: ExtensionHost): RendererExtensionSweep {
  const enabled: string[] = [];
  for (const name of RENDERER_CONTEXT_EXTENSIONS) {
    let extension: unknown = null;
    try {
      extension = gl.getExtension(name);
    } catch {
      extension = null;
    }
    if (extension !== null && extension !== undefined) enabled.push(name);
  }
  return { parallelCompile: enabled.includes('KHR_parallel_shader_compile'), enabled };
}
