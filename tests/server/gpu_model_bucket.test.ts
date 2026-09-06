// Pure coverage for server/gpu_model_bucket.ts. The corpus below is REAL
// UNMASKED_RENDERER_WEBGL text from the fleet (ANGLE D3D11, ANGLE Metal, ANGLE
// GL, ANGLE Vulkan, and the two bare mobile forms), because every trap in this
// module is a spelling trap: the trademark marks between vendor and model, the
// PCI device id in parentheses, the driver-version tail, the Vulkan string that
// nests the real renderer inside another one, and the SKU suffixes that
// sometimes ride the number and sometimes do not.
import { describe, expect, it } from 'vitest';
import {
  GL_MODEL_MAX,
  GL_MODEL_OTHER,
  GL_MODEL_SOFTWARE,
  glLaptop,
  glModel,
} from '../../server/gpu_model_bucket';

const NVIDIA_4070_LAPTOP =
  'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Laptop GPU (0x000028A0) Direct3D11 vs_5_0 ps_5_0, D3D11-32.0.15.6094)';
const NVIDIA_3060_DESKTOP =
  'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const NVIDIA_3090_GL =
  'ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3090/PCIe/SSE2, OpenGL 4.5.0)';
const NVIDIA_3060_VULKAN =
  'ANGLE (NVIDIA, Vulkan 1.3.0 (NVIDIA GeForce RTX 3060 (0x00002504)), NVIDIA-560.35.3)';
const INTEL_IRIS_XE =
  'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.101.4502)';
const INTEL_UHD_630 =
  'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.101.2125)';
const AMD_IGPU =
  'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001681) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const AMD_6700_XT =
  'ANGLE (AMD, AMD Radeon RX 6700 XT (0x000073DF) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const AMD_7700S =
  'ANGLE (AMD, AMD Radeon RX 7700S (0x00007480) Direct3D11 vs_5_0 ps_5_0, D3D11-32.0.12033.1030)';
const APPLE_M4_PRO = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)';
const MICROSOFT_BASIC =
  'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)';
const MALI = 'Mali-G78 MP20';
const ADRENO = 'Adreno (TM) 740';

describe('glModel', () => {
  it('separates the NVIDIA parts the vendor bucket collapses into one key', () => {
    // The whole reason this module exists: bucketGpu answers 'nvidia' for all
    // four of these, so the fleet cannot tell a laptop 4070 from a desktop 3060.
    expect(glModel(NVIDIA_4070_LAPTOP)).toBe('nvidia-rtx-4070');
    expect(glModel(NVIDIA_3060_DESKTOP)).toBe('nvidia-rtx-3060');
    expect(glModel(NVIDIA_3090_GL)).toBe('nvidia-rtx-3090');
    // The Vulkan form nests the real renderer inside the ANGLE wrapper, and its
    // "1.3.0" must never be mistaken for a model number.
    expect(glModel(NVIDIA_3060_VULKAN)).toBe('nvidia-rtx-3060');
    expect(glModel('ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 (0x00001F91) Direct3D11)')).toBe(
      'nvidia-gtx-1650',
    );
  });

  it('keeps the NVIDIA Ti and SUPER suffixes, in order, as part of the SKU', () => {
    expect(glModel('NVIDIA GeForce RTX 4070 Ti SUPER (0x00002705) Direct3D11')).toBe(
      'nvidia-rtx-4070-ti-super',
    );
    expect(glModel('NVIDIA GeForce RTX 3060 Ti (0x00002486) Direct3D11')).toBe(
      'nvidia-rtx-3060-ti',
    );
    // "Laptop GPU" is a form-factor marker, never a suffix on the key.
    expect(glModel('NVIDIA GeForce RTX 3080 Laptop GPU (0x0000249C)')).toBe('nvidia-rtx-3080');
  });

  it('parses Intel through the (R) marks that sit between vendor and model', () => {
    expect(glModel(INTEL_IRIS_XE)).toBe('intel-iris-xe');
    expect(glModel(INTEL_UHD_630)).toBe('intel-uhd-630');
    expect(
      glModel('ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11, D3D11-31.0.101)'),
    ).toBe('intel-arc-a770');
    expect(glModel('ANGLE (Intel, Intel(R) Iris(R) Plus Graphics 655, D3D11)')).toBe(
      'intel-iris-plus-655',
    );
    expect(glModel('ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D11, D3D11)')).toBe(
      'intel-hd-4000',
    );
  });

  it('reads the AMD form factor out of the SKU suffix', () => {
    // XT is its own token after a space; S rides the number with none.
    expect(glModel(AMD_6700_XT)).toBe('amd-rx-6700-xt');
    expect(glModel(AMD_7700S)).toBe('amd-rx-7700s');
    expect(glModel('ANGLE (AMD, AMD Radeon RX 7900 XTX (0x0000744C), D3D11)')).toBe(
      'amd-rx-7900-xtx',
    );
    // A trailing word that merely STARTS with a suffix letter is not a suffix.
    expect(glModel('ANGLE (AMD, AMD Radeon RX 580 Series (0x000067DF), D3D11)')).toBe('amd-rx-580');
    // The integrated parts ship no model number at all.
    expect(glModel(AMD_IGPU)).toBe('amd-radeon-igpu');
    expect(glModel('ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics (0x000015D8), D3D11)')).toBe(
      'amd-radeon-igpu',
    );
  });

  it('reads Apple silicon, and the mobile SoCs, off their bare strings', () => {
    expect(glModel(APPLE_M4_PRO)).toBe('apple-m4-pro');
    expect(glModel('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)')).toBe(
      'apple-m2',
    );
    expect(glModel('ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, Unspecified Version)')).toBe(
      'apple-m1-max',
    );
    expect(glModel(ADRENO)).toBe('qualcomm-adreno-740');
    expect(glModel(MALI)).toBe('arm-mali-g78');
  });

  it('answers software for every CPU rasterizer, whatever vendor it emulates', () => {
    expect(glModel(MICROSOFT_BASIC)).toBe(GL_MODEL_SOFTWARE);
    expect(glModel('Google SwiftShader')).toBe(GL_MODEL_SOFTWARE);
    expect(
      glModel(
        'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
      ),
    ).toBe(GL_MODEL_SOFTWARE);
    expect(glModel('Mesa/X.org, llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(GL_MODEL_SOFTWARE);
  });

  it('falls back to the vendor when the model is unrecognised, and to other when the vendor is', () => {
    // A vendor-only key still segments the fleet; inventing a model would not.
    expect(glModel('ANGLE (NVIDIA, NVIDIA Quadro P2000 (0x00001C30), D3D11)')).toBe('nvidia');
    expect(glModel('ANGLE (Intel, Intel(R) Graphics Media Accelerator, D3D11)')).toBe('intel');
    expect(glModel('ANGLE (AMD, AMD Radeon Pro WX 3200, D3D11)')).toBe('amd');
    expect(glModel('ANGLE (Apple, Apple GPU, Unspecified Version)')).toBe('apple');
    // A fingerprint-resistant browser reports a randomised or generic string;
    // there is nothing to read out of it, and guessing would poison the dimension.
    expect(glModel('Brave')).toBe(GL_MODEL_OTHER);
    expect(glModel('WebKit WebGL')).toBe(GL_MODEL_OTHER);
    expect(glModel('')).toBe(GL_MODEL_OTHER);
    expect(glModel('   ')).toBe(GL_MODEL_OTHER);
  });

  it('bounds the KEY SPACE, not just the key length, against a hostile beacon', () => {
    // gl_model is a GROUPED column in the admin summary, so cardinality is the
    // attack surface, not string length: a client that can mint unboundedly
    // many DISTINCT short keys blows up the grouping just as effectively as one
    // long key would. Every captured run is length-bounded for that reason.
    // A digit run past the bound simply does not match the chip pattern.
    expect(glModel('ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro)')).toBe('apple-m4-pro');
    expect(glModel('ANGLE (Apple, ANGLE Metal Renderer: Apple M99)')).toBe('apple-m99');
    expect(glModel('ANGLE (Apple, ANGLE Metal Renderer: Apple M123456789)')).toBe('apple');
    // The NVIDIA suffix run is a `*` over client text: it is rebuilt from a
    // fixed token list, deduped and reordered, so repetition cannot mint a new
    // key per repetition.
    expect(glModel('NVIDIA GeForce RTX 4090 Ti Ti Ti Ti Ti SUPER SUPER Ti')).toBe(
      'nvidia-rtx-4090-ti-super',
    );
    expect(glModel('NVIDIA GeForce RTX 4090 SUPER Ti')).toBe('nvidia-rtx-4090-ti-super');
    expect(glModel('NVIDIA GeForce RTX 4090 super')).toBe('nvidia-rtx-4090-super');
    // The same repetition through the WHOLE corpus of shapes: a hostile beacon
    // gets at most the keys the fixed token lists can spell.
    const repeated = new Set(
      [3, 12, 40, 90].map((n) => glModel(`NVIDIA GeForce RTX 4090${' Ti'.repeat(n)}`)),
    );
    expect([...repeated]).toEqual(['nvidia-rtx-4090-ti']);
  });

  it('holds the closed key shape for hostile input, never echoing the string back', () => {
    const hostile = [
      `${'A'.repeat(400)} NVIDIA GeForce RTX ${'9'.repeat(80)}`,
      '<script>alert(1)</script>',
      "'; DROP TABLE client_perf_reports; --",
      'nvidia  geforce rtx 4090',
      '\u00e9\u4e2d '.repeat(60),
      'RTX '.repeat(200),
    ];
    for (const input of hostile) {
      const key = glModel(input);
      expect(key).toMatch(/^[a-z0-9-]+$/);
      expect(key.length).toBeLessThanOrEqual(GL_MODEL_MAX);
      // Never ends on a separator, including when the ceiling cut it.
      expect(key.endsWith('-')).toBe(false);
    }
    // A non-string reaching the sanitizer must not throw either.
    expect(glModel(undefined as unknown as string)).toBe(GL_MODEL_OTHER);
    expect(glModel(null as unknown as string)).toBe(GL_MODEL_OTHER);
  });
});

// The contract the admin summary's high-performance-adapter mismatch rests on
// (server/admin_db.ts): the LEADING segment of a key is the vendor, and the
// predicate compares only that segment because a browser's WebGPU adapter info
// usually reaches no further. Chrome fills GPUAdapterInfo.device and
// .description only behind its WebGPUDeveloperFeatures runtime flag, so a
// normal page's adapter text is the {vendor, architecture} pair below and the
// same parser answers a vendor-only key for it.
describe('the vendor segment the mismatch predicate compares', () => {
  const vendorOf = (renderer: string): string => glModel(renderer).split('-')[0];

  it('keys every recognised family on a closed vendor vocabulary', () => {
    const corpus = [
      NVIDIA_4070_LAPTOP,
      NVIDIA_3060_DESKTOP,
      NVIDIA_3090_GL,
      NVIDIA_3060_VULKAN,
      'ANGLE (NVIDIA, NVIDIA Quadro P2000 (0x00001C30), D3D11)',
      INTEL_IRIS_XE,
      INTEL_UHD_630,
      'ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics, D3D11)',
      AMD_IGPU,
      AMD_6700_XT,
      AMD_7700S,
      APPLE_M4_PRO,
      'ANGLE (Apple, Apple GPU, Unspecified Version)',
      MALI,
      ADRENO,
      MICROSOFT_BASIC,
      'Brave',
      '',
    ];
    const vendors = new Set(corpus.map(vendorOf));
    // Exact, not a superset check: a new family pattern that mints a key on
    // some other leading word would silently change what the SQL compares.
    expect([...vendors].sort()).toEqual([
      'amd',
      'apple',
      'arm',
      'intel',
      'nvidia',
      GL_MODEL_OTHER,
      'qualcomm',
      GL_MODEL_SOFTWARE,
    ]);
  });

  it('agrees with the vendor-only key a default Chrome adapter produces', () => {
    // These four are what describeGpuAdapterInfo joins on a default Chrome for
    // a SINGLE-GPU machine: vendor plus architecture, device and description
    // empty. Compared whole, each of them disagrees with its own machine's
    // WebGL model and would be filed as a mismatch; compared on the vendor
    // segment, none of them is.
    const singleGpuMachines: [string, string][] = [
      [APPLE_M4_PRO, 'apple metal-3'],
      [NVIDIA_4070_LAPTOP, 'nvidia ampere'],
      [INTEL_IRIS_XE, 'intel gen-12lp'],
      [AMD_6700_XT, 'amd rdna-2'],
    ];
    for (const [renderer, adapter] of singleGpuMachines) {
      expect(glModel(adapter)).not.toBe(glModel(renderer));
      expect(vendorOf(adapter)).toBe(vendorOf(renderer));
    }
  });

  it('still separates the hybrid the column exists to find', () => {
    // The iGPU renders the page while a discrete part answers the WebGPU
    // high-performance hint: different vendors, so the row is a real mismatch.
    expect(vendorOf('nvidia ampere')).not.toBe(vendorOf(INTEL_IRIS_XE));
    expect(vendorOf('nvidia ada-lovelace')).not.toBe(vendorOf(AMD_IGPU));
    // A CPU rasterizer beside a real adapter is a mismatch too, and the most
    // actionable one there is, so 'software' is not excluded from the list.
    expect(vendorOf(MICROSOFT_BASIC)).toBe(GL_MODEL_SOFTWARE);
    expect(vendorOf(MICROSOFT_BASIC)).not.toBe(vendorOf('nvidia ampere'));
  });
});

describe('glLaptop', () => {
  it('is true only on a vendor-written mobile marker or a mobile SKU suffix', () => {
    expect(glLaptop(NVIDIA_4070_LAPTOP)).toBe(true);
    expect(glLaptop('NVIDIA GeForce RTX 2080 with Max-Q Design (0x00001E90)')).toBe(true);
    expect(glLaptop('NVIDIA GeForce RTX 3080 Mobile (0x0000249C)')).toBe(true);
    // AMD writes the form factor into the SKU instead of a marker word.
    expect(glLaptop(AMD_7700S)).toBe(true);
    expect(glLaptop('ANGLE (AMD, AMD Radeon RX 6800M (0x000073EF), D3D11)')).toBe(true);
    expect(glLaptop('ANGLE (Intel, Intel(R) Arc(TM) A370M Graphics, D3D11)')).toBe(true);
  });

  it('is false only for a part recognised AS a discrete desktop card', () => {
    expect(glLaptop(NVIDIA_3060_DESKTOP)).toBe(false);
    expect(glLaptop(NVIDIA_3090_GL)).toBe(false);
    expect(glLaptop(AMD_6700_XT)).toBe(false);
    expect(glLaptop('ANGLE (AMD, AMD Radeon RX 580 Series (0x000067DF), D3D11)')).toBe(false);
    expect(glLaptop('ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics, D3D11)')).toBe(false);
  });

  it('is null wherever the string cannot decide, which is the common case', () => {
    // Integrated parts ship in both form factors.
    expect(glLaptop(INTEL_IRIS_XE)).toBe(null);
    expect(glLaptop(INTEL_UHD_630)).toBe(null);
    expect(glLaptop(AMD_IGPU)).toBe(null);
    // One package: the question does not apply.
    expect(glLaptop(APPLE_M4_PRO)).toBe(null);
    expect(glLaptop(MALI)).toBe(null);
    expect(glLaptop(ADRENO)).toBe(null);
    // No renderer, no rasterizer form factor, no vendor evidence.
    expect(glLaptop('')).toBe(null);
    expect(glLaptop(MICROSOFT_BASIC)).toBe(null);
    expect(glLaptop('Brave')).toBe(null);
    // A recognised vendor with an unrecognised model claims nothing.
    expect(glLaptop('ANGLE (NVIDIA, NVIDIA Quadro P2000 (0x00001C30), D3D11)')).toBe(null);
  });

  it('never claims a form factor for an Apple or SoC string that carries a marker word', () => {
    // The undecidable classes are checked BEFORE the marker words, so a stray
    // "Mobile" in an Apple or Adreno string cannot manufacture a true.
    expect(glLaptop('ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Mobile)')).toBe(null);
    expect(glLaptop('Adreno (TM) 740 Mobile')).toBe(null);
  });
});
