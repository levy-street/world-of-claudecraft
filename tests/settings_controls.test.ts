// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  settingRow,
  settingsCard,
  sliderControl,
  toggleControl,
} from '../src/ui/settings_controls';

describe('settings controls interface-library adoption', () => {
  it('keeps legacy hooks beside the shared row and card primitives', () => {
    const host = document.createElement('div');
    const { row } = settingRow('Brightness');
    const card = settingsCard(host, 'Display');

    expect(row.classList.contains('set-row')).toBe(true);
    expect(row.classList.contains('ui-stat-row')).toBe(true);
    expect(card.classList.contains('perf-card')).toBe(true);
    expect(card.classList.contains('ui-card')).toBe(true);
    expect(card.querySelector('.perf-card-title.ui-h')?.textContent).toBe('Display');
  });

  it('renders the plate toggle states and preserves its callback behavior', () => {
    const host = document.createElement('div');
    let enabled = false;
    const set = vi.fn((next: boolean) => {
      enabled = next;
    });
    toggleControl({
      parent: host,
      label: 'Weather',
      get: () => enabled,
      set,
      onLabel: 'On',
      offLabel: 'Off',
    });

    const button = host.querySelector('button') as HTMLButtonElement;
    expect(button.className).toBe('btn ui-btn ui-btn--plate set-toggle off is-off');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    button.click();
    expect(set).toHaveBeenCalledWith(true);
    expect(button.classList.contains('is-off')).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the native range fill synchronized with external and input changes', () => {
    const host = document.createElement('div');
    let value = 25;
    const control = sliderControl({
      parent: host,
      label: 'Volume',
      get: () => value,
      set: (next) => {
        value = next;
      },
      min: 0,
      max: 100,
      step: 1,
      format: (next) => `${next}%`,
    });
    const slider = host.querySelector('input[type="range"]') as HTMLInputElement;

    expect(slider.style.getPropertyValue('--range-fill')).toBe('25%');
    control.setValue(80);
    expect(slider.style.getPropertyValue('--range-fill')).toBe('80%');
    slider.value = '40';
    slider.dispatchEvent(new Event('input'));
    expect(value).toBe(40);
    expect(slider.style.getPropertyValue('--range-fill')).toBe('40%');
  });

  // The case above runs min 0 / max 100, where the percent math collapses to
  // identity: value === pct, so a fill that forgot --min or --span entirely
  // would still pass. A non-zero min is what makes the arithmetic real.
  it('offsets the fill by a non-zero min instead of reading the raw value', () => {
    const host = document.createElement('div');
    let value = 30;
    const control = sliderControl({
      parent: host,
      label: 'Field of view',
      get: () => value,
      set: (next) => {
        value = next;
      },
      min: 20,
      max: 60,
      step: 1,
      format: (next) => `${next}`,
    });
    const slider = host.querySelector('input[type="range"]') as HTMLInputElement;

    // (30 - 20) / (60 - 20) = 25%, NOT the raw 30.
    expect(slider.style.getPropertyValue('--range-fill')).toBe('25%');
    control.setValue(50);
    expect(slider.style.getPropertyValue('--range-fill')).toBe('75%');
    // Both ends clamp exactly, so an off-by-one in the span shows up here.
    slider.value = '20';
    slider.dispatchEvent(new Event('input'));
    expect(value).toBe(20);
    expect(slider.style.getPropertyValue('--range-fill')).toBe('0%');
    slider.value = '60';
    slider.dispatchEvent(new Event('input'));
    expect(slider.style.getPropertyValue('--range-fill')).toBe('100%');
  });
});
