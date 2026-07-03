<script lang="ts">
  import type { FieldInput } from '../housekeeping';
  import { t } from '../i18n';
  import type { HkNumericFieldSpec, HkNumericValues } from '../types';

  // One labeled input row per overridable numeric field. An empty input means
  // "keep the shipped default" (shown beside the input together with the live
  // value when an override is already applied). The parent owns `values`
  // (field key -> raw string) and parses it with parseNumericPatch on save.
  let {
    fields,
    defaults,
    live,
    values = $bindable(),
    invalid = [],
  }: {
    fields: HkNumericFieldSpec[];
    defaults: HkNumericValues;
    live?: HkNumericValues;
    // string on prefill; number/null once the operator edits (Svelte coerces
    // bind:value on number inputs). parseNumericPatch accepts the union.
    values: Record<string, FieldInput>;
    invalid?: string[];
  } = $props();

  const fmt = (value: number | undefined): string =>
    value === undefined ? t('common.emptyValue') : String(value);
</script>

<div class="hk-fields">
  {#each fields as field (field.key)}
    <label class:hk-invalid={invalid.includes(field.key)}>
      <span class="hk-field-name">{t(`housekeeping.field.${field.key}`)}</span>
      <input
        type="number"
        min={field.min}
        max={field.max}
        step={field.integer ? 1 : 'any'}
        placeholder={fmt(defaults[field.key])}
        bind:value={values[field.key]}
      />
      <span class="hk-field-meta">
        {t('housekeeping.defaultValue', { value: fmt(defaults[field.key]) })}
        {#if live && live[field.key] !== defaults[field.key]}
          <span class="hk-live">{t('housekeeping.liveValue', { value: fmt(live[field.key]) })}</span>
        {/if}
      </span>
    </label>
  {/each}
</div>

<style>
  .hk-fields {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 10px 16px;
    margin: 10px 0;
  }
  .hk-fields label {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: var(--font-size-small);
    color: var(--text-soft);
  }
  .hk-field-name {
    color: var(--text-bright);
  }
  .hk-field-meta {
    font-size: var(--font-size-small);
    color: var(--text-dim);
  }
  .hk-live {
    margin-left: 6px;
    color: var(--gold-dim);
  }
  .hk-invalid input {
    border-color: var(--color-danger-border);
  }
</style>
