// @vitest-environment jsdom
import './_setup';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import BarChart from '../../src/admin/components/BarChart.svelte';
import { t } from '../../src/admin/i18n';

describe('BarChart', () => {
  it('shows the empty message when there are no points', () => {
    render(BarChart, { points: [] });
    expect(screen.getByText(t('charts.noData'))).toBeInTheDocument();
  });

  it('draws one bar per data point with a tooltip title', () => {
    const { container } = render(BarChart, {
      points: [
        { label: 'Mon', value: 3 },
        { label: 'Tue', value: 7 },
        { label: 'Wed', value: 5 },
      ],
    });
    const bars = container.querySelectorAll('rect.bar');
    expect(bars.length).toBe(3);
    expect(container.querySelector('rect.bar > title')?.textContent).toBe('Mon: 3');
  });
});
