<script lang="ts">
  // The live-page auto-refresh switch, shared by every polling surface (bot-detector
  // evidence, calibration, online players). The page owns the interval and the stored
  // preference; this component owns only the control and its look.
  let {
    checked,
    label,
    onChange,
  }: {
    checked: boolean;
    label: string;
    onChange: (enabled: boolean) => void;
  } = $props();
</script>

<label class="auto-refresh">
  <input
    type="checkbox"
    {checked}
    onchange={(event) => onChange((event.currentTarget as HTMLInputElement).checked)}
  />
  <span class="switch-track" aria-hidden="true"><span></span></span>
  <span>{label}</span>
</label>

<style>
  .auto-refresh {
    position: relative;
    display: inline-flex;
    min-height: 40px;
    flex: none;
    align-items: center;
    gap: 8px;
    color: var(--text);
    cursor: pointer;
    font-size: 12px;
  }

  .auto-refresh input {
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

  .auto-refresh input:checked + .switch-track {
    background: var(--toggle-on-bg);
    border-color: var(--badge-success-border);
  }

  .auto-refresh input:checked + .switch-track span {
    background: var(--badge-success-text);
    transform: translateX(15px);
  }

  .auto-refresh input:focus-visible + .switch-track {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }
</style>
