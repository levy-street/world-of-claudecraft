// Parses the WEBGL_debug_renderer_info unmasked renderer string into the
// pieces the perf beacon and the bottleneck classifier care about: whether
// the context runs through ANGLE, which native backend ANGLE translates to,
// the adapter name, and the driver version when the string carries one.
//
// Why this matters for Windows diagnosis: Chrome on Windows renders WebGL
// through ANGLE over Direct3D 11, where shader program links are one to three
// orders of magnitude slower than GL drivers (issue #2243 measured 50 to
// 1700 ms first-draw links). Telling d3d11 sessions apart from gl/metal/vulkan
// sessions in fleet data is the difference between "Windows is slow" and
// "D3D11 shader links are slow".
//
// Pure and table-tested: no DOM, no Three. Real-world string shapes covered
// by tests/angle_identity_core.test.ts.

export type AngleBackend =
  | 'd3d11on12'
  | 'd3d11'
  | 'd3d9'
  | 'opengl'
  | 'vulkan'
  | 'metal'
  | 'swiftshader'
  | 'warp';

export interface GlIdentity {
  raw: string;
  /** True when the string is ANGLE-shaped ("ANGLE (...)"). */
  angle: boolean;
  /**
   * The native API under the WebGL context. Null when the string does not
   * say (masked strings, bare adapter names, unknown shapes).
   */
  backend: AngleBackend | null;
  /** Cleaned adapter/device name, null when it cannot be told apart. */
  deviceName: string | null;
  /** Driver version when present (the D3D11-<version> suffix shape). */
  driverVersion: string | null;
}

// Ordered first-match-wins backend probes. Software rasterizers come first:
// SwiftShader advertises itself as a Vulkan device and WARP as a D3D11 one,
// and for diagnosis "software" beats the API it pretends to be.
const BACKEND_PROBES: ReadonlyArray<readonly [RegExp, AngleBackend]> = [
  [/swiftshader|subzero|llvmpipe/i, 'swiftshader'],
  [/microsoft basic render/i, 'warp'],
  [/direct3d11on12|d3d11on12/i, 'd3d11on12'],
  [/direct3d\s*11|d3d11/i, 'd3d11'],
  [/direct3d\s*9|d3d9/i, 'd3d9'],
  [/vulkan/i, 'vulkan'],
  [/metal/i, 'metal'],
  [/opengl|open gl/i, 'opengl'],
];

// Split "ANGLE (a, b, c)" body on top-level commas only: device segments nest
// parenthesized ids like "(0x00002704)" that a naive split would cut through.
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(body.slice(start).trim());
  return parts.filter((part) => part.length > 0);
}

function detectBackend(text: string): AngleBackend | null {
  for (const [pattern, backend] of BACKEND_PROBES) {
    if (pattern.test(text)) return backend;
  }
  return null;
}

// The device segment carries API noise the adapter name does not need:
// PCI-ish hex ids, shader model suffixes, the "ANGLE Metal Renderer:" and
// "Vulkan 1.x (...)" wrappers.
function cleanDeviceName(segment: string): string | null {
  let name = segment;
  const vulkanWrap = name.match(/vulkan\s[\d.]+\s*\((.*)\)$/i);
  if (vulkanWrap) name = vulkanWrap[1];
  name = name.replace(/^angle metal renderer:\s*/i, '');
  name = name.replace(/\(0x[0-9a-f]+\)/gi, ' ');
  name = name.replace(/direct3d\s*\d+(on12)?/gi, ' ');
  name = name.replace(/\b[vp]s_\d_\d\b/gi, ' ');
  name = name.replace(/\/pcie?\/sse2/gi, ' ');
  name = name.replace(/\s{2,}/g, ' ').trim();
  return name.length > 0 ? name : null;
}

function driverVersionFrom(body: string): string | null {
  // The trailing ANGLE segment shape: "D3D11-31.0.15.4633". Bare "D3D11" (no
  // version) is common and yields null.
  const d3d = body.match(/d3d\d+(?:on12)?-([\d.]+)/i);
  if (d3d) return d3d[1];
  return null;
}

export function parseGlIdentity(glRenderer: string): GlIdentity {
  const raw = glRenderer.trim();
  const identity: GlIdentity = {
    raw,
    angle: false,
    backend: null,
    deviceName: null,
    driverVersion: null,
  };
  if (raw.length === 0) return identity;

  const angleBody = raw.match(/^ANGLE\s*\((.*)\)\s*$/);
  if (!angleBody) {
    // Non-ANGLE strings (Firefox GL, Safari, bare adapter names). The whole
    // string is the device name; backend only when it names one.
    identity.backend = detectBackend(raw);
    identity.deviceName = cleanDeviceName(raw);
    return identity;
  }

  identity.angle = true;
  identity.backend = detectBackend(angleBody[1]);
  identity.driverVersion = driverVersionFrom(angleBody[1]);
  const segments = splitTopLevel(angleBody[1]);
  // Canonical modern shape: "vendor, device ..., driver". Two-segment and
  // one-segment shapes exist in the wild; the device is the widest middle
  // segment or the only one.
  const deviceSegment =
    segments.length >= 2
      ? segments.slice(1, Math.max(2, segments.length - 1)).join(', ')
      : segments[0];
  identity.deviceName = deviceSegment ? cleanDeviceName(deviceSegment) : null;
  return identity;
}

/** The short token the perf beacon ships (backend or a coarse fallback). */
export function angleBackendToken(identity: GlIdentity): string | null {
  if (identity.backend) return identity.backend;
  if (identity.angle) return 'angle-unknown';
  return null;
}
