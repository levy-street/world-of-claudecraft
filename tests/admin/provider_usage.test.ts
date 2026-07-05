// @vitest-environment jsdom
import './_setup';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import ProviderUsage from '../../src/admin/components/ProviderUsage.svelte';
import type { ProviderUsageSnapshot } from '../../src/admin/types';

const usage: ProviderUsageSnapshot = {
  generatedAt: '2026-06-01T00:00:00Z',
  // Real metric/cache label keys are server-supplied at runtime; use an existing admin
  // key here so t() resolves. The assertions check the numeric cells, not the labels.
  windows: [{ key: 'm1', labelKey: 'usage.colMetric', milliseconds: 60000 }],
  metrics: [{ key: 'rpc', labelKey: 'usage.colMetric', counts: { m1: 7, m5: 0, h1: 0, h24: 0 } }],
  caches: [
    {
      key: 'rel',
      labelKey: 'usage.colMetric',
      entries: 3,
      maxEntries: 10,
      hits: 8,
      misses: 2,
      staleRefreshes: 1,
      stores: 4,
      failures: 0,
      evictions: 0,
      updatedAt: null,
    },
  ],
};

describe('ProviderUsage', () => {
  it('renders the request count and a computed cache hit rate', () => {
    render(ProviderUsage, { usage });
    expect(screen.getByText('7')).toBeInTheDocument(); // metric count
    expect(screen.getByText('80%')).toBeInTheDocument(); // 8/(8+2)
    expect(screen.getByText('3 / 10')).toBeInTheDocument(); // entries / max
  });
});
