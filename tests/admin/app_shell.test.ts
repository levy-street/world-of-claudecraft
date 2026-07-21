// @vitest-environment jsdom
import './_setup';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import App from '../../src/admin/App.svelte';
import { t } from '../../src/admin/i18n';

// P1 smoke test: proves the full admin Svelte toolchain works end to end - the svelte
// vite plugin compiles a <script lang="ts"> component, jsdom renders it, the existing
// admin t() layer resolves, and @testing-library/svelte queries the DOM.
describe('admin App shell', () => {
  it('renders the localized app title', () => {
    render(App);
    expect(screen.getByText(t('app.title'))).toBeInTheDocument();
  });
});
