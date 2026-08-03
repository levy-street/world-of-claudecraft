// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import ThemeToggle from '../../src/admin/components/ThemeToggle.svelte';
import { t } from '../../src/admin/i18n';
import { theme } from '../../src/admin/state/theme.svelte';
import { THEME_STORAGE_KEY } from '../../src/admin/theme';

beforeEach(() => {
  // The singleton constructs once at import time; each test starts it back on the
  // shipped dark default (mirrors the auth-state reset pattern in auth_flow.test.ts).
  theme.set('dark');
});

describe('ThemeToggle', () => {
  it('starts checked (dark, the shipped default) with <html> unmarked', () => {
    render(ThemeToggle);
    const input = screen.getByLabelText(t('theme.darkModeLabel')) as HTMLInputElement;
    expect(input.checked).toBe(true);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('unchecking switches to light: stamps <html data-theme="light"> and persists it', async () => {
    render(ThemeToggle);
    const input = screen.getByLabelText(t('theme.darkModeLabel')) as HTMLInputElement;

    await fireEvent.click(input);

    expect(input.checked).toBe(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('toggling back to dark clears the attribute again', async () => {
    render(ThemeToggle);
    const input = screen.getByLabelText(t('theme.darkModeLabel')) as HTMLInputElement;

    await fireEvent.click(input);
    await fireEvent.click(input);

    expect(input.checked).toBe(true);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });
});
