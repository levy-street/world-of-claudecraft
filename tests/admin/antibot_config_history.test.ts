import { describe, expect, it } from 'vitest';
import {
  antibotConfigHistoryRows,
  antibotHistoryFormState,
} from '../../src/admin/antibot_config_history';
import type { AntibotConfigField, AntibotConfigHistoryEntry } from '../../src/admin/types';

const fields: AntibotConfigField[] = [
  {
    id: 'demo.interval',
    group: 'Demo',
    label: 'Interval',
    type: 'number',
    defaultValue: 1000,
    value: 1500,
    unit: 'ms',
  },
  {
    id: 'demo.tags',
    group: 'Demo',
    label: 'Tags',
    type: 'multi_select',
    defaultValue: ['alpha'],
    value: ['alpha'],
    options: [
      { value: 'alpha', label: 'Alpha' },
      { value: 'beta', label: 'Beta' },
    ],
  },
];

const translate = (key: string): string =>
  (
    ({
      'antibot.historyDefault': 'Default',
      'antibot.historyNone': 'None',
      'antibot.valueOn': 'on',
      'antibot.valueOff': 'off',
    }) as Record<string, string>
  )[key] ?? key;

function entry(overrides: Partial<AntibotConfigHistoryEntry>): AntibotConfigHistoryEntry {
  return {
    id: 1,
    beforeData: {},
    afterData: {},
    note: '',
    createdAt: '2026-07-04T00:00:00.000Z',
    adminAccountId: 7,
    adminUsername: 'admin',
    ...overrides,
  };
}

describe('antibotConfigHistoryRows', () => {
  it('renders defaults, units, option labels, and removed field ids', () => {
    expect(
      antibotConfigHistoryRows(
        entry({
          beforeData: { 'removed.field': true },
          afterData: {
            'demo.interval': 1500,
            'demo.tags': ['alpha', 'beta'],
            'removed.field': false,
          },
        }),
        fields,
        translate,
      ),
    ).toEqual([
      { id: 'demo.interval', label: 'Interval', before: 'Default', after: '1500 ms' },
      { id: 'demo.tags', label: 'Tags', before: 'Default', after: 'Alpha, Beta' },
      { id: 'removed.field', label: 'removed.field', before: 'on', after: 'off' },
    ]);
  });

  it('treats reordered multi-select arrays as the same value', () => {
    expect(
      antibotConfigHistoryRows(
        entry({
          beforeData: { 'demo.tags': ['alpha', 'beta'] },
          afterData: { 'demo.tags': ['beta', 'alpha'] },
        }),
        fields,
        translate,
      ),
    ).toEqual([]);
  });
});

describe('antibotHistoryFormState', () => {
  it('loads current-schema overrides and falls back to defaults', () => {
    expect(
      antibotHistoryFormState(fields, {
        'demo.interval': 1200,
      }),
    ).toEqual({
      values: {
        'demo.interval': 1200,
        'demo.tags': ['alpha'],
      },
      skippedCount: 0,
    });
  });

  it('ignores removed and incompatible overrides', () => {
    expect(
      antibotHistoryFormState(fields, {
        'demo.interval': 'invalid',
        'demo.tags': ['removed-option'],
        'removed.field': true,
      }),
    ).toEqual({
      values: {
        'demo.interval': 1000,
        'demo.tags': ['alpha'],
      },
      skippedCount: 3,
    });
  });
});
