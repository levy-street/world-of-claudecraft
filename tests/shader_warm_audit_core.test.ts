// The shader warm audit's bookkeeping (src/render/shader_warm_audit_core.ts):
// the source hash, the announcements, and the classes a minted program falls
// in (matched, drifted, unexpected, out-of-band), plus the pending count.

import { describe, expect, it } from 'vitest';
import {
  parseThreeProgramCacheKey,
  THREE_PROGRAM_KEY_PARAMETERS,
} from '../src/render/program_key_ledger_core';
import {
  createShaderWarmAudit,
  describeMintedProgram,
  expectProgramSource,
  observeMintedProgram,
  programCustomKeyTail,
  programSourceHash,
  programUniformNames,
  SHADER_WARM_AUDIT_EXPECTED_LIMIT,
  SHADER_WARM_AUDIT_SAMPLE_LIMIT,
  SHADER_WARM_AUDIT_UNIFORM_LIMIT,
  shaderWarmAuditIdentity,
  shaderWarmAuditSummary,
} from '../src/render/shader_warm_audit_core';

/** three's own key layout: head, the parameter block, the two boolean masks,
 *  `renderer.outputColorSpace`, then `material.customProgramCacheKey()`. The
 *  head is the shader id for a built-in, the two custom shader ids for a
 *  ShaderMaterial. */
function threeKey(
  options: {
    head?: string[];
    custom?: string;
    outputColorSpace?: string;
    rendererOutputColorSpace?: string;
  } = {},
): string {
  const params = THREE_PROGRAM_KEY_PARAMETERS.map((name) => {
    if (name === 'precision') return 'highp';
    if (name === 'outputColorSpace') return options.outputColorSpace ?? 'srgb';
    // The shape a real key takes where nothing is bound: empty channel slots
    // next to zeroed counts, which is what a naive anchor trips over.
    if (name.endsWith('Uv')) return '';
    return '0';
  });
  return [
    ...(options.head ?? ['861151317', '2113470571']),
    ...params,
    0,
    0,
    options.rendererOutputColorSpace ?? 'srgb',
    options.custom ?? 'onBeforeCompile( /* shaderobject, renderer */ ) {}',
  ].join(',');
}

/** A hook a producer would actually install, commas and all. */
const HAZE_HOOK =
  'function (shader) {\n  shader.uniforms.uHazeColor = haze.color;\n' +
  '  shader.fragmentShader = shader.fragmentShader.replace(TOKEN, HAZE_GLSL);\n}';

/** three's ShaderMaterial fragment prefix plus a pass's own uniforms. */
const HAZE_FRAGMENT = [
  'precision highp float;',
  '#define SHADER_NAME ',
  'uniform mat4 viewMatrix;',
  'uniform vec3 cameraPosition;',
  'uniform bool isOrthographic;',
  'uniform sampler2D tDiffuse;',
  'uniform highp sampler2D tDepth;',
  'uniform vec2 uResolution;',
  'void main() { gl_FragColor = texture2D(tDiffuse, vUv); }',
].join('\n');

describe('the bounds the audit is sized by', () => {
  it('pins the announcement set and the readout sample limits to their literals', () => {
    // A login announces a few hundred keys and the readout ships its samples
    // whole, so both bounds are a payload decision, not a free knob: a silent
    // change here changes what a capture can say.
    expect(SHADER_WARM_AUDIT_EXPECTED_LIMIT).toBe(4096);
    expect(SHADER_WARM_AUDIT_SAMPLE_LIMIT).toBe(64);
  });
});

describe('programSourceHash', () => {
  it('is deterministic, 16 hex characters, and tells the two stages apart', () => {
    const hash = programSourceHash('void main() {}', 'precision highp float;');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(programSourceHash('void main() {}', 'precision highp float;')).toBe(hash);
    expect(programSourceHash('void main() {}', 'precision highp float; ')).not.toBe(hash);
    expect(programSourceHash('void main() {} ', 'precision highp float;')).not.toBe(hash);
    // The boundary is part of the hash: moving a character across it changes it.
    expect(programSourceHash('ab', 'c')).not.toBe(programSourceHash('a', 'bc'));
    expect(programSourceHash('', '')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('expectProgramSource', () => {
  it('announces a key once, keeps the first announcement, and bounds the set', () => {
    const audit = createShaderWarmAudit();
    expect(expectProgramSource(audit, { cacheKey: 'k', name: 'n', hash: 'h1' }, 'gate-a', 10)).toBe(
      'announced',
    );
    expect(expectProgramSource(audit, { cacheKey: 'k', name: 'n', hash: 'h2' }, 'gate-b', 20)).toBe(
      'known',
    );
    expect(audit.expected.get('k')).toMatchObject({ hash: 'h1', label: 'gate-a', atMs: 10 });
    for (let i = 1; i < SHADER_WARM_AUDIT_EXPECTED_LIMIT; i++) {
      expectProgramSource(audit, { cacheKey: `k${i}`, name: 'n', hash: 'h' }, 'g', 0);
    }
    expect(audit.expected.size).toBe(SHADER_WARM_AUDIT_EXPECTED_LIMIT);
    expect(expectProgramSource(audit, { cacheKey: 'over', name: 'n', hash: 'h' }, 'g', 0)).toBe(
      'dropped',
    );
    expect(audit.dropped).toBe(1);
  });
});

describe('observeMintedProgram', () => {
  it('matches a mint under an announced key with the announced hash, more than once', () => {
    const audit = createShaderWarmAudit();
    expectProgramSource(audit, { cacheKey: 'k', name: 'physical', hash: 'h' }, 'g', 0);
    expect(observeMintedProgram(audit, { cacheKey: 'k', name: 'physical', hash: 'h' })).toBe(
      'matched',
    );
    expect(observeMintedProgram(audit, { cacheKey: 'k', name: 'physical', hash: 'h' })).toBe(
      'matched',
    );
    expect(audit.matched).toBe(2);
    expect(audit.expected.get('k')?.matched).toBe(2);
    expect(shaderWarmAuditSummary(audit).pending).toBe(0);
  });

  it('records a drift when the key matches but the GLSL does not, with the announcing gate', () => {
    const audit = createShaderWarmAudit();
    expectProgramSource(audit, { cacheKey: 'k', name: 'physical', hash: 'dry' }, 'cull:2', 0);
    expect(observeMintedProgram(audit, { cacheKey: 'k', name: 'physical', hash: 'live' })).toBe(
      'drifted',
    );
    expect(audit.drifted).toBe(1);
    expect(audit.drifts).toEqual([
      {
        cacheKey: 'k',
        name: 'physical',
        label: 'cull:2',
        expectedHash: 'dry',
        mintedHash: 'live',
        nameOnly: false,
      },
    ]);
    // A drifted announcement is still pending: nothing matched it.
    expect(shaderWarmAuditSummary(audit).pending).toBe(1);
  });

  it('bounds the drift samples but not the count', () => {
    const audit = createShaderWarmAudit();
    for (let i = 0; i < SHADER_WARM_AUDIT_SAMPLE_LIMIT + 5; i++) {
      expectProgramSource(audit, { cacheKey: `k${i}`, name: 'n', hash: 'dry' }, 'g', 0);
      observeMintedProgram(audit, { cacheKey: `k${i}`, name: 'n', hash: 'live' });
    }
    expect(audit.drifted).toBe(SHADER_WARM_AUDIT_SAMPLE_LIMIT + 5);
    expect(audit.drifts.length).toBe(SHADER_WARM_AUDIT_SAMPLE_LIMIT);
  });

  it('counts an unannounced mint by shader name', () => {
    const audit = createShaderWarmAudit();
    observeMintedProgram(audit, { cacheKey: 'a', name: 'MeshStandardMaterial', hash: 'x' });
    observeMintedProgram(audit, { cacheKey: 'b', name: 'MeshStandardMaterial', hash: 'y' });
    observeMintedProgram(audit, { cacheKey: 'c', name: 'MeshDepthMaterial', hash: 'z' });
    const summary = shaderWarmAuditSummary(audit);
    expect(summary.unexpected).toBe(3);
    expect(summary.unexpectedByName).toEqual([
      { name: 'MeshStandardMaterial', count: 2 },
      { name: 'MeshDepthMaterial', count: 1 },
    ]);
  });

  it('ranks the unexpected names by count, breaks a tie by name, and bounds the list', () => {
    const audit = createShaderWarmAudit();
    // Equal counts read in insertion order without the tiebreak, so 'beta'
    // arriving first is what makes this decisive.
    observeMintedProgram(audit, { cacheKey: 'b1', name: 'beta', hash: 'x' });
    observeMintedProgram(audit, { cacheKey: 'a1', name: 'alpha', hash: 'x' });
    expect(shaderWarmAuditSummary(audit).unexpectedByName).toEqual([
      { name: 'alpha', count: 1 },
      { name: 'beta', count: 1 },
    ]);
    // Count still outranks the name: the tiebreak applies to ties only.
    observeMintedProgram(audit, { cacheKey: 'b2', name: 'beta', hash: 'x' });
    expect(shaderWarmAuditSummary(audit).unexpectedByName[0]).toEqual({ name: 'beta', count: 2 });
    for (let i = 0; i < SHADER_WARM_AUDIT_SAMPLE_LIMIT + 5; i++) {
      observeMintedProgram(audit, { cacheKey: `n${i}`, name: `family-${i}`, hash: 'x' });
    }
    // The readout is sliced; the tally behind it keeps every family.
    expect(shaderWarmAuditSummary(audit).unexpectedByName.length).toBe(
      SHADER_WARM_AUDIT_SAMPLE_LIMIT,
    );
    expect(audit.unexpectedByName.size).toBe(SHADER_WARM_AUDIT_SAMPLE_LIMIT + 7);
  });
});

describe('shaderWarmAuditSummary', () => {
  it('reports the announced, pending, matched, drifted, unexpected and dropped counts', () => {
    const audit = createShaderWarmAudit();
    expectProgramSource(audit, { cacheKey: 'hit', name: 'n', hash: 'h' }, 'g', 0);
    expectProgramSource(audit, { cacheKey: 'wait', name: 'n', hash: 'h' }, 'g', 0);
    observeMintedProgram(audit, { cacheKey: 'hit', name: 'n', hash: 'h' });
    observeMintedProgram(audit, { cacheKey: 'else', name: 'n', hash: 'h' });
    expect(shaderWarmAuditSummary(audit)).toMatchObject({
      expected: 2,
      pending: 1,
      matched: 1,
      drifted: 0,
      unexpected: 1,
      dropped: 0,
      drifts: [],
    });
  });
});

describe('key samples for the field diff', () => {
  it('keeps the first unexpected keys and the pending announcements, whole, bounded', () => {
    const audit = createShaderWarmAudit();
    expectProgramSource(audit, { cacheKey: 'k-wait', name: 'n', hash: 'h' }, 'cull:1', 0);
    expectProgramSource(audit, { cacheKey: 'k-hit', name: 'n', hash: 'h' }, 'cull:2', 0);
    observeMintedProgram(audit, { cacheKey: 'k-hit', name: 'n', hash: 'h' });
    observeMintedProgram(audit, { cacheKey: 'k-else', name: 'm', hash: 'x' });
    const summary = shaderWarmAuditSummary(audit);
    expect(summary.pendingSamples).toEqual([{ cacheKey: 'k-wait', name: 'n', label: 'cull:1' }]);
    expect(summary.unexpectedSamples).toMatchObject([{ cacheKey: 'k-else', name: 'm', label: '' }]);
    for (let i = 0; i < SHADER_WARM_AUDIT_SAMPLE_LIMIT + 3; i++) {
      observeMintedProgram(audit, { cacheKey: `u${i}`, name: 'm', hash: 'x' });
      expectProgramSource(audit, { cacheKey: `p${i}`, name: 'n', hash: 'h' }, 'g', 0);
    }
    const bounded = shaderWarmAuditSummary(audit);
    expect(bounded.unexpectedSamples.length).toBe(SHADER_WARM_AUDIT_SAMPLE_LIMIT);
    expect(bounded.pendingSamples.length).toBe(SHADER_WARM_AUDIT_SAMPLE_LIMIT);
    expect(bounded.unexpected).toBe(SHADER_WARM_AUDIT_SAMPLE_LIMIT + 4);
    expect(bounded.pending).toBe(SHADER_WARM_AUDIT_SAMPLE_LIMIT + 4);
  });
});

describe('attributing a program nobody named', () => {
  it('reads the type, the hook, the link colour space and the pass uniforms off the program', () => {
    // The tester's signature: an unnamed ShaderMaterial with a real
    // onBeforeCompile, linked while a render target was bound (three keys its
    // working space, srgb-linear, there and the canvas space in the trailing
    // push). Nothing here comes from a material: an unexpected mint has none.
    const attribution = describeMintedProgram(
      threeKey({ custom: HAZE_HOOK, outputColorSpace: 'srgb-linear' }),
      HAZE_FRAGMENT,
    );
    expect(attribution.type).toBe('ShaderMaterial');
    expect(attribution.shader).toBe('861151317');
    expect(attribution.hooked).toBe(true);
    expect(attribution.customKeyHead).toContain('shader.uniforms.uHazeColor');
    // Collapsed to one line, so a readout prints it whole.
    expect(attribution.customKeyHead).not.toContain('\n');
    expect(attribution.outputColorSpace).toBe('srgb-linear');
    expect(attribution.rendererOutputColorSpace).toBe('srgb');
    // three's own prefix uniforms name no producer; the pass's do.
    expect(attribution.uniforms).toEqual(['tDiffuse', 'tDepth', 'uResolution']);
  });

  it('calls three own body-less onBeforeCompile no hook, and claims no type for a built-in', () => {
    const plain = describeMintedProgram(threeKey());
    expect(plain.hooked).toBe(false);
    const builtin = describeMintedProgram(threeKey({ head: ['physical'], custom: HAZE_HOOK }));
    // A built-in material's family is the key head; only a numeric head (the
    // two custom shader ids) is a ShaderMaterial.
    expect(builtin.shader).toBe('physical');
    expect(builtin.type).toBe('');
    expect(builtin.hooked).toBe(true);
    // A key of neither shape claims nothing rather than guessing.
    const foreign = describeMintedProgram('not-a-three-key');
    expect(foreign).toMatchObject({ type: '', hooked: false, customKeyHead: '', uniforms: [] });
  });

  it('finds the custom tail past the empty channel slots, agreeing with the ledger parse', () => {
    // The parameter block is full of `0,0,,` runs, so the tail is found by the
    // ledger's own anchor (precision, colour space, masks at a fixed offset),
    // never by looking for the first plausible triple.
    const key = threeKey({ custom: HAZE_HOOK, outputColorSpace: 'srgb-linear' });
    expect(programCustomKeyTail(key)).toBe(HAZE_HOOK);
    expect(parseThreeProgramCacheKey(key).identity.endsWith(`|${HAZE_HOOK}`)).toBe(true);
    // A raw ShaderMaterial key carries no block, so there is no tail to name.
    expect(programCustomKeyTail('12,34,onBeforeCompile() {}')).toBe('');
  });

  it('bounds the uniform list and keeps the declaration order, deduped', () => {
    const many = Array.from({ length: 20 }, (_, i) => `uniform float u${i};`).join('\n');
    const names = programUniformNames(`uniform vec3 cameraPosition;\n${many}`);
    expect(names).toHaveLength(SHADER_WARM_AUDIT_UNIFORM_LIMIT);
    expect(names[0]).toBe('u0');
    expect(programUniformNames('uniform float uA;\nuniform float uA;')).toEqual(['uA']);
  });
});

describe('shaderWarmAuditIdentity', () => {
  it('keeps three shader name where there is one', () => {
    const attribution = describeMintedProgram(threeKey({ custom: HAZE_HOOK }));
    expect(shaderWarmAuditIdentity('living_water', attribution)).toBe('living_water');
  });

  it('names an unnamed hooked material by its type and its hook, stably', () => {
    const haze = describeMintedProgram(threeKey({ custom: HAZE_HOOK }), HAZE_FRAGMENT);
    const identity = shaderWarmAuditIdentity('', haze);
    expect(identity.startsWith('ShaderMaterial:')).toBe(true);
    expect(identity).toContain('uHazeColor');
    // The identity rides the key alone, so the same producer reads the same
    // whether or not the sample budget still had room for its GLSL.
    expect(
      shaderWarmAuditIdentity('', describeMintedProgram(threeKey({ custom: HAZE_HOOK }))),
    ).toBe(identity);
    // A different hook is a different producer, and so a different row.
    const other = describeMintedProgram(threeKey({ custom: 'function (s) { s.x = 1; }' }));
    expect(shaderWarmAuditIdentity('', other)).not.toBe(identity);
    // An unnamed material with no hook still reads as something.
    expect(shaderWarmAuditIdentity('', describeMintedProgram(threeKey()))).toBe('ShaderMaterial');
    expect(shaderWarmAuditIdentity('', describeMintedProgram('not-a-three-key'))).toBe(
      'not-a-three-key',
    );
  });
});

describe('an unexpected mint with no name and no gate', () => {
  it('carries an attribution that names the type and the hook, and tallies under it', () => {
    // The Windows D3D11 report: five unexpected entries, empty name, empty
    // label, told apart only by their raw keys. The attribution is what names
    // them without a breakpoint.
    const audit = createShaderWarmAudit();
    const key = threeKey({ custom: HAZE_HOOK, outputColorSpace: 'srgb-linear' });
    expect(
      observeMintedProgram(audit, { cacheKey: key, name: '', hash: 'h', fragment: HAZE_FRAGMENT }),
    ).toBe('unexpected');
    const summary = shaderWarmAuditSummary(audit);
    const sample = summary.unexpectedSamples[0];
    expect(sample.name).toBe('');
    expect(sample.label).toBe('');
    expect(sample.attribution).toMatchObject({
      type: 'ShaderMaterial',
      hooked: true,
      outputColorSpace: 'srgb-linear',
      rendererOutputColorSpace: 'srgb',
      uniforms: ['tDiffuse', 'tDepth', 'uResolution'],
    });
    expect(sample.attribution?.customKeyHead).toContain('uHazeColor');
    // The tally no longer collapses every unnamed producer into one row.
    expect(summary.unexpectedByName).toHaveLength(1);
    expect(summary.unexpectedByName[0].name).toBe(
      shaderWarmAuditIdentity('', describeMintedProgram(key)),
    );
    expect(summary.unexpectedByName[0].name).not.toBe('');
  });

  it('tells two unnamed producers apart and counts a repeat under one row', () => {
    const audit = createShaderWarmAudit();
    const haze = threeKey({ custom: HAZE_HOOK });
    const other = threeKey({ custom: 'function (s) { s.uniforms.uCopy = 1; }' });
    observeMintedProgram(audit, { cacheKey: haze, name: '', hash: 'a', fragment: HAZE_FRAGMENT });
    observeMintedProgram(audit, { cacheKey: haze, name: '', hash: 'a', fragment: HAZE_FRAGMENT });
    observeMintedProgram(audit, { cacheKey: other, name: '', hash: 'b' });
    const summary = shaderWarmAuditSummary(audit);
    expect(summary.unexpected).toBe(3);
    expect(summary.unexpectedByName).toHaveLength(2);
    expect(summary.unexpectedByName[0].count).toBe(2);
    expect(summary.unexpectedByName[0].name).toContain('uHazeColor');
  });

  it('drops the GLSL scan past the sample budget without moving the tally row', () => {
    const audit = createShaderWarmAudit();
    const key = threeKey({ custom: HAZE_HOOK });
    const identity = shaderWarmAuditIdentity('', describeMintedProgram(key));
    for (let i = 0; i < SHADER_WARM_AUDIT_SAMPLE_LIMIT; i++) {
      observeMintedProgram(audit, { cacheKey: `k${i}`, name: `n${i}`, hash: 'h' });
    }
    observeMintedProgram(audit, { cacheKey: key, name: '', hash: 'h', fragment: HAZE_FRAGMENT });
    const summary = shaderWarmAuditSummary(audit);
    expect(summary.unexpectedSamples).toHaveLength(SHADER_WARM_AUDIT_SAMPLE_LIMIT);
    // Past the budget nothing keeps the uniforms, and the row is the same one
    // the sampled mints would have landed in.
    expect(audit.unexpectedByName.get(identity)).toBe(1);
  });

  it('leaves a named mint tallied by its name', () => {
    const audit = createShaderWarmAudit();
    observeMintedProgram(audit, {
      cacheKey: threeKey({ custom: HAZE_HOOK }),
      name: 'living_water',
      hash: 'h',
      fragment: HAZE_FRAGMENT,
    });
    expect(shaderWarmAuditSummary(audit).unexpectedByName).toEqual([
      { name: 'living_water', count: 1 },
    ]);
  });
});

describe('mints before the reveal', () => {
  it('settle their announcement but are counted apart from the live classes', () => {
    const audit = createShaderWarmAudit();
    expectProgramSource(audit, { cacheKey: 'entry', name: 'n', hash: 'h' }, 'views.required', 0);
    expect(observeMintedProgram(audit, { cacheKey: 'entry', name: 'n', hash: 'h' }, false)).toBe(
      'matched',
    );
    expect(observeMintedProgram(audit, { cacheKey: 'boot', name: 'n', hash: 'h' }, false)).toBe(
      'unexpected',
    );
    const summary = shaderWarmAuditSummary(audit);
    expect(summary).toMatchObject({
      matched: 0,
      unexpected: 0,
      matchedBeforeReveal: 1,
      unexpectedBeforeReveal: 1,
      pending: 0,
      unexpectedByName: [],
      unexpectedSamples: [],
    });
    // A drift is a defect whatever the phase.
    expectProgramSource(audit, { cacheKey: 'd', name: 'n', hash: 'dry' }, 'g', 0);
    expect(observeMintedProgram(audit, { cacheKey: 'd', name: 'n', hash: 'live' }, false)).toBe(
      'drifted',
    );
    expect(shaderWarmAuditSummary(audit).drifted).toBe(1);
  });
});

describe('mints an out-of-band burst forced', () => {
  it('are counted and sampled apart, and never tallied as unexpected', () => {
    // The scene census (?diagnostics) draws every bucket once with the others
    // hidden, under a lighting hash no live frame has: the programs that
    // lands in the driver are the burst's, not a producer that bypassed the
    // gates, and the tester reading `unexpected` must not see them.
    const audit = createShaderWarmAudit();
    const key = threeKey({ custom: HAZE_HOOK });
    const minted = { cacheKey: key, name: '', hash: 'h', fragment: HAZE_FRAGMENT };
    expect(observeMintedProgram(audit, minted, true, true)).toBe('out-of-band');
    const burst = shaderWarmAuditSummary(audit);
    expect(burst).toMatchObject({
      outOfBand: 1,
      unexpected: 0,
      unexpectedByName: [],
      unexpectedSamples: [],
    });
    // Sampled the way an unexpected mint is: the whole key plus what the
    // program itself says, so the producer stays greppable.
    expect(burst.outOfBandSamples).toEqual([
      {
        cacheKey: key,
        name: '',
        label: '',
        attribution: describeMintedProgram(key, HAZE_FRAGMENT),
      },
    ]);
    expect(burst.outOfBandSamples[0].attribution?.uniforms).toContain('tDiffuse');

    // The same mint outside the burst is exactly what it was before: an
    // unexpected link, tallied by its identity.
    expect(observeMintedProgram(audit, minted)).toBe('unexpected');
    expect(shaderWarmAuditSummary(audit)).toMatchObject({ outOfBand: 1, unexpected: 1 });
    expect(shaderWarmAuditSummary(audit).unexpectedByName[0].count).toBe(1);
  });

  it('settle no announcement: the gate keeps waiting for its own link', () => {
    // three's program cache means the gate's link never mints a second time,
    // so the announcement stays pending. Better a pending row than a `matched`
    // one the gates never earned.
    const audit = createShaderWarmAudit();
    expectProgramSource(audit, { cacheKey: 'k', name: 'n', hash: 'h' }, 'kit', 0);
    expect(observeMintedProgram(audit, { cacheKey: 'k', name: 'n', hash: 'h' }, true, true)).toBe(
      'out-of-band',
    );
    expect(shaderWarmAuditSummary(audit)).toMatchObject({
      outOfBand: 1,
      matched: 0,
      drifted: 0,
      pending: 1,
    });
  });

  it('bounds its samples the way the unexpected ones are bounded', () => {
    const audit = createShaderWarmAudit();
    for (let i = 0; i < SHADER_WARM_AUDIT_SAMPLE_LIMIT + 5; i++) {
      observeMintedProgram(audit, { cacheKey: `k${i}`, name: 'n', hash: 'h' }, true, true);
    }
    const summary = shaderWarmAuditSummary(audit);
    expect(summary.outOfBand).toBe(SHADER_WARM_AUDIT_SAMPLE_LIMIT + 5);
    expect(summary.outOfBandSamples.length).toBe(SHADER_WARM_AUDIT_SAMPLE_LIMIT);
  });
});

describe('name-only drifts', () => {
  it('flags a drift whose texts agree once the SHADER_NAME lines are gone', () => {
    const audit = createShaderWarmAudit();
    expectProgramSource(
      audit,
      { cacheKey: 'k', name: 'coach:beam', hash: 'a', hashSansName: 'same' },
      'Mesh',
      0,
    );
    expect(
      observeMintedProgram(audit, {
        cacheKey: 'k',
        name: 'coach:ring',
        hash: 'b',
        hashSansName: 'same',
      }),
    ).toBe('drifted');
    expect(
      observeMintedProgram(audit, { cacheKey: 'k', name: 'x', hash: 'c', hashSansName: 'other' }),
    ).toBe('drifted');
    // Without the second hash on either side, nothing is claimed.
    expect(observeMintedProgram(audit, { cacheKey: 'k', name: 'x', hash: 'd' })).toBe('drifted');
    const summary = shaderWarmAuditSummary(audit);
    expect(summary.drifted).toBe(3);
    expect(summary.driftedNameOnly).toBe(1);
    expect(summary.drifts.map((d) => d.nameOnly)).toEqual([true, false, false]);
  });

  it('claims nothing when the ANNOUNCEMENT carried no name-stripped hash', () => {
    // The mirror of the case above: the mint brings the second hash and the
    // announcement does not, so there is nothing to compare it against and
    // the drift stays a plain one rather than a harmless naming difference.
    const audit = createShaderWarmAudit();
    expectProgramSource(audit, { cacheKey: 'k', name: 'coach:beam', hash: 'a' }, 'Mesh', 0);
    expect(
      observeMintedProgram(audit, {
        cacheKey: 'k',
        name: 'coach:ring',
        hash: 'b',
        hashSansName: 'same',
      }),
    ).toBe('drifted');
    const summary = shaderWarmAuditSummary(audit);
    expect(summary.drifted).toBe(1);
    expect(summary.driftedNameOnly).toBe(0);
    expect(summary.drifts[0]?.nameOnly).toBe(false);
  });
});
