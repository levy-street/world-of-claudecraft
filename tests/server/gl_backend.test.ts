// The backend classifier reads REAL UNMASKED_RENDERER_WEBGL adapter names, the
// same strings the perf report carries. Every fixture below is a shape seen in
// the wild rather than an invented one, because the classifier's whole job is
// to survive the punctuation and ordering those strings actually use.
import { describe, expect, it } from 'vitest';
import { GL_BACKEND_LABELS, glBackendFromRenderer } from '../../server/gl_backend';

describe('glBackendFromRenderer', () => {
  it('reads the Direct3D 11 backend off Windows ANGLE names', () => {
    expect(
      glBackendFromRenderer(
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 (0x00002204) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      ),
    ).toBe('d3d11');
    expect(
      glBackendFromRenderer(
        'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00003EA0) Direct3D11 vs_5_0 ps_5_0, D3D11-27.20.100.9316)',
      ),
    ).toBe('d3d11');
    expect(
      glBackendFromRenderer('ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)'),
    ).toBe('d3d11');
  });

  it('separates the legacy Direct3D 9 path from Direct3D 11', () => {
    expect(
      glBackendFromRenderer(
        'ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D9Ex vs_3_0 ps_3_0, D3D9)',
      ),
    ).toBe('d3d9');
  });

  it('reads GLES on mobile and desktop GL on Linux, never confusing the two', () => {
    expect(glBackendFromRenderer('ANGLE (Qualcomm, Adreno (TM) 730, OpenGL ES 3.2)')).toBe(
      'opengl-es',
    );
    expect(glBackendFromRenderer('ANGLE (ARM, Mali-G78, OpenGL ES 3.2)')).toBe('opengl-es');
    expect(
      glBackendFromRenderer('Mesa Intel(R) UHD Graphics (CML GT2), OpenGL 4.6 (Core Profile)'),
    ).toBe('opengl');
  });

  it('reads Vulkan and Metal', () => {
    expect(
      glBackendFromRenderer('ANGLE (AMD, AMD Radeon Graphics (RADV NAVI22), Vulkan 1.3.255)'),
    ).toBe('vulkan');
    expect(
      glBackendFromRenderer('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'),
    ).toBe('metal');
  });

  it('classifies WARP by its API, leaving "is it software" to gl_renderer_bucket', () => {
    // The two fields are orthogonal on purpose: WARP is a software rasterizer
    // AND a real Direct3D 11 device. Collapsing it to a 'software' backend here
    // would answer the bucket's question twice and lose the API.
    expect(
      glBackendFromRenderer(
        'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)',
      ),
    ).toBe('d3d11');
  });

  it('is unknown rather than a guess when the name carries no API token', () => {
    expect(glBackendFromRenderer('Google SwiftShader')).toBe('unknown');
    expect(glBackendFromRenderer('Mesa/X.org llvmpipe (LLVM 15.0.6, 256 bits)')).toBe('unknown');
    // Brave farbles the adapter name, so there is nothing to read.
    expect(glBackendFromRenderer('Brave')).toBe('unknown');
    expect(glBackendFromRenderer('')).toBe('unknown');
    expect(glBackendFromRenderer(null)).toBe('unknown');
    expect(glBackendFromRenderer(undefined)).toBe('unknown');
  });

  it('only ever returns a label from the closed vocabulary', () => {
    const names = [
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Qualcomm, Adreno (TM) 730, OpenGL ES 3.2)',
      'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
      'Something Nobody Has Shipped Yet',
      '',
    ];
    for (const name of names) {
      expect(GL_BACKEND_LABELS).toContain(glBackendFromRenderer(name));
    }
  });

  it('stays as coarse as the bucket beside it: no model, no driver version', () => {
    // The whole adapter name is discarded except the API word, so the field
    // adds no fingerprinting surface over gl_renderer_bucket.
    const label = glBackendFromRenderer(
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 (0x00002204) Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.3623)',
    );
    expect(label).toBe('d3d11');
    expect(label).not.toMatch(/3090|0x|31\.0/);
  });
});
