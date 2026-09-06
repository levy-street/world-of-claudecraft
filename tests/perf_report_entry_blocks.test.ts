import { describe, expect, it } from 'vitest';
import {
  sanitizeBootPhases,
  sanitizePostRevealLinks,
  sanitizeShaderWarm,
  shaderWarmToken,
} from '../server/perf_report_entry_blocks';

describe('sanitizePostRevealLinks', () => {
  it('drops anything that is not a record, and an empty record too', () => {
    expect(sanitizePostRevealLinks(null)).toBeUndefined();
    expect(sanitizePostRevealLinks('x')).toBeUndefined();
    expect(sanitizePostRevealLinks([1])).toBeUndefined();
    // No windowMs, no window: an empty object must not become a zero row.
    expect(sanitizePostRevealLinks({})).toBeUndefined();
    expect(sanitizePostRevealLinks({ windowMs: '' })).toBeUndefined();
  });

  it('drops a window whose gating field is not a number, coercible or not', () => {
    // Number(false) and Number([]) are both 0, so a coercing gate would plant a
    // zero-window row for a payload that carries no window at all.
    expect(sanitizePostRevealLinks({ windowMs: false })).toBeUndefined();
    expect(sanitizePostRevealLinks({ windowMs: true })).toBeUndefined();
    expect(sanitizePostRevealLinks({ windowMs: [] })).toBeUndefined();
    expect(sanitizePostRevealLinks({ windowMs: [12] })).toBeUndefined();
    expect(sanitizePostRevealLinks({ windowMs: '12' })).toBeUndefined();
    expect(sanitizePostRevealLinks({ windowMs: null })).toBeUndefined();
    expect(sanitizePostRevealLinks({ windowMs: Number.NaN })).toBeUndefined();
    // A real number still opens the block, whatever the rest of it says.
    expect(sanitizePostRevealLinks({ windowMs: 0 })?.windowMs).toBe(0);
    expect(sanitizePostRevealLinks({ windowMs: 20_000 })?.windowMs).toBe(20_000);
  });

  it('keeps a well-formed client block verbatim', () => {
    const block = {
      reveals: 1,
      revealsInWindow: 1,
      windowMs: 20_000,
      programsAtReveal: 1187,
      programsGained: 63,
      samples: 1180,
      unsampledMs: 0,
      closed: true,
      baselineLost: false,
    };
    expect(sanitizePostRevealLinks(block)).toEqual(block);
  });

  it('bounds every number, floors to ints, and reads the flags as strict booleans', () => {
    expect(
      sanitizePostRevealLinks({
        reveals: -3,
        revealsInWindow: 1e9,
        windowMs: 1e12,
        programsAtReveal: 'NaN',
        programsGained: 1e9,
        samples: 12.7,
        unsampledMs: -40,
        closed: 'true',
        baselineLost: 1,
        extra: ['not', 'kept'],
      }),
    ).toEqual({
      reveals: 0,
      revealsInWindow: 10_000,
      windowMs: 600_000,
      programsAtReveal: 0,
      programsGained: 100_000,
      samples: 12,
      unsampledMs: 0,
      closed: false,
      baselineLost: false,
    });
  });
});

describe('sanitizeBootPhases', () => {
  it('drops a block without a finite entry root', () => {
    expect(sanitizeBootPhases(null)).toBeUndefined();
    expect(sanitizeBootPhases({})).toBeUndefined();
    expect(sanitizeBootPhases({ rendererCtorMs: 5 })).toBeUndefined();
    expect(sanitizeBootPhases({ entryMs: 'soon' })).toBeUndefined();
    expect(sanitizeBootPhases({ entryMs: '' })).toBeUndefined();
  });

  it('drops a block whose entry root is not a number, coercible or not', () => {
    expect(sanitizeBootPhases({ entryMs: false })).toBeUndefined();
    expect(sanitizeBootPhases({ entryMs: true })).toBeUndefined();
    expect(sanitizeBootPhases({ entryMs: [] })).toBeUndefined();
    expect(sanitizeBootPhases({ entryMs: [6120] })).toBeUndefined();
    expect(sanitizeBootPhases({ entryMs: '6120' })).toBeUndefined();
    expect(sanitizeBootPhases({ entryMs: null })).toBeUndefined();
    expect(sanitizeBootPhases({ entryMs: Number.NaN })).toBeUndefined();
    // The non-gating phases keep their coercing bound: only the root gates.
    expect(sanitizeBootPhases({ entryMs: 6120, rendererCtorMs: '813' })?.rendererCtorMs).toBe(813);
  });

  it('keeps the phases, null per unstamped phase, and bounds a hostile span', () => {
    expect(
      sanitizeBootPhases({
        entryMs: 6120,
        rendererCtorMs: 813,
        prepareZoneMs: null,
        prepareNeighborsMs: 1e9,
        prewarmInitialMs: -1,
        list: [1, 2, 3],
      }),
    ).toEqual({
      entryMs: 6120,
      rendererCtorMs: 813,
      prepareZoneMs: null,
      prepareNeighborsMs: 1_800_000,
      prewarmInitialMs: 0,
    });
  });

  it('maps an empty string to null like the sibling nullable bound', () => {
    expect(sanitizeBootPhases({ entryMs: 10, prepareZoneMs: '' })?.prepareZoneMs).toBeNull();
  });
});

describe('shaderWarmToken', () => {
  it('keeps the cause tokens the warm-up client mints', () => {
    for (const token of [
      'ready-timeout',
      'ios-webkit',
      'pagehide',
      'no-worker',
      'worker-error',
      'context-lost',
      'no-offscreen-canvas',
      'hold-timeouts:expired-share',
      'cannot-serve:hold-cap',
      'extension-drift:ext_color_buffer_float',
    ]) {
      expect(shaderWarmToken(token)).toBe(token);
    }
  });

  it('lowercases so a driver-cased extension name survives instead of being dropped', () => {
    expect(shaderWarmToken('extension-drift:EXT_color_buffer_float')).toBe(
      'extension-drift:ext_color_buffer_float',
    );
    expect(shaderWarmToken('  ready-timeout  ')).toBe('ready-timeout');
  });

  it('rejects anything outside the token charset whole, never half-sanitized', () => {
    for (const hostile of [
      'ready timeout',
      'drop table client_perf_reports',
      'refus\u00e9',
      '<script>',
      'a.b',
      '',
      '   ',
      42,
      true,
      null,
      undefined,
      ['ready-timeout'],
      { refusal: 'ready-timeout' },
    ]) {
      expect(shaderWarmToken(hostile)).toBe('');
    }
  });

  it('carries a whole extension-drift token, the longest cause the client mints', () => {
    // The refusal that names WHICH extension drifted is the one cause with a
    // real payload, and the longest WebGL extension name takes it to 50
    // characters: a bound that cut it would leave the fleet a column that
    // never says which one.
    const longest = 'extension-drift:webgl_compressed_texture_s3tc_srgb';
    expect(longest.length).toBe(50);
    expect(shaderWarmToken(longest)).toBe(longest);
  });

  it('bounds the token at 64 characters, on a value whose charset already passed', () => {
    expect(shaderWarmToken('a'.repeat(200))).toBe('a'.repeat(64));
    expect(shaderWarmToken(`extension-drift:${'x'.repeat(200)}`)).toHaveLength(64);
  });

  it('reads the charset over the whole value, never over the part that fits', () => {
    // Slicing first would store the clean prefix of a hostile value and call
    // it a cause token; the charset decides on everything that arrived.
    const smuggled = `${'a'.repeat(64)}<script>`;
    expect(shaderWarmToken(smuggled)).toBe('');
  });
});

describe('sanitizeShaderWarm', () => {
  it('drops anything that is not a record carrying a mode token', () => {
    expect(sanitizeShaderWarm(null)).toBeUndefined();
    expect(sanitizeShaderWarm('all')).toBeUndefined();
    expect(sanitizeShaderWarm(['all'])).toBeUndefined();
    expect(sanitizeShaderWarm({})).toBeUndefined();
    expect(sanitizeShaderWarm({ mode: 1 })).toBeUndefined();
    expect(sanitizeShaderWarm({ mode: true })).toBeUndefined();
    expect(sanitizeShaderWarm({ mode: 'not a mode' })).toBeUndefined();
    // Every other field present cannot make up for the missing mode.
    expect(sanitizeShaderWarm({ active: true, worker: 'ready', warmed: 12 })).toBeUndefined();
  });

  it('keeps a well-formed client block on its known keys only', () => {
    expect(
      sanitizeShaderWarm({
        active: true,
        worker: 'ready',
        refusal: '',
        mode: 'all',
        setting: 'auto',
        backend: 'd3d11',
        warmed: 137,
        held: 42,
        heldTimedOut: 3,
        planted: 'x'.repeat(4000),
        links: [1, 2, 3],
      }),
    ).toEqual({
      active: true,
      worker: 'ready',
      refusal: '',
      mode: 'all',
      setting: 'auto',
      backend: 'd3d11',
      warmed: 137,
      held: 42,
      heldTimedOut: 3,
    });
  });

  it('bounds the counts, floors them, and reads active as a strict boolean', () => {
    expect(
      sanitizeShaderWarm({
        active: 'yes',
        worker: 'x'.repeat(200),
        refusal: 'hold-timeouts:expired-share',
        mode: 'off',
        setting: { hostile: true },
        backend: null,
        warmed: 1e9,
        held: -5,
        heldTimedOut: 2.9,
      }),
    ).toEqual({
      active: false,
      worker: 'x'.repeat(64),
      refusal: 'hold-timeouts:expired-share',
      mode: 'off',
      setting: '',
      backend: '',
      warmed: 100_000,
      held: 0,
      heldTimedOut: 2,
    });
  });
});
