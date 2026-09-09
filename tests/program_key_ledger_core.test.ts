// The program-key ledger core: three's cache key parsed into named fields,
// programs grouped by material identity, the differing renderer-state field
// named per group. Node-only (RENDER_PURE_CORES): no Three, no DOM.
//
// The layout pin at the end reads the shipped three build, so a three bump
// that reorders `getProgramCacheKeyParameters` or the boolean masks fails
// HERE, by name, instead of silently mis-attributing a variant pair.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  groupProgramKeyVariants,
  type ProgramKeyLedgerRecord,
  parseThreeProgramCacheKey,
  RENDERER_OUTPUT_COLOR_SPACE_FIELD,
  RENDERER_STATE_FIELDS,
  summarizeProgramKeyVariants,
  THREE_PROGRAM_KEY_MASK_A,
  THREE_PROGRAM_KEY_MASK_B,
  THREE_PROGRAM_KEY_PARAMETERS,
  variantSignature,
} from '../src/render/program_key_ledger_core';

/** Builds a key the way three does: head, the parameter block, two masks,
 *  the renderer color space, the custom key. Overrides name fields. */
function key(
  overrides: Partial<Record<string, string | number>> = {},
  options: { head?: string[]; custom?: string; bitsA?: string[]; bitsB?: string[] } = {},
): string {
  const head = options.head ?? ['physical', 'USE_FOO', '1'];
  const params = THREE_PROGRAM_KEY_PARAMETERS.map((name) => {
    if (name in overrides) return String(overrides[name]);
    if (name === 'precision') return 'highp';
    if (name === 'outputColorSpace') return 'srgb';
    if (name === 'envMapMode') return '306';
    if (name === 'envMapCubeUVHeight') return '512';
    if (name === 'mapUv') return 'uv';
    if (name.endsWith('MapUv')) return '';
    if (name === 'numDirLights' || name === 'numHemiLights') return '1';
    if (name === 'numPointLights') return '8';
    if (name === 'shadowMapType') return '1';
    if (name === 'toneMapping') return '4';
    return '0';
  });
  const mask = (names: readonly string[], on: string[]): number =>
    names.reduce((m, name, bit) => (on.includes(name) ? m | (1 << bit) : m), 0);
  const maskA = mask(THREE_PROGRAM_KEY_MASK_A, options.bitsA ?? ['envMap', 'vertexNormals']);
  const maskB = mask(
    THREE_PROGRAM_KEY_MASK_B,
    options.bitsB ?? ['fog', 'useFog', 'shadowMapEnabled'],
  );
  const rendererColorSpace = String(overrides[RENDERER_OUTPUT_COLOR_SPACE_FIELD] ?? 'srgb');
  const custom = options.custom ?? 'onBeforeCompile() {}';
  return [...head, ...params, maskA, maskB, rendererColorSpace, custom].join(',');
}

const record = (k: string, atMs: number, label = ''): ProgramKeyLedgerRecord => ({
  key: k,
  atMs,
  label,
});

describe('parseThreeProgramCacheKey', () => {
  it('names every parameter, every mask bit and the trailing color space', () => {
    const parsed = parseThreeProgramCacheKey(key({ numPointLights: 12, toneMapping: 0 }));
    expect(parsed.raw).toBe(false);
    expect(parsed.shader).toBe('physical');
    expect(parsed.fields.precision).toBe('highp');
    expect(parsed.fields.numPointLights).toBe('12');
    expect(parsed.fields.toneMapping).toBe('0');
    expect(parsed.fields.mapUv).toBe('uv');
    expect(parsed.fields.envMap).toBe('1');
    expect(parsed.fields.instancing).toBe('0');
    expect(parsed.fields.fog).toBe('1');
    expect(parsed.fields.skinning).toBe('0');
    expect(parsed.fields[RENDERER_OUTPUT_COLOR_SPACE_FIELD]).toBe('srgb');
    expect(Object.keys(parsed.fields)).toHaveLength(
      THREE_PROGRAM_KEY_PARAMETERS.length +
        THREE_PROGRAM_KEY_MASK_A.length +
        THREE_PROGRAM_KEY_MASK_B.length +
        1,
    );
  });

  it('keeps a custom cache key with commas whole, inside the identity', () => {
    const custom = 'surface-detail|granite|on|p8c4|-|-|w|f1,2|prev,src|onBeforeCompile() {}';
    const parsed = parseThreeProgramCacheKey(key({}, { custom }));
    expect(parsed.identity.endsWith(`|${custom}`)).toBe(true);
    expect(parsed.fields.numPointLights).toBe('8');
  });

  it('puts material-side fields in the identity and renderer-side fields out of it', () => {
    const base = parseThreeProgramCacheKey(key());
    const otherLights = parseThreeProgramCacheKey(key({ numPointLights: 9 }));
    const otherMap = parseThreeProgramCacheKey(key({ normalMapUv: 'uv' }));
    const otherBit = parseThreeProgramCacheKey(
      key({}, { bitsA: ['envMap', 'vertexNormals', 'vertexColors'] }),
    );
    const otherDefine = parseThreeProgramCacheKey(key({}, { head: ['physical', 'USE_FOO', '2'] }));
    expect(otherLights.identity).toBe(base.identity);
    expect(otherMap.identity).not.toBe(base.identity);
    expect(otherBit.identity).not.toBe(base.identity);
    expect(otherDefine.identity).not.toBe(base.identity);
    for (const name of RENDERER_STATE_FIELDS) {
      expect(base.identity.includes(`${name}=`)).toBe(false);
    }
  });

  it('returns a raw ShaderMaterial key whole, as its own identity', () => {
    const raw = '12,13,my-custom-key';
    const parsed = parseThreeProgramCacheKey(raw);
    expect(parsed.raw).toBe(true);
    expect(parsed.identity).toBe(raw);
    expect(parsed.fields).toEqual({});
  });

  it('accepts a custom shader head (two ids) and a linear color space', () => {
    const parsed = parseThreeProgramCacheKey(
      key({ outputColorSpace: 'srgb-linear' }, { head: ['12', '13'] }),
    );
    expect(parsed.raw).toBe(false);
    expect(parsed.shader).toBe('12');
    expect(parsed.fields.outputColorSpace).toBe('srgb-linear');
  });
});

describe('groupProgramKeyVariants', () => {
  it('names the renderer-state field two programs of one material differ by', () => {
    const groups = groupProgramKeyVariants([
      record(key({ numPointLights: 8 }), 100, 'compile:scene'),
      record(key({ numPointLights: 9 }), 250, 'live'),
      record(key({}, { head: ['basic'] }), 300),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].shader).toBe('physical');
    expect(groups[0].differing).toEqual(['numPointLights']);
    expect(groups[0].members.map((m) => [m.atMs, m.label, m.values[0]])).toEqual([
      [100, 'compile:scene', '8'],
      [250, 'live', '9'],
    ]);
    expect(variantSignature(groups[0])).toBe('numPointLights');
  });

  it('names every differing field of a render-target variant pair', () => {
    const groups = groupProgramKeyVariants([
      record(key(), 1),
      record(key({ toneMapping: 0, outputColorSpace: 'srgb-linear' }), 2),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].differing).toEqual(['outputColorSpace', 'toneMapping']);
    expect(variantSignature(groups[0])).toBe('outputColorSpace+toneMapping');
  });

  it('reports a byte-identical key linked twice as a relink, not a variant', () => {
    const groups = groupProgramKeyVariants([record(key(), 1), record(key(), 900)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].differing).toEqual([]);
    expect(variantSignature(groups[0])).toBe('relink');
  });

  it('never groups two different materials, whatever their renderer state', () => {
    const groups = groupProgramKeyVariants([
      record(key({ numPointLights: 8 }), 1),
      record(key({ numPointLights: 9 }, { head: ['physical', 'USE_BAR', '1'] }), 2),
      record(key({ numPointLights: 9 }, { custom: 'other' }), 3),
    ]);
    expect(groups).toEqual([]);
  });

  it('summarizes extra programs per signature', () => {
    const records = [
      record(key({ numPointLights: 8 }), 1),
      record(key({ numPointLights: 9 }), 2),
      record(key({ numPointLights: 10 }), 3),
      record(key({}, { head: ['basic'] }), 4),
      record(key({ toneMapping: 0, outputColorSpace: 'srgb-linear' }, { head: ['basic'] }), 5),
      record(key({}, { head: ['sprite'] }), 6),
    ];
    const summary = summarizeProgramKeyVariants(records);
    expect(summary).toEqual({
      programs: 6,
      groups: 2,
      extraPrograms: 3,
      bySignature: {
        numPointLights: { groups: 1, extraPrograms: 2 },
        'outputColorSpace+toneMapping': { groups: 1, extraPrograms: 1 },
      },
    });
  });
});

describe('the layout follows the shipped three build', () => {
  const three = readFileSync('node_modules/three/build/three.module.js', 'utf8');
  const body = (name: string): string => {
    const start = three.indexOf(`function ${name}(`);
    expect(start).toBeGreaterThan(0);
    const end = three.indexOf('\n\t}\n', start);
    return three.slice(start, end);
  };

  it('pins the parameter push order of getProgramCacheKeyParameters', () => {
    const pushed = [
      ...body('getProgramCacheKeyParameters').matchAll(/array\.push\( parameters\.(\w+) \)/g),
    ].map((m) => m[1]);
    expect(pushed).toEqual([...THREE_PROGRAM_KEY_PARAMETERS]);
  });

  it('pins the bit order of both boolean masks', () => {
    const source = body('getProgramCacheKeyBooleans');
    const [first, second] = source.split('array.push( _programLayers.mask );');
    const bits = (s: string) =>
      [...s.matchAll(/if \( parameters\.(\w+)(?: > 0)? \)/g)].map((m) => m[1]);
    expect(bits(first)).toEqual([...THREE_PROGRAM_KEY_MASK_A]);
    expect(bits(second)).toEqual([...THREE_PROGRAM_KEY_MASK_B]);
  });

  it('pins the tail: two masks, the renderer color space, the custom key', () => {
    const source = body('getProgramCacheKey');
    expect(source).toContain('getProgramCacheKeyParameters( array, parameters );');
    expect(source).toContain('getProgramCacheKeyBooleans( array, parameters );');
    expect(source).toContain('array.push( renderer.outputColorSpace );');
    expect(source).toContain('array.push( parameters.customProgramCacheKey );');
    expect(source).toContain('return array.join();');
  });
});
