// Pure helpers for the Bot Detector > Configuration page (src/admin/antibot_config.ts):
// grouping, form-state seeding, and parsing form state back into the override
// document. Node env by design (no DOM).
import { describe, expect, it } from 'vitest';
import {
  antibotDefaultText,
  antibotFieldDirty,
  antibotFieldModified,
  antibotFormState,
  antibotValueEquals,
  buildAntibotOverrides,
  groupAntibotFields,
  toggleAntibotOption,
} from '../../src/admin/antibot_config';
import type { AntibotConfigField } from '../../src/admin/types';

const numberField = (overrides: Partial<AntibotConfigField> = {}): AntibotConfigField => ({
  id: 'gate.kick_score',
  group: 'Gate',
  label: 'Kick score threshold',
  type: 'number',
  defaultValue: 1,
  value: 1,
  min: 0,
  max: 5,
  ...overrides,
});

const boolField = (overrides: Partial<AntibotConfigField> = {}): AntibotConfigField => ({
  id: 'enforcement.enabled',
  group: 'Enforcement',
  label: 'Active responses',
  type: 'boolean',
  defaultValue: false,
  value: false,
  ...overrides,
});

const multiField = (overrides: Partial<AntibotConfigField> = {}): AntibotConfigField => ({
  id: 'reports.reliable_kinds',
  group: 'Reports',
  label: 'Reliable report kinds',
  type: 'multi_select',
  defaultValue: ['a', 'b'],
  value: ['a', 'b'],
  options: [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
    { value: 'c', label: 'C' },
  ],
  ...overrides,
});

describe('groupAntibotFields', () => {
  it('groups by section preserving catalog order', () => {
    const groups = groupAntibotFields([numberField(), boolField(), numberField({ id: 'gate.x' })]);
    expect(groups.map((group) => group.group)).toEqual(['Gate', 'Enforcement']);
    expect(groups[0].fields.map((field) => field.id)).toEqual(['gate.kick_score', 'gate.x']);
  });
});

describe('antibotFormState', () => {
  it('seeds from applied values and copies arrays', () => {
    const field = multiField({ value: ['a'] });
    const values = antibotFormState([field]);
    expect(values['reports.reliable_kinds']).toEqual(['a']);
    expect(values['reports.reliable_kinds']).not.toBe(field.value);
  });
});

describe('antibotValueEquals / antibotFieldModified', () => {
  it('compares multi_select values as sets', () => {
    expect(antibotValueEquals(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(antibotValueEquals(['a'], ['a', 'b'])).toBe(false);
  });

  it('flags a field as modified only away from its default', () => {
    expect(antibotFieldModified(numberField(), 1)).toBe(false);
    expect(antibotFieldModified(numberField(), 1.5)).toBe(true);
    expect(antibotFieldModified(numberField(), '')).toBe(false); // empty input = default
    expect(antibotFieldModified(boolField(), true)).toBe(true);
    expect(antibotFieldModified(multiField(), ['b', 'a'])).toBe(false);
  });

  it('tracks unsaved changes against the currently applied value', () => {
    const overridden = numberField({ value: 1.5 });
    expect(antibotFieldDirty(overridden, 1.5)).toBe(false);
    expect(antibotFieldDirty(overridden, 1)).toBe(true);
    expect(antibotFieldDirty(overridden, '')).toBe(true);
    expect(antibotFieldDirty(numberField(), '')).toBe(false);
    expect(antibotFieldDirty(numberField(), 'invalid')).toBe(true);
    expect(antibotFieldDirty(multiField({ value: ['a'] }), ['a'])).toBe(false);
  });
});

describe('buildAntibotOverrides', () => {
  it('collects only values that differ from the defaults', () => {
    const fields = [numberField(), boolField(), multiField()];
    const { overrides, invalid } = buildAntibotOverrides(fields, {
      'gate.kick_score': 1.5,
      'enforcement.enabled': false,
      'reports.reliable_kinds': ['b', 'a'],
    });
    expect(invalid).toEqual([]);
    expect(overrides).toEqual({ 'gate.kick_score': 1.5 });
  });

  it('treats an empty number input as the default', () => {
    const { overrides, invalid } = buildAntibotOverrides([numberField()], {
      'gate.kick_score': '',
    });
    expect(invalid).toEqual([]);
    expect(overrides).toEqual({});
  });

  it('rejects unparseable and out-of-range numbers', () => {
    const fields = [numberField()];
    expect(buildAntibotOverrides(fields, { 'gate.kick_score': 'abc' }).invalid).toEqual([
      'gate.kick_score',
    ]);
    expect(buildAntibotOverrides(fields, { 'gate.kick_score': 9 }).invalid).toEqual([
      'gate.kick_score',
    ]);
    expect(buildAntibotOverrides(fields, { 'gate.kick_score': -1 }).invalid).toEqual([
      'gate.kick_score',
    ]);
  });
});

describe('toggleAntibotOption', () => {
  it('adds and removes options immutably', () => {
    const current = ['a'];
    expect(toggleAntibotOption(current, 'b')).toEqual(['a', 'b']);
    expect(toggleAntibotOption(current, 'a')).toEqual([]);
    expect(current).toEqual(['a']);
  });
});

describe('antibotDefaultText', () => {
  const translate = (key: string, params?: Record<string, string | number>): string =>
    params ? `${key}:${JSON.stringify(params)}` : key;

  it('routes words through the translator and renders numbers as data', () => {
    expect(antibotDefaultText(boolField(), translate)).toBe('antibot.valueOff');
    expect(antibotDefaultText(numberField({ unit: 'ms' }), translate)).toBe('1 ms');
    expect(antibotDefaultText(multiField(), translate)).toBe('antibot.valueKindCount:{"count":2}');
    expect(antibotDefaultText(multiField({ defaultValue: ['a', 'b', 'c'] }), translate)).toBe(
      'antibot.valueAllKinds',
    );
  });
});
