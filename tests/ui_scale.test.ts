import { describe, it, expect } from 'vitest';
import { clampUiScale, resolveUiScale, UI_SCALE_MIN, UI_SCALE_MAX, UI_SCALE_DEFAULT } from '../src/ui/ui_scale';

describe('clampUiScale', () => {
  it('passes through an in-range value', () => {
    expect(clampUiScale(1.2)).toBe(1.2);
  });
  it('clamps below the min and above the max', () => {
    expect(clampUiScale(0.1)).toBe(UI_SCALE_MIN);
    expect(clampUiScale(99)).toBe(UI_SCALE_MAX);
  });
  it('falls back to the default for non-finite / non-numeric input', () => {
    expect(clampUiScale(NaN)).toBe(UI_SCALE_DEFAULT);
    expect(clampUiScale(Infinity)).toBe(UI_SCALE_DEFAULT);
    expect(clampUiScale('nope')).toBe(UI_SCALE_DEFAULT);
    expect(clampUiScale(null)).toBe(UI_SCALE_DEFAULT);
    expect(clampUiScale(undefined)).toBe(UI_SCALE_DEFAULT);
  });
  it('coerces a numeric string', () => {
    expect(clampUiScale('1.1')).toBe(1.1);
  });
});

describe('resolveUiScale precedence', () => {
  it('prefers the live CSS custom property when finite', () => {
    expect(resolveUiScale('1.25', JSON.stringify({ uiScale: 0.9 }))).toBe(1.25);
  });
  it('clamps the CSS value to range', () => {
    expect(resolveUiScale('5', null)).toBe(UI_SCALE_MAX);
  });
  it('falls back to the persisted setting when the CSS var is blank/missing', () => {
    expect(resolveUiScale('', JSON.stringify({ uiScale: 1.3 }))).toBe(1.3);
    expect(resolveUiScale('   ', JSON.stringify({ uiScale: 1.3 }))).toBe(1.3);
    expect(resolveUiScale(null, JSON.stringify({ uiScale: 0.85 }))).toBe(0.85);
  });
  it('returns the default when neither source is usable', () => {
    expect(resolveUiScale(null, null)).toBe(UI_SCALE_DEFAULT);
    expect(resolveUiScale(undefined, undefined)).toBe(UI_SCALE_DEFAULT);
  });
  it('survives a corrupt persisted JSON blob', () => {
    expect(resolveUiScale(null, '{not json')).toBe(UI_SCALE_DEFAULT);
  });
  it('ignores a persisted blob without a numeric uiScale', () => {
    expect(resolveUiScale(null, JSON.stringify({ uiScale: 'big' }))).toBe(UI_SCALE_DEFAULT);
    expect(resolveUiScale(null, JSON.stringify({ other: 1.2 }))).toBe(UI_SCALE_DEFAULT);
  });
  it('clamps the persisted value to range', () => {
    expect(resolveUiScale(null, JSON.stringify({ uiScale: 0.1 }))).toBe(UI_SCALE_MIN);
  });
});
