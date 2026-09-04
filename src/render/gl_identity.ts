// The adapter identity strings (vendor + renderer) the perf beacon, the GPU
// bucket and the software-rasterizer detector read. The renderer captures
// them at construction and again on every context restore: a driver reset
// can bring the canvas back on a different adapter (a laptop switching
// between its GPUs), and the beacon must describe the context that is
// actually drawing. Fails soft to empty strings, the context getter
// included: an identity read must never take the renderer down.

export interface GlIdentity {
  vendor: string;
  renderer: string;
}

export function readGlIdentity(
  getContext: () => WebGLRenderingContext | WebGL2RenderingContext,
): GlIdentity {
  try {
    const gl = getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      vendor: String(dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)),
      renderer: String(
        dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      ),
    };
  } catch {
    return { vendor: '', renderer: '' };
  }
}
