// The shader warm audit's bookkeeping (src/render/shader_warm_audit_core.ts):
// the source hash, the announcements, and the three classes a minted program
// falls in (matched, drifted, unexpected), plus the pending count.

import { describe, expect, it } from 'vitest';
import {
  createShaderWarmAudit,
  expectProgramSource,
  observeMintedProgram,
  programSourceHash,
  SHADER_WARM_AUDIT_EXPECTED_LIMIT,
  SHADER_WARM_AUDIT_SAMPLE_LIMIT,
  shaderWarmAuditSummary,
} from '../src/render/shader_warm_audit_core';

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
    expect(summary.unexpectedSamples).toEqual([{ cacheKey: 'k-else', name: 'm', label: '' }]);
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
