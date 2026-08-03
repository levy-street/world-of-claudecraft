<script lang="ts">
  // Dark/light theme switch for the topbar. Presentation only: the reactive mode
  // and its persistence live in state/theme.svelte.ts (mirrors how
  // AutoRefreshToggle owns only the control while auto_refresh_preference.ts
  // owns the storage). Reuses the same checkbox-switch family as
  // AutoRefreshToggle rather than a bespoke control.
  import { theme } from '../state/theme.svelte';
  import { t } from '../i18n';
</script>

<label class="theme-toggle">
  <input
    type="checkbox"
    checked={theme.mode === 'dark'}
    onchange={(event) =>
      theme.set((event.currentTarget as HTMLInputElement).checked ? 'dark' : 'light')}
  />
  <span class="switch-track" aria-hidden="true"><span></span></span>
  <span>{t('theme.darkModeLabel')}</span>
</label>

<style>
  .theme-toggle {
    position: relative;
    display: inline-flex;
    min-height: 40px;
    flex: none;
    align-items: center;
    gap: 8px;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 12px;
  }

  .theme-toggle input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }

  .switch-track {
    display: inline-flex;
    width: 34px;
    height: 19px;
    align-items: center;
    padding: 2px;
    background: var(--control-bg);
    border: 1px solid var(--control-border);
    border-radius: 999px;
  }

  .switch-track span {
    width: 13px;
    height: 13px;
    background: var(--text-dim);
    border-radius: 50%;
    transition: transform 120ms ease, background 120ms ease;
  }

  .theme-toggle input:checked + .switch-track {
    background: var(--surface-active);
    border-color: var(--gold-dim);
  }

  .theme-toggle input:checked + .switch-track span {
    background: var(--gold);
    transform: translateX(15px);
  }

  .theme-toggle input:focus-visible + .switch-track {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }
</style>
