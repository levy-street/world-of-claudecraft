import { describe, expect, it } from 'vitest';
import { angleBackendToken, parseGlIdentity } from '../src/render/angle_identity_core';

// Real-world unmasked renderer strings, one row per shape the fleet actually
// sends (see gpuBucket() in src/game/perf.ts for the coarse vendor buckets;
// this parser answers the finer backend question those buckets cannot).
describe('angle_identity_core', () => {
  it('parses the canonical Windows D3D11 shape with a driver version', () => {
    const id = parseGlIdentity(
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 (0x00002704) Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.4633)',
    );
    expect(id.angle).toBe(true);
    expect(id.backend).toBe('d3d11');
    expect(id.deviceName).toBe('NVIDIA GeForce RTX 4080');
    expect(id.driverVersion).toBe('31.0.15.4633');
  });

  it('parses a laptop adapter without the driver suffix', () => {
    const id = parseGlIdentity(
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Laptop GPU (0x0000249D) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    );
    expect(id.backend).toBe('d3d11');
    expect(id.deviceName).toBe('NVIDIA GeForce RTX 3070 Laptop GPU');
    expect(id.driverVersion).toBeNull();
  });

  it('parses Intel integrated D3D11', () => {
    const id = parseGlIdentity(
      'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11-27.20.100.8681)',
    );
    expect(id.backend).toBe('d3d11');
    expect(id.deviceName).toBe('Intel(R) UHD Graphics 630');
    expect(id.driverVersion).toBe('27.20.100.8681');
  });

  it('parses the macOS Metal shape', () => {
    const id = parseGlIdentity(
      'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)',
    );
    expect(id.angle).toBe(true);
    expect(id.backend).toBe('metal');
    expect(id.deviceName).toBe('Apple M1 Pro');
  });

  it('parses ANGLE-over-Vulkan and unwraps the device', () => {
    const id = parseGlIdentity(
      'ANGLE (NVIDIA, Vulkan 1.3.277 (NVIDIA GeForce RTX 4080 (0x00002704)), NVIDIA)',
    );
    expect(id.backend).toBe('vulkan');
    expect(id.deviceName).toBe('NVIDIA GeForce RTX 4080');
  });

  it('classifies SwiftShader as software even though it advertises Vulkan', () => {
    const id = parseGlIdentity(
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    );
    expect(id.backend).toBe('swiftshader');
  });

  it('classifies Microsoft Basic Render (WARP) as warp, not d3d11', () => {
    const id = parseGlIdentity(
      'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
    );
    expect(id.backend).toBe('warp');
  });

  it('parses the Android OpenGL ES shape', () => {
    const id = parseGlIdentity('ANGLE (ARM, Mali-G78 MC14, OpenGL ES 3.2 v1.r32p1-01eac0)');
    expect(id.backend).toBe('opengl');
    expect(id.deviceName).toBe('Mali-G78 MC14');
  });

  it('handles non-ANGLE strings (Firefox GL, bare adapter names)', () => {
    const firefox = parseGlIdentity('NVIDIA GeForce GTX 1080/PCIe/SSE2');
    expect(firefox.angle).toBe(false);
    expect(firefox.backend).toBeNull();
    expect(firefox.deviceName).toBe('NVIDIA GeForce GTX 1080');

    const bare = parseGlIdentity('Apple M1');
    expect(bare.angle).toBe(false);
    expect(bare.deviceName).toBe('Apple M1');
  });

  it('handles empty and masked strings without throwing', () => {
    expect(parseGlIdentity('').backend).toBeNull();
    expect(parseGlIdentity('').deviceName).toBeNull();
    const masked = parseGlIdentity('WebKit WebGL');
    expect(masked.angle).toBe(false);
  });

  it('produces the beacon token: backend, angle-unknown, or null', () => {
    expect(
      angleBackendToken(
        parseGlIdentity(
          'ANGLE (AMD, AMD Radeon RX 6800 XT (0x000073BF) Direct3D11 vs_5_0 ps_5_0, D3D11)',
        ),
      ),
    ).toBe('d3d11');
    expect(angleBackendToken(parseGlIdentity('ANGLE (Unheard Of Corp, Mystery Device, v1)'))).toBe(
      'angle-unknown',
    );
    expect(angleBackendToken(parseGlIdentity('Adreno (TM) 640'))).toBeNull();
  });
});
